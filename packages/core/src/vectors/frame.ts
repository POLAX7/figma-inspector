import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentDocument, AgentNode } from '../normalize/document.js';

type Matrix = readonly [number, number, number, number, number, number];

interface Composition {
  readonly vectorSvgs: ReadonlyMap<number, string>;
  readonly defs: string[];
  nextDefinitionId: number;
}

export interface VectorGroup {
  nodeId: string;
  name: string;
  bounds: { x: number; y: number };
  vectorCount: number;
}

/** Creates one SVG for a frame, preserving Figma frame clips and sibling masks. */
export function composeFrameSvg(document: AgentDocument, frameId: string, vectorSvgs: ReadonlyMap<number, string>): string | undefined {
  const frame = document.nodesById[frameId];
  const size = sizeOf(frame);
  if (!frame || !size) return undefined;

  const composition: Composition = { vectorSvgs, defs: [], nextDefinitionId: 0 };
  const content = renderContainer(document, frame, identity, composition, false);
  if (!content) return undefined;
  const defs = composition.defs.length ? `<defs>${composition.defs.join('')}</defs>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${number(size.x)} ${number(size.y)}">${defs}${content}</svg>`;
}

/** Lists the largest vector-only groups beneath a node without duplicating nested artwork. */
export function findVectorGroups(document: AgentDocument, rootId: string): VectorGroup[] {
  if (!document.nodesById[rootId]) return [];
  const statusById = new Map<string, VectorStatus>();
  const status = (nodeId: string): VectorStatus => {
    const cached = statusById.get(nodeId);
    if (cached) return cached;
    const node = document.nodesById[nodeId];
    if (!node || node.visible === false) return { vectorOnly: true, vectorCount: 0 };
    const children = node.childIds.map(status);
    const ownVector = Boolean(node.vectorRef);
    const value = {
      vectorOnly: !node.text && !node.assetRefs.length && supportedStyle(node) && (ownVector || children.some((child) => child.vectorCount > 0)) && children.every((child) => child.vectorOnly),
      vectorCount: (ownVector ? 1 : 0) + children.reduce((sum, child) => sum + child.vectorCount, 0)
    };
    statusById.set(nodeId, value);
    return value;
  };
  const groups: VectorGroup[] = [];
  const visit = (nodeId: string, parentVectorOnly: boolean) => {
    const node = document.nodesById[nodeId];
    if (!node || node.visible === false) return;
    const value = status(nodeId);
    const size = sizeOf(node);
    if (value.vectorOnly && value.vectorCount && !parentVectorOnly && size) groups.push({ nodeId, name: node.name, bounds: size, vectorCount: value.vectorCount });
    else for (const childId of node.childIds) visit(childId, value.vectorOnly);
  };
  visit(rootId, false);
  return groups;
}

/** Composes one vector-only group into a self-contained SVG. */
export function composeVectorGroupSvg(document: AgentDocument, nodeId: string, vectorSvgs: ReadonlyMap<number, string>): string | undefined {
  const root = document.nodesById[nodeId];
  const size = sizeOf(root);
  if (!root || !size || !findVectorGroups(document, nodeId).some((group) => group.nodeId === nodeId)) return undefined;
  const composition: Composition = { vectorSvgs, defs: [], nextDefinitionId: 0 };
  const content = withOpacity(renderContainer(document, root, identity, composition, true), root.opacity);
  if (!content) return undefined;
  const defs = composition.defs.length ? `<defs>${composition.defs.join('')}</defs>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${number(size.x)} ${number(size.y)}">${defs}${content}</svg>`;
}

/** Reads only a group's extracted SVG fragments and composes them on demand. */
export async function composeBundleVectorGroupSvg(bundleRoot: string, document: AgentDocument, nodeId: string): Promise<string | undefined> {
  const vectorPaths = new Map<number, string>();
  const visit = (id: string) => {
    const node = document.nodesById[id];
    if (!node) return;
    if (node.vectorRef?.svgPath) vectorPaths.set(node.vectorRef.blobId, node.vectorRef.svgPath);
    for (const childId of node.childIds) visit(childId);
  };
  visit(nodeId);
  if (!vectorPaths.size) return undefined;
  const vectorSvgs = new Map(await Promise.all([...vectorPaths].map(async ([blobId, path]) => [blobId, await readFile(join(bundleRoot, path), 'utf8')] as const)));
  return composeVectorGroupSvg(document, nodeId, vectorSvgs);
}

function renderNode(document: AgentDocument, node: AgentNode, parentMatrix: Matrix, composition: Composition): string {
  if (node.visible === false) return '';
  return withOpacity(renderContainer(document, node, multiply(parentMatrix, matrixOf(node)), composition, true), node.opacity);
}

function renderContainer(document: AgentDocument, node: AgentNode, matrix: Matrix, composition: Composition, includeOwnVector: boolean): string {
  const clipId = clipsContents(node) ? defineClip(node, matrix, composition) : undefined;
  const ownPath = includeOwnVector ? vectorPath(node, matrix, composition.vectorSvgs, fillOf(node)) : '';
  const children = renderChildren(document, node, matrix, composition);
  const content = `${ownPath}${children}`;
  return clipId && content ? `<g clip-path="url(#${clipId})">${content}</g>` : content;
}

function renderChildren(document: AgentDocument, parent: AgentNode, parentMatrix: Matrix, composition: Composition): string {
  let activeMaskId: string | undefined;
  const output: string[] = [];
  for (const childId of parent.childIds) {
    const child = document.nodesById[childId];
    if (!child || child.visible === false) continue;
    if (child.mask) {
      activeMaskId = defineMask(document, child, parentMatrix, composition);
      continue;
    }
    const content = renderNode(document, child, parentMatrix, composition);
    if (content) output.push(activeMaskId ? `<g mask="url(#${activeMaskId})">${content}</g>` : content);
  }
  return output.join('');
}

function defineClip(node: AgentNode, matrix: Matrix, composition: Composition): string | undefined {
  const size = sizeOf(node);
  if (!size) return undefined;
  const id = `clip-${composition.nextDefinitionId++}`;
  composition.defs.push(`<clipPath id="${id}">${rectPath(size, matrix, '#ffffff')}</clipPath>`);
  return id;
}

function defineMask(document: AgentDocument, node: AgentNode, parentMatrix: Matrix, composition: Composition): string {
  const id = `mask-${composition.nextDefinitionId++}`;
  const paths = maskPaths(document, node, parentMatrix, composition.vectorSvgs);
  const fallback = paths.length ? '' : rectPath(sizeOf(node), multiply(parentMatrix, matrixOf(node)), '#ffffff');
  composition.defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="#000000"/>${paths.join('') || fallback}</mask>`);
  return id;
}

function maskPaths(document: AgentDocument, node: AgentNode, parentMatrix: Matrix, vectorSvgs: ReadonlyMap<number, string>): string[] {
  if (node.visible === false) return [];
  const matrix = multiply(parentMatrix, matrixOf(node));
  const paths = vectorPath(node, matrix, vectorSvgs, '#ffffff');
  const result = paths ? [paths] : [];
  for (const childId of node.childIds) {
    const child = document.nodesById[childId];
    if (child) result.push(...maskPaths(document, child, matrix, vectorSvgs));
  }
  return result;
}

function vectorPath(node: AgentNode, matrix: Matrix, vectorSvgs: ReadonlyMap<number, string>, fill: string): string {
  const svg = node.vectorRef ? vectorSvgs.get(node.vectorRef.blobId) : undefined;
  return svg ? pathElements(svg, matrix, fill) : '';
}

function withOpacity(content: string, opacity: number | undefined): string {
  return content && typeof opacity === 'number' && opacity >= 0 && opacity < 1 ? `<g opacity="${number(opacity)}">${content}</g>` : content;
}

function clipsContents(node: AgentNode): boolean { return node.frameMaskDisabled === false && node.type === 'FRAME'; }
function pathElements(svg: string, matrix: Matrix, fill: string): string {
  const transform = ` transform="matrix(${matrix.map(number).join(' ')})"`;
  return (svg.match(/<path\b[^>]*>/g) ?? []).map((path) => {
    const colored = path.includes('fill="currentColor"') ? path.replace('fill="currentColor"', `fill="${fill}"`) : path.includes(' fill=') ? path : path.replace(/\/?>(?=$)/, ` fill="${fill}"$&`);
    return colored.replace(/\/?>(?=$)/, `${transform}/>`);
  }).join('');
}
function sizeOf(node: AgentNode | undefined): { x: number; y: number } | undefined {
  const value = node?.bounds;
  return value && typeof value === 'object' && typeof (value as { x?: unknown }).x === 'number' && typeof (value as { y?: unknown }).y === 'number' && (value as { x: number }).x > 0 && (value as { y: number }).y > 0 ? value as { x: number; y: number } : undefined;
}
function rectPath(size: { x: number; y: number } | undefined, matrix: Matrix, fill: string): string {
  return size ? `<path d="M 0 0 H ${number(size.x)} V ${number(size.y)} H 0 Z" fill="${fill}" transform="matrix(${matrix.map(number).join(' ')})"/>` : '';
}
function matrixOf(node: AgentNode): Matrix {
  const value = node.transform as Record<string, unknown> | undefined;
  return value && [value.m00, value.m10, value.m01, value.m11, value.m02, value.m12].every((entry) => typeof entry === 'number') ? [value.m00 as number, value.m10 as number, value.m01 as number, value.m11 as number, value.m02 as number, value.m12 as number] : identity;
}
function multiply([a, b, c, d, e, f]: Matrix, [g, h, i, j, k, l]: Matrix): Matrix { return [a * g + c * h, b * g + d * h, a * i + c * j, b * g + d * j, a * k + c * l + e, b * k + d * l + f]; }
function fillOf(node: AgentNode): string {
  const paints = Array.isArray(node.fills) ? node.fills : [];
  const paint = paints.find((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).type === 'SOLID' && (entry as Record<string, unknown>).visible !== false) as Record<string, unknown> | undefined;
  const color = paint?.color as Record<string, unknown> | undefined;
  if (!color || !['r', 'g', 'b'].every((key) => typeof color[key] === 'number')) return '#000000';
  return `#${[color.r, color.g, color.b].map((value) => Math.round((value as number) * 255).toString(16).padStart(2, '0')).join('')}`;
}
function supportedStyle(node: AgentNode): boolean {
  const effects = Array.isArray(node.effects) ? node.effects : [];
  const strokes = Array.isArray(node.strokes) ? node.strokes : [];
  return !effects.length && !strokes.length && (node.blendMode === undefined || node.blendMode === 'NORMAL' || node.blendMode === 'PASS_THROUGH');
}
interface VectorStatus { vectorOnly: boolean; vectorCount: number; }
const identity: Matrix = [1, 0, 0, 1, 0, 0];
function number(value: number): string { return Number(value.toFixed(4)).toString(); }
