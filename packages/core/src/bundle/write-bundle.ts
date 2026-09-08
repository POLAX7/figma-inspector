import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { extensionForAsset, type AssetFormat } from '../assets.js';
import { FigctxError } from '../errors.js';
import type { AgentDocument } from '../normalize/document.js';
import type { ExtractedTokens, ExtractedVariables } from '../tokens/extract.js';

export interface BundleImage { hash: string; bytes: Uint8Array; format: AssetFormat; }
export interface BundleVector { blobId: number; bytes: Uint8Array; }
export interface BundleSvgVector { blobId: number; svg: string; }
export interface BundleInput { outDir: string; manifest: Record<string, unknown>; raw: unknown; agent: AgentDocument; images: readonly BundleImage[]; vectors: readonly BundleVector[]; svgVectors?: readonly BundleSvgVector[]; thumbnail?: Uint8Array; tokens: ExtractedTokens; variables?: ExtractedVariables; }

export async function writeBundle(input: BundleInput): Promise<void> {
  if (await exists(input.outDir)) throw new FigctxError('OUTPUT_EXISTS', `Output directory exists: ${input.outDir}`);
  const temporary = `${input.outDir}.tmp-${process.pid}-${Date.now()}`;
  try {
    await mkdir(join(temporary, 'assets/images'), { recursive: true });
    await mkdir(join(temporary, 'assets/vectors'), { recursive: true });
    await mkdir(join(temporary, 'frames'), { recursive: true });
    await writeJson(join(temporary, 'manifest.json'), input.manifest);
    await writeJson(join(temporary, 'document.raw.json'), input.raw);
    await writeJson(join(temporary, 'document.agent.json'), input.agent);
    await writeJson(join(temporary, 'tokens/colors.json'), { contractVersion: '1', tokens: input.tokens.colors });
    await writeJson(join(temporary, 'tokens/typography.json'), { contractVersion: '1', tokens: input.tokens.typography });
    await writeJson(join(temporary, 'tokens/effects.json'), { contractVersion: '1', tokens: input.tokens.effects });
    await writeJson(join(temporary, 'tokens/fonts.json'), { contractVersion: '1', fonts: input.tokens.fonts });
    await writeJson(join(temporary, 'tokens/variables.json'), { contractVersion: '1', ...(input.variables ?? { collections: [], ungrouped: [] }) });
    const imageIndex: Array<{ hash: string; path: string; format: AssetFormat }> = [];
    for (const image of input.images) {
      const extension = extensionForAsset(image.format) ?? 'bin';
      const path = `assets/images/${image.hash}.${extension}`;
      await writeFile(join(temporary, path), image.bytes);
      imageIndex.push({ hash: image.hash, path, format: image.format });
    }
    await writeJson(join(temporary, 'assets/images.json'), { contractVersion: '1', images: imageIndex });
    const svgByBlobId = new Map(input.svgVectors?.map((vector) => [vector.blobId, vector.svg]));
    const vectorIndex: Array<{ blobId: number; path: string; format: 'kiwi-vector-network'; compression: 'gzip'; svgPath?: string }> = [];
    for (const vector of input.vectors) {
      const path = `assets/vectors/vector-network-${vector.blobId}.bin.gz`;
      const svgPath = `assets/vectors/vector-network-${vector.blobId}.svg`;
      await writeFile(join(temporary, path), await gzipBytes(vector.bytes));
      const svg = svgByBlobId.get(vector.blobId);
      if (svg) await writeFile(join(temporary, svgPath), svg);
      vectorIndex.push({ blobId: vector.blobId, path, format: 'kiwi-vector-network', compression: 'gzip', ...(svg ? { svgPath } : {}) });
    }
    await writeJson(join(temporary, 'assets/vectors.json'), { contractVersion: '1', vectors: vectorIndex });
    if (input.thumbnail) await writeFile(join(temporary, 'assets/thumbnail.png'), input.thumbnail);
    for (const node of Object.values(input.agent.nodesById).filter((node) => isSummaryRoot(node, input.agent))) {
      const directory = join(temporary, 'frames', safeName(node.id));
      await mkdir(directory, { recursive: true });
      const assets = node.assetRefs.map((asset) => `- asset: \`${asset.path}\` (${asset.hash})`).join('\n');
      await writeFile(join(directory, 'context.md'), `# ${node.name}\n\n- id: \`${node.id}\`\n- type: ${node.type}\n- children: ${node.childIds.length}${assets ? `\n${assets}` : ''}\n`);
    }
    await mkdir(dirname(input.outDir), { recursive: true });
    await rename(temporary, input.outDir);
  } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
}
async function writeJson(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value, jsonReplacer, 2)); }
function jsonReplacer(_key: string, value: unknown) { if (typeof value === 'bigint') return value.toString(); if (value instanceof Uint8Array) return { byteLength: value.byteLength }; return value; }
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
function safeName(value: string) { return value.replace(/[^a-zA-Z0-9._-]/g, '_'); }
const gzipBytes = promisify(gzip);
function isSummaryRoot(node: AgentDocument['nodesById'][string], document: AgentDocument): boolean {
  if (node.type === 'CANVAS') return true;
  if (node.type !== 'FRAME') return false;
  const parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  return parent?.type !== 'FRAME';
}
