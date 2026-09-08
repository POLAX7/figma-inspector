#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildNodeContext, comparePng, composeBundleVectorGroupSvg, inspectNode, resolveNodeReference, searchNodes, type AgentDocument } from '@figctx/core';
import { z } from 'zod';
import { pageFrameSummaries, pageFrames } from './frame-summaries.js';
import { buildVisualReview, type ReviewPhase } from './review.js';
import { publicToolNames, publicToolSchemas } from './tool-schemas.js';

const root = argument('--root');
if (!root) throw new Error('Usage: figctx-mcp --root <bundle-directory>');
const bundleRoot = root;
const document = JSON.parse(await readFile(`${bundleRoot}/document.agent.json`, 'utf8')) as AgentDocument;
const manifest = JSON.parse(await readFile(`${bundleRoot}/manifest.json`, 'utf8')) as Record<string, unknown>;
const tokenFiles = await Promise.all(['colors', 'typography', 'effects'].map(async (name) => [name, JSON.parse(await readFile(`${bundleRoot}/tokens/${name}.json`, 'utf8')) as { tokens: Array<{ nodeIds: string[] }> }] as const));
const fontFile = JSON.parse(await readFile(`${bundleRoot}/tokens/fonts.json`, 'utf8')) as { fonts: Array<{ nodeIds: string[] }> };
const variableFile = await loadVariables();
const referenceIndex = await loadReferences();
const server = new McpServer({ name: 'figctx-mcp', version: '0.1.0' });
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
server.registerTool(publicToolNames.listFrames, { description: 'List locally extracted frames and canvases in extracted order.', inputSchema: publicToolSchemas.list_frames }, async ({ cursor, limit }) => text(pageFrames(document, { cursor, limit })));
server.registerTool(publicToolNames.listFrameSummaries, { description: 'List compact frame and canvas summaries in sequential batches.', inputSchema: publicToolSchemas.list_frame_summaries }, async ({ cursor, limit }) => text(pageFrameSummaries(document, new Set(referenceIndex.references.map((reference) => reference.nodeId)), { cursor, limit })));
server.registerTool(publicToolNames.searchNodes, { description: 'Search local nodes by case-insensitive name or text substring.', inputSchema: publicToolSchemas.search_nodes }, async ({ query, type, limit }) => text(searchNodes(document, query, { type, limit })));
server.registerTool(publicToolNames.getNodeContext, { description: 'Resolve a local node ID or Figma URL, including an attached reference PNG if available.', inputSchema: publicToolSchemas.get_node_context }, async ({ reference }) => { const node = resolveNodeReference(document, reference); return text({ node, reference: referenceIndex.references.find((item) => item.nodeId === node.id) }); });
server.registerTool(publicToolNames.getFrameBundle, { description: 'Return complete local subtree context, including descendant text, assets, vectors, style tokens, and attached reference PNGs.', inputSchema: publicToolSchemas.get_frame_bundle }, async ({ reference }) => { const context = buildNodeContext(document, resolveNodeReference(document, reference)); return text({ ...context, tokens: tokensFor(context.nodeIds), references: referenceIndex.references.filter((item) => context.nodeIds.includes(item.nodeId)), visualBaseline: manifest.visualBaseline }); });
server.registerTool('review_visual_match', { description: 'Call after the first implementation screenshot and again before completion. Compares an attached Figma reference PNG with candidatePath, returns reference/candidate/diff images and a corrective prompt. When passed is false, revise and call this tool again before declaring completion.', inputSchema: { reference: z.string(), candidatePath: z.string(), phase: z.enum(['midpoint', 'final']) } }, async ({ reference, candidatePath, phase }) => {
  const node = resolveNodeReference(document, reference);
  const attachedReference = referenceIndex.references.find((item) => item.nodeId === node.id);
  if (!attachedReference) throw new Error(`No reference PNG is attached to node ${node.id}`);
  const [referencePng, candidatePng] = await Promise.all([readFile(join(bundleRoot, attachedReference.path)), readFile(candidatePath)]);
  return { content: buildVisualReview({ nodeId: node.id, phase: phase as ReviewPhase, reference: referencePng, candidate: candidatePng, comparison: comparePng(referencePng, candidatePng) }).content };
});
server.registerTool(publicToolNames.getVectorSvg, { description: 'Compose one listed vector-only group into a self-contained SVG without modifying the bundle.', inputSchema: publicToolSchemas.get_vector_svg }, async ({ reference }) => { const node = resolveNodeReference(document, reference); const svg = await composeBundleVectorGroupSvg(bundleRoot, document, node.id); if (!svg) throw new Error(`No renderable vector group matches ${reference}`); return text({ nodeId: node.id, svg }); });
server.registerTool(publicToolNames.getStyleTokens, { description: 'Read extracted token files, font requirements, and Figma variables when present in the local export.' }, async () => text({ ...Object.fromEntries(tokenFiles), fonts: fontFile, variables: variableFile }));
server.registerTool(publicToolNames.getAsset, { description: 'Return the local extracted image path by hash.', inputSchema: publicToolSchemas.get_asset }, async ({ hash }) => {
  const entry = (await readdir(join(bundleRoot, 'assets/images'))).find((name) => name.startsWith(`${hash}.`));
  if (!entry) throw new Error(`Asset not found: ${hash}`);
  return text({ hash, path: `assets/images/${entry}`, absolutePath: join(bundleRoot, 'assets/images', entry) });
});
server.registerTool(publicToolNames.inspectNode, { description: 'Return a bounded local node summary without asset paths or hashes.', inputSchema: publicToolSchemas.inspect_node }, async ({ reference, depth, maxChildren }) => text(inspectNode(document, resolveNodeReference(document, reference), { depth, maxChildren })));
await server.connect(new StdioServerTransport());
function argument(name: string) { const index=process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index+1]; }
function tokensFor(nodeIds: readonly string[]) { const selected = new Set(nodeIds); return { ...Object.fromEntries(tokenFiles.map(([name, file]) => [name, file.tokens.filter((token) => token.nodeIds.some((id) => selected.has(id)))])), fonts: fontFile.fonts.filter((font) => font.nodeIds.some((id) => selected.has(id))), variables: variableFile }; }
async function loadReferences(): Promise<{ references: Array<{ nodeId: string; path: string; width: number; height: number; sha256: string }> }> { try { return JSON.parse(await readFile(join(bundleRoot, 'references/index.json'), 'utf8')) as { references: Array<{ nodeId: string; path: string; width: number; height: number; sha256: string }> }; } catch (error: unknown) { if ((error as { code?: string }).code === 'ENOENT') return { references: [] }; throw error; } }
async function loadVariables(): Promise<{ collections: unknown[]; ungrouped: unknown[] }> { try { return JSON.parse(await readFile(join(bundleRoot, 'tokens/variables.json'), 'utf8')) as { collections: unknown[]; ungrouped: unknown[] }; } catch (error: unknown) { if ((error as { code?: string }).code === 'ENOENT') return { collections: [], ungrouped: [] }; throw error; } }
