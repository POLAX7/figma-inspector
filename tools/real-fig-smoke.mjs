#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const mcpRequire = createRequire(join(root, 'packages/mcp-server/package.json'));
const sha256 = /^[a-f0-9]{64}$/;

export function validateFixtureContract(contract) {
  assert(record(contract), 'Fixture contract must be an object.');
  assert(nonEmpty(contract.releaseTag), 'Fixture contract releaseTag must be non-empty.');
  assert(nonEmpty(contract.assetName), 'Fixture contract assetName must be non-empty.');
  for (const name of ['assetSha256', 'sourceSha256']) assert(sha256.test(contract[name]), `Fixture contract ${name} must be a SHA-256 checksum.`);
  assert(record(contract.minimums), 'Fixture contract minimums must be an object.');
  for (const name of ['nodes', 'images', 'vectors']) assert(Number.isInteger(contract.minimums[name]) && contract.minimums[name] >= 0, `Fixture contract minimums.${name} must be a non-negative integer.`);
  assert(record(contract.outputSha256) && Object.keys(contract.outputSha256).length, 'Fixture contract outputSha256 must not be empty.');
  for (const [path, hash] of Object.entries(contract.outputSha256)) assert(nonEmpty(path) && sha256.test(hash), `Fixture contract checksum for ${path} must be a SHA-256 checksum.`);
  return contract;
}

async function main() {
  const fig = requiredEnvironment('FIGCTX_ACCEPTANCE_FIG');
  await access(fig);
  const contract = validateFixtureContract(await json(join(root, 'tests/acceptance/fixture-contract.json')));
  assert.equal(basename(fig), contract.assetName, 'Downloaded fixture filename does not match its contract.');
  assert.equal(await fileHash(fig), contract.assetSha256, 'Downloaded fixture checksum does not match its contract.');

  const temporary = await mkdtemp(join(tmpdir(), 'figctx-acceptance-'));
  const bundle = join(temporary, 'bundle');
  await cli(['extract', fig, '--out', bundle]);
  await cli(['doctor', bundle]);

  const manifest = await json(join(bundle, 'manifest.json'));
  const document = await json(join(bundle, 'document.agent.json'));
  const images = await json(join(bundle, 'assets/images.json'));
  const vectors = await json(join(bundle, 'assets/vectors.json'));
  const probe = await selectProbe(bundle, document, images);

  assert.equal(manifest.sourceSha256, contract.sourceSha256, 'Extracted source checksum differs from the fixture contract.');
  assertAtLeast(Object.keys(document.nodesById).length, contract.minimums.nodes, 'nodes');
  assertAtLeast(images.images.length, contract.minimums.images, 'images');
  assertAtLeast(vectors.vectors.length, contract.minimums.vectors, 'vectors');
  for (const [path, expected] of Object.entries(contract.outputSha256)) {
    const actual = path === 'rendered-vector.svg' ? textHash(probe.vectorSvg) : await fileHash(join(bundle, path));
    assert.equal(actual, expected, `Extracted output checksum differs for ${path}.`);
  }

  const thumbnail = await exerciseCli(bundle, probe);
  await exerciseMcp(bundle, probe, thumbnail);
  process.stdout.write(`Real Figma acceptance passed (nodes=${Object.keys(document.nodesById).length}, images=${images.images.length}, vectors=${vectors.vectors.length}).\n`);
}

async function selectProbe(bundle, document, images) {
  const rootId = document.rootIds[0];
  assert(nonEmpty(rootId), 'Extracted document has no root node.');
  const searchable = Object.values(document.nodesById).map((node) => node.text || node.name).find((value) => typeof value === 'string' && value.trim().length >= 3);
  assert(nonEmpty(searchable), 'Extracted document has no searchable node name or text.');
  const assetHash = images.images[0]?.hash;
  assert(typeof assetHash === 'string' && assetHash.length === 40, 'Extracted document has no image asset.');
  const { composeBundleVectorGroupSvg, findVectorGroups } = await import(pathToFileURL(join(root, 'packages/core/dist/index.js')).href);
  const vectorGroup = findVectorGroups(document, rootId)[0];
  assert(vectorGroup, 'Extracted document has no renderable vector group.');
  const vectorSvg = await composeBundleVectorGroupSvg(bundle, document, vectorGroup.nodeId);
  assert(vectorSvg?.startsWith('<svg'), 'Extracted vector group did not produce SVG.');
  return { rootId, query: searchable.trim().slice(0, 12), assetHash, vectorNodeId: vectorGroup.nodeId, vectorSvg };
}

async function exerciseCli(bundle, probe) {
  await cli(['resolve', bundle, probe.rootId]);
  await cli(['inspect', bundle, '--node', probe.rootId]);
  await cli(['search', bundle, probe.query, '--limit', '1']);
  await cli(['pack', bundle, '--node', probe.rootId, '--format', 'codex']);
  await cli(['render', bundle, '--node', probe.vectorNodeId]);
  const thumbnail = join(bundle, 'assets/thumbnail.png');
  await access(thumbnail);
  await cli(['reference', bundle, '--node', probe.rootId, '--image', thumbnail]);
  await cli(['compare', bundle, '--node', probe.rootId, '--candidate', thumbnail, '--max-mismatch-ratio', '0']);
  const fontDirectory = join(bundle, 'acceptance-empty-fonts');
  await mkdir(fontDirectory);
  const fonts = await json(join(bundle, 'tokens/fonts.json'));
  const fontCheck = await cli(['font-check', bundle, '--font-dir', fontDirectory], true);
  assert.equal(fontCheck.code, fonts.fonts.length ? 2 : 0, 'font-check did not report the expected missing-font result.');
  await cli(['doctor', bundle]);
  return thumbnail;
}

async function exerciseMcp(bundle, probe, thumbnail) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(mcpRequire.resolve('@modelcontextprotocol/sdk/client/index.js')),
    import(mcpRequire.resolve('@modelcontextprotocol/sdk/client/stdio.js'))
  ]);
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'packages/mcp-server/dist/main.js'), '--root', bundle], stderr: 'pipe' });
  const client = new Client({ name: 'figctx-real-acceptance', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), ['list_frames', 'list_frame_summaries', 'search_nodes', 'get_node_context', 'get_frame_bundle', 'review_visual_match', 'get_vector_svg', 'get_style_tokens', 'get_asset', 'inspect_node']);
    assert(Array.isArray(await toolJson(client, 'list_frames')));
    assert(Array.isArray((await toolJson(client, 'list_frame_summaries', { limit: 1 })).items));
    assert((await toolJson(client, 'search_nodes', { query: probe.query, limit: 1 })).length > 0);
    assert.equal((await toolJson(client, 'get_node_context', { reference: probe.rootId })).node.id, probe.rootId);
    assert((await toolJson(client, 'get_frame_bundle', { reference: probe.rootId })).nodeIds.includes(probe.rootId));
    const review = await client.callTool({ name: 'review_visual_match', arguments: { reference: probe.rootId, candidatePath: thumbnail, phase: 'final' } });
    assert(review.content.some((item) => item.type === 'image'));
    assert(review.content.some((item) => item.type === 'text'));
    assert((await toolJson(client, 'get_vector_svg', { reference: probe.vectorNodeId })).svg.startsWith('<svg'));
    assert(record(await toolJson(client, 'get_style_tokens')));
    assert.equal((await toolJson(client, 'get_asset', { hash: probe.assetHash })).hash, probe.assetHash);
    assert.equal((await toolJson(client, 'inspect_node', { reference: probe.rootId, depth: 0, maxChildren: 1 })).selection.id, probe.rootId);
  } finally {
    await client.close();
  }
}

async function toolJson(client, name, arguments_ = {}) {
  const result = await client.callTool({ name, arguments: arguments_ });
  const content = result.content[0];
  assert.equal(content?.type, 'text', `MCP tool ${name} did not return text content.`);
  return JSON.parse(content.text);
}

async function cli(args, allowFailure = false) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'packages/cli/dist/main.js'), ...args], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0 && !allowFailure) throw new Error(`figctx ${args[0]} failed with exit code ${code}.`);
  return { code };
}

async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function fileHash(path) { return textHash(await readFile(path)); }
function textHash(value) { return createHash('sha256').update(value).digest('hex'); }
function requiredEnvironment(name) { const value = process.env[name]; assert(nonEmpty(value), `${name} must point to the downloaded private .fig fixture.`); return value; }
function assertAtLeast(actual, minimum, name) { assert(actual >= minimum, `Expected at least ${minimum} ${name}, received ${actual}.`); }
function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0; }
function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`Real Figma acceptance failed: ${error.message}\n`); process.exitCode = 1; });
