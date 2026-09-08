import { createHash } from 'node:crypto';
import type { AgentDocument, AgentNode } from '../normalize/document.js';

export interface StyleToken { id: string; value: unknown; nodeIds: string[]; }
export interface FontRequirement { id: string; family: string; style?: string; postscript?: string; weights: number[]; nodeIds: string[]; }
export interface ExtractedTokens { colors: StyleToken[]; typography: StyleToken[]; effects: StyleToken[]; fonts: FontRequirement[]; }
export interface VariableMode { id: string; name: string; }
export interface VariableValue { modeId: string; value: unknown; dataType?: string; resolvedType?: string; }
export interface VariableDefinition { id: string; name: string; resolvedType?: string; values: VariableValue[]; }
export interface VariableCollection { id: string; name: string; modes: VariableMode[]; variables: VariableDefinition[]; }
export interface ExtractedVariables { collections: VariableCollection[]; ungrouped: VariableDefinition[]; }

export function extractTokens(document: AgentDocument): ExtractedTokens {
  return { colors: collect(document, 'color', (node) => ({ fills: node.fills, strokes: node.strokes })), typography: collect(document, 'typography', (node) => node.typography), effects: collect(document, 'effect', (node) => node.effects), fonts: collectFonts(document) };
}

export function extractVariables(changes: readonly Record<string, unknown>[]): ExtractedVariables {
  const collections = new Map<string, VariableCollection>(changes.filter((change) => change.type === 'VARIABLE_SET').flatMap((change) => {
    const id = guidId(change.guid);
    if (!id) return [];
    const modes = array(record(change.variableSetModes)?.entries ?? change.variableSetModes).flatMap((mode) => {
      const value = record(mode); const modeId = guidId(value?.id);
      return modeId ? [{ id: modeId, name: typeof value?.name === 'string' ? value.name : modeId }] : [];
    });
    return [[id, { id, name: typeof change.name === 'string' ? change.name : id, modes, variables: [] } satisfies VariableCollection] as const];
  }));
  const ungrouped: VariableDefinition[] = [];
  for (const change of changes) {
    if (change.type !== 'VARIABLE') continue;
    const id = guidId(change.guid);
    if (!id) continue;
    const values = array(record(change.variableDataValues)?.entries).flatMap((entry) => {
      const value = record(entry); const modeId = guidId(value?.modeID); const variableData = record(value?.variableData);
      return modeId && variableData ? [{ modeId, value: variableData.value, ...(typeof variableData.dataType === 'string' ? { dataType: variableData.dataType } : {}), ...(typeof variableData.resolvedDataType === 'string' ? { resolvedType: variableData.resolvedDataType } : {}) }] : [];
    }).sort((a, b) => a.modeId.localeCompare(b.modeId));
    const variable: VariableDefinition = { id, name: typeof change.name === 'string' ? change.name : id, ...(typeof change.variableResolvedType === 'string' ? { resolvedType: change.variableResolvedType } : {}), values };
    const collectionId = guidId(record(change.variableSetID)?.guid);
    const collection = collectionId ? collections.get(collectionId) : undefined;
    if (collection) collection.variables.push(variable); else ungrouped.push(variable);
  }
  return {
    collections: [...collections.values()].map((collection) => ({ ...collection, modes: collection.modes.sort((a, b) => a.id.localeCompare(b.id)), variables: collection.variables.sort((a, b) => a.id.localeCompare(b.id)) })).sort((a, b) => a.id.localeCompare(b.id)),
    ungrouped: ungrouped.sort((a, b) => a.id.localeCompare(b.id))
  };
}
function collectFonts(document: AgentDocument): FontRequirement[] {
  const requirements = new Map<string, FontRequirement>();
  for (const node of Object.values(document.nodesById)) {
    const name = node.typography?.fontName;
    if (!name || typeof name !== 'object' || Array.isArray(name)) continue;
    const font = name as Record<string, unknown>; const family = typeof font.family === 'string' ? font.family : undefined;
    if (!family) continue;
    const style = typeof font.style === 'string' ? font.style : undefined; const postscript = typeof font.postscript === 'string' ? font.postscript : undefined;
    const id = `font_${createHash('sha256').update(`${family}\0${style ?? ''}\0${postscript ?? ''}`).digest('hex').slice(0, 12)}`;
    const weight = fontWeight(node); const found = requirements.get(id);
    if (found) { found.nodeIds.push(node.id); if (weight !== undefined && !found.weights.includes(weight)) found.weights.push(weight); }
    else requirements.set(id, { id, family, ...(style ? { style } : {}), ...(postscript ? { postscript } : {}), weights: weight === undefined ? [] : [weight], nodeIds: [node.id] });
  }
  return [...requirements.values()].map((font) => ({ ...font, weights: font.weights.sort((a, b) => a - b), nodeIds: font.nodeIds.sort() })).sort((a, b) => a.id.localeCompare(b.id));
}
function fontWeight(node: AgentDocument['nodesById'][string]): number | undefined { const metadata = node.textLayout?.fontMetaData; if (!Array.isArray(metadata)) return undefined; const value = (metadata[0] as Record<string, unknown> | undefined)?.fontWeight; return typeof value === 'number' ? value : undefined; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function guidId(value: unknown): string | undefined { const guid = record(value); return typeof guid?.sessionID === 'number' && typeof guid.localID === 'number' ? `${guid.sessionID}:${guid.localID}` : undefined; }
function collect(document: AgentDocument, prefix: string, select: (node: AgentNode) => unknown): StyleToken[] {
  const tokens = new Map<string, StyleToken>();
  for (const node of Object.values(document.nodesById)) {
    const value = select(node); if (!meaningful(value)) continue;
    const id = `${prefix}_${createHash('sha256').update(stable(value)).digest('hex').slice(0, 12)}`;
    const token = tokens.get(id); if (token) token.nodeIds.push(node.id); else tokens.set(id, { id, value, nodeIds: [node.id] });
  }
  return [...tokens.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function meaningful(value: unknown): boolean { return Array.isArray(value) ? value.length > 0 : Boolean(value && typeof value === 'object' && Object.keys(value).length > 0); }
function stable(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`; return JSON.stringify(value); }
