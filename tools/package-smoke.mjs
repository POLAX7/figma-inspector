import assert from 'node:assert/strict';
import { spawn, execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliRoot = join(repositoryRoot, 'packages/cli');
const temporary = await mkdtemp(join(tmpdir(), 'figctx-package-smoke-'));

try {
  const tarball = await pack();
  await verifyContents(tarball);
  const prefix = join(temporary, 'prefix');
  await install(tarball, prefix);
  await runHelp(command(prefix, 'figctx'));
  await verifyMcp(command(prefix, 'figctx-mcp'));
  process.stdout.write(`Package smoke test passed: ${tarball}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function pack() {
  await execFile('pnpm', ['--dir', cliRoot, 'pack', '--pack-destination', temporary], { cwd: repositoryRoot });
  const files = await readdir(temporary);
  const tarball = files.find((file) => file.endsWith('.tgz'));
  assert.ok(tarball, 'pnpm pack did not create a tarball.');
  return join(temporary, tarball);
}

async function verifyContents(tarball) {
  const unpacked = join(temporary, 'unpacked');
  await mkdir(unpacked);
  const { stdout } = await execFile('tar', ['-tzf', tarball]);
  const entries = stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.ok(entries.includes('package/package.json'));
  assert.ok(entries.includes('package/README.md'));
  assert.ok(entries.includes('package/LICENSE'));
  assert.ok(entries.includes('package/dist/main.js'));
  assert.ok(entries.includes('package/dist/mcp.js'));
  assert.ok(entries.every((entry) => !entry.includes('node_modules/') && !entry.endsWith('.fig') && !entry.includes('/test/') && !entry.includes('/tests/')),
    `Tarball contains excluded files: ${entries.join(', ')}`);
  await execFile('tar', ['-xzf', tarball, '-C', unpacked]);
  const manifest = JSON.parse(await readFile(join(unpacked, 'package/package.json'), 'utf8'));
  assert.equal(manifest.name, 'figctx');
  assert.equal(manifest.bin.figctx, './dist/main.js');
  assert.equal(manifest.bin['figctx-mcp'], './dist/mcp.js');
  assert.equal(JSON.stringify(manifest.dependencies).includes('workspace:'), false, 'Published dependencies must not contain workspace: references.');
}

async function install(tarball, prefix) {
  await execFile('npm', ['install', '--global', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', prefix, tarball], { cwd: repositoryRoot });
}

function command(prefix, name) {
  return process.platform === 'win32' ? join(prefix, `${name}.cmd`) : join(prefix, 'bin', name);
}

async function runHelp(binary) {
  const { stdout } = await execFile(binary, ['--help']);
  assert.match(stdout, /Extract local Figma/);
}

async function verifyMcp(binary) {
  const bundle = join(temporary, 'bundle');
  await mkdir(join(bundle, 'tokens'), { recursive: true });
  await Promise.all([
    writeFile(join(bundle, 'manifest.json'), '{}'),
    writeFile(join(bundle, 'document.agent.json'), JSON.stringify({ contractVersion: '1', rootIds: ['1:1'], nodesById: {
      '1:1': { id: '1:1', name: 'Frame', type: 'FRAME', childIds: [], zIndex: 0, assetRefs: [] }
    } })),
    ...['colors', 'typography', 'effects'].map((name) => writeFile(join(bundle, `tokens/${name}.json`), JSON.stringify({ tokens: [] }))),
    writeFile(join(bundle, 'tokens/fonts.json'), JSON.stringify({ fonts: [] }))
  ]);
  const child = spawn(binary, ['--root', bundle], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const initialize = await request(child, 1, 'initialize', {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'figctx-package-smoke', version: '1.0.0' }
    });
    assert.equal(initialize.result.serverInfo.name, 'figctx-mcp');
    const tools = await request(child, 2, 'tools/list', {});
    assert.ok(tools.result.tools.some((tool) => tool.name === 'inspect_node'));
  } finally {
    child.kill();
  }
}

function request(child, id, method, params) {
  return new Promise((resolveRequest, rejectRequest) => {
    let buffer = '';
    const timeout = setTimeout(() => rejectRequest(new Error(`Timed out waiting for MCP ${method} response.`)), 10_000);
    const onData = (chunk) => {
      buffer += chunk.toString();
      for (const line of buffer.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === id) {
            clearTimeout(timeout);
            child.stdout.off('data', onData);
            resolveRequest(message);
            return;
          }
        } catch { /* wait for a complete JSON-RPC line */ }
      }
      buffer = buffer.includes('\n') ? buffer.slice(buffer.lastIndexOf('\n') + 1) : buffer;
    };
    child.once('error', rejectRequest);
    child.stdout.on('data', onData);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}
