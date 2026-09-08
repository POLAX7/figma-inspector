#!/usr/bin/env node
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { openSync } from 'fontkit';
import { Command } from 'commander';
import { auditFontRequirements, buildNodeContext, comparePng, composeBundleVectorGroupSvg, describePng, doctorBundle, extractFig, FigctxError, resolveNodeReference, searchNodes, type AgentDocument, type AvailableFont, type FontRequirement } from '@figctx/core';
import { mismatchRatio, positiveInteger } from './options.js';

const program = new Command().name('figctx').description('Extract local Figma .fig context bundles');
program.command('extract <file>').requiredOption('--out <directory>').action(async (file, options) => {
  const result = await extractFig(file, options.out);
  process.stdout.write(JSON.stringify({ out: result.outDir, nodes: Object.keys(result.agent.nodesById).length }) + '\n');
});
program.command('resolve <bundle> <reference>').action(async (bundle, reference) => {
  const document = await loadDocument(bundle); process.stdout.write(JSON.stringify(resolveNodeReference(document, reference), null, 2) + '\n');
});
program.command('inspect <bundle>').requiredOption('--node <reference>').action(async (bundle, options) => {
  const document = await loadDocument(bundle); process.stdout.write(JSON.stringify(resolveNodeReference(document, options.node), null, 2) + '\n');
});
program.command('search <bundle> <query>').option('--type <type>', 'Filter by node type').option('--limit <number>', 'Maximum results', positiveInteger).action(async (bundle, query, options) => {
  const document = await loadDocument(bundle); process.stdout.write(JSON.stringify(searchNodes(document, query, options), null, 2) + '\n');
});
program.command('pack <bundle>').requiredOption('--node <reference>').requiredOption('--format <format>').action(async (bundle, options) => {
  if (options.format !== 'codex') throw new FigctxError('NODE_NOT_FOUND', `Unsupported pack format: ${options.format}`);
  const document = await loadDocument(bundle); const context = buildNodeContext(document, resolveNodeReference(document, options.node));
  const [tokens, manifest, references] = await Promise.all([loadTokens(bundle, context.nodeIds), loadManifest(bundle), loadReferences(bundle)]);
  process.stdout.write(JSON.stringify({ format: 'codex', ...context, tokens, references: references.references.filter((reference) => context.nodeIds.includes(reference.nodeId)), visualBaseline: typeof manifest.visualBaseline === 'string' ? manifest.visualBaseline : undefined }, null, 2) + '\n');
});
program.command('render <bundle>').requiredOption('--node <reference>').action(async (bundle, options) => {
  const document = await loadDocument(bundle); const node = resolveNodeReference(document, options.node); const svg = await composeBundleVectorGroupSvg(bundle, document, node.id);
  if (!svg) throw new FigctxError('NODE_NOT_FOUND', `No renderable vector group matches ${options.node}.`);
  process.stdout.write(svg + '\n');
});
program.command('reference <bundle>').requiredOption('--node <reference>').requiredOption('--image <png>').action(async (bundle, options) => {
  const document = await loadDocument(bundle); const node = resolveNodeReference(document, options.node);
  const bytes = await readFile(options.image); const description = describePng(bytes); const path = `references/${safeName(node.id)}.png`;
  await mkdir(dirname(join(bundle, path)), { recursive: true }); await copyFile(options.image, join(bundle, path));
  const index = await loadReferences(bundle); const entry = { nodeId: node.id, path, ...description }; const entries = index.references.filter((item) => item.nodeId !== node.id); entries.push(entry); entries.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  await writeJsonAtomic(join(bundle, 'references/index.json'), { contractVersion: '1', references: entries }); process.stdout.write(JSON.stringify(entry) + '\n');
});
program.command('compare <bundle>').requiredOption('--node <reference>').requiredOption('--candidate <png>').option('--threshold <number>', 'Pixelmatch threshold from 0 to 1', '0.1').option('--max-mismatch-ratio <number>', 'Fail when mismatch ratio exceeds this value', mismatchRatio).action(async (bundle, options) => {
  const document = await loadDocument(bundle); const node = resolveNodeReference(document, options.node); const reference = (await loadReferences(bundle)).references.find((item) => item.nodeId === node.id);
  if (!reference) throw new FigctxError('REFERENCE_NOT_FOUND', `No reference PNG is attached to node ${node.id}.`);
  const threshold = Number(options.threshold); if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new FigctxError('INVALID_REFERENCE_IMAGE', '--threshold must be between 0 and 1.');
  const result = comparePng(await readFile(join(bundle, reference.path)), await readFile(options.candidate), threshold); const outputDirectory = join(bundle, 'comparisons', safeName(node.id));
  await mkdir(outputDirectory, { recursive: true }); await writeFile(join(outputDirectory, 'diff.png'), result.diffPng); const report = { nodeId: node.id, reference, candidate: resolve(options.candidate), threshold, ...result, diffPng: undefined, diffPath: `comparisons/${safeName(node.id)}/diff.png` }; delete (report as { diffPng?: unknown }).diffPng;
  await writeJsonAtomic(join(outputDirectory, 'report.json'), report); process.stdout.write(JSON.stringify(report, null, 2) + '\n'); if (options.maxMismatchRatio !== undefined && result.mismatchRatio > options.maxMismatchRatio) process.exitCode = 2;
});
program.command('doctor <bundle>').action(async (bundle) => {
  const report = await doctorBundle(bundle); process.stdout.write(JSON.stringify(report, null, 2) + '\n'); if (!report.ok) process.exitCode = 1;
});
program.command('font-check <bundle>').requiredOption('--font-dir <directory>').action(async (bundle, options) => {
  const requirements = (JSON.parse(await readFile(join(bundle, 'tokens/fonts.json'), 'utf8')) as { fonts: FontRequirement[] }).fonts;
  const fonts = await readFonts(options.fontDir); const audit = auditFontRequirements(requirements, fonts);
  process.stdout.write(JSON.stringify({ ...audit, scannedFiles: fonts.length }, null, 2) + '\n'); if (audit.missing.length) process.exitCode = 2;
});
program.parseAsync().catch((error: unknown) => { const message = error instanceof FigctxError ? `ERROR ${error.code}: ${error.message}` : String(error); process.stderr.write(`${message}\n`); process.exitCode = 1; });
async function loadDocument(bundle: string): Promise<AgentDocument> { return JSON.parse(await readFile(`${bundle}/document.agent.json`, 'utf8')) as AgentDocument; }
async function loadTokens(bundle: string, nodeIds: readonly string[]) {
  const names = ['colors', 'typography', 'effects'];
  const documents = await Promise.all(names.map(async (name) => [name, JSON.parse(await readFile(`${bundle}/tokens/${name}.json`, 'utf8')) as { tokens: Array<{ nodeIds: string[] }> }] as const));
  const fonts = JSON.parse(await readFile(`${bundle}/tokens/fonts.json`, 'utf8')) as { fonts: Array<{ nodeIds: string[] }> };
  const variables = await loadVariables(bundle);
  const selected = new Set(nodeIds);
  return { ...Object.fromEntries(documents.map(([name, value]) => [name, value.tokens.filter((token) => token.nodeIds.some((id) => selected.has(id)))])), fonts: fonts.fonts.filter((font) => font.nodeIds.some((id) => selected.has(id))), variables };
}
async function loadManifest(bundle: string): Promise<Record<string, unknown>> { return JSON.parse(await readFile(`${bundle}/manifest.json`, 'utf8')) as Record<string, unknown>; }
interface ReferenceEntry { nodeId: string; path: string; width: number; height: number; sha256: string; }
async function loadReferences(bundle: string): Promise<{ references: ReferenceEntry[] }> { try { return JSON.parse(await readFile(join(bundle, 'references/index.json'), 'utf8')) as { references: ReferenceEntry[] }; } catch (error: unknown) { if ((error as { code?: string }).code === 'ENOENT') return { references: [] }; throw error; } }
async function loadVariables(bundle: string): Promise<{ collections: unknown[]; ungrouped: unknown[] }> { try { return JSON.parse(await readFile(join(bundle, 'tokens/variables.json'), 'utf8')) as { collections: unknown[]; ungrouped: unknown[] }; } catch (error: unknown) { if ((error as { code?: string }).code === 'ENOENT') return { collections: [], ungrouped: [] }; throw error; } }
async function writeJsonAtomic(path: string, value: unknown) { const temporary = `${path}.tmp-${process.pid}-${Date.now()}`; await writeFile(temporary, JSON.stringify(value, null, 2)); await rename(temporary, path); }
function safeName(value: string) { return value.replace(/[^a-zA-Z0-9._-]/g, '_'); }
async function readFonts(directory: string): Promise<AvailableFont[]> {
  const files = await fontFiles(directory); const fonts: AvailableFont[] = [];
  for (const path of files) { try { const opened = openSync(path); const family = 'fonts' in opened ? opened.fonts : [opened]; for (const font of family) fonts.push({ family: font.familyName, style: font.subfamilyName, postscript: font.postscriptName, path }); } catch { /* malformed or unsupported font is ignored; it cannot satisfy a requirement */ } }
  return fonts;
}
async function fontFiles(directory: string): Promise<string[]> { const entries = await readdir(directory, { withFileTypes: true }); const nested = await Promise.all(entries.map(async (entry) => entry.isDirectory() ? fontFiles(join(directory, entry.name)) : /\.(ttf|otf|woff2?)$/i.test(entry.name) ? [join(directory, entry.name)] : [])); return nested.flat(); }
