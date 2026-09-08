import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the public CLI manifest declares both executable entry points', async () => {
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, 'packages/cli/package.json'), 'utf8'));
  assert.equal(manifest.name, 'figctx');
  assert.deepEqual(manifest.bin, { figctx: './dist/main.js', 'figctx-mcp': './dist/mcp.js' });
  assert.deepEqual(manifest.files, ['dist', 'README.md', 'LICENSE']);
  assert.equal(manifest.publishConfig.access, 'public');
  assert.equal(manifest.engines.node, '>=20');
});
