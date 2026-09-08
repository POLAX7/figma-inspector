import { basename } from 'node:path';
import { readFigArchive } from './archive/read-archive.js';
import { writeBundle } from './bundle/write-bundle.js';
import { decodeKiwiCanvas } from './decoder/kiwi.js';
import { expandLocalInstances, normalizeDocument, type AgentDocument } from './normalize/document.js';
import { extensionForAsset } from './assets.js';
import { extractTokens, extractVariables } from './tokens/extract.js';
import { vectorNetworkToSvg } from './vectors/svg.js';

export interface ExtractionResult { agent: AgentDocument; outDir: string; }

export async function extractFig(sourcePath: string, outDir: string): Promise<ExtractionResult> {
  const archive = await readFigArchive(sourcePath);
  const decoded = decodeKiwiCanvas(archive.canvas);
  const assetPaths = Object.fromEntries(archive.images.map((image) => [image.hash, `assets/images/${image.hash}.${extensionForAsset(image.format) ?? 'bin'}`]));
  const originFileKey = typeof decoded.document.originFileKey === 'string' ? decoded.document.originFileKey : undefined;
  const referencedVectorBlobs = new Set(decoded.nodeChanges.flatMap((change) => {
    const vectorData = change.vectorData;
    const blobId = vectorData && typeof vectorData === 'object' && !Array.isArray(vectorData) ? (vectorData as Record<string, unknown>).vectorNetworkBlob : undefined;
    return typeof blobId === 'number' ? [blobId] : [];
  }));
  const vectors = decoded.blobs.flatMap((blob, blobId) => {
    if (!referencedVectorBlobs.has(blobId)) return [];
    const bytes = blob && typeof blob === 'object' && 'bytes' in blob && (blob as { bytes?: unknown }).bytes instanceof Uint8Array ? (blob as { bytes: Uint8Array }).bytes : undefined;
    return bytes ? [{ blobId, bytes }] : [];
  });
  const vectorPaths = Object.fromEntries(vectors.map((vector) => [vector.blobId, `assets/vectors/vector-network-${vector.blobId}.bin.gz`]));
  const vectorNodes = new Map(decoded.nodeChanges.flatMap((change) => {
    const blobId = record(change.vectorData)?.vectorNetworkBlob;
    return typeof blobId === 'number' ? [[blobId, change] as const] : [];
  }));
  const svgVectors = vectors.flatMap((vector) => {
    const svg = vectorSvg(vectorNodes.get(vector.blobId), vector.bytes);
    return svg ? [{ blobId: vector.blobId, svg }] : [];
  });
  const vectorSvgPaths = Object.fromEntries(svgVectors.map((vector) => [vector.blobId, `assets/vectors/vector-network-${vector.blobId}.svg`]));
  const agent = expandLocalInstances(normalizeDocument(decoded.nodeChanges, { originFileKey, assetPaths, vectorPaths, vectorSvgPaths }));
  const variables = extractVariables(decoded.nodeChanges);
  const warnings = agent.nodesById && Object.values(agent.nodesById).some((node) => node.styleRefs) && !decoded.nodeChanges.some((change) => change.type === 'STYLE')
    ? ['STYLE_DEFINITIONS_UNAVAILABLE']
    : [];
  await writeBundle({
    outDir,
    manifest: { contractVersion: '1', parserVersion: decoded.decoderVersion, status: 'success', sourceFilename: basename(sourcePath), sourceSha256: archive.sourceSha256, ...(originFileKey ? { originFileKey } : {}), canvasVariant: archive.canvasVariant, nodeCount: decoded.nodeChanges.length, visualBaseline: archive.thumbnail ? 'assets/thumbnail.png' : undefined, ...(warnings.length ? { warnings } : {}) },
    raw: { decoderVersion: decoded.decoderVersion, canvasVersion: decoded.canvasVersion, document: decoded.document },
    agent,
    images: archive.images, vectors, svgVectors, thumbnail: archive.thumbnail, tokens: extractTokens(agent), variables
  });
  return { agent, outDir };
}

function vectorSvg(node: Record<string, unknown> | undefined, bytes: Uint8Array): string | undefined {
  const size = record(node?.size);
  return typeof size?.x === 'number' && typeof size.y === 'number' ? vectorNetworkToSvg(bytes, { x: size.x, y: size.y }) : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
