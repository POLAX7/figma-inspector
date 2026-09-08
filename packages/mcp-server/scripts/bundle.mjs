import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryRoot = resolve(packageRoot, '../..');

await build({
  absWorkingDir: repositoryRoot,
  entryPoints: { main: resolve(packageRoot, 'src/main.ts') },
  outfile: resolve(packageRoot, 'dist/main.js'),
  platform: 'node',
  target: 'node20',
  format: 'esm',
  bundle: true,
  legalComments: 'none',
  alias: { '@figctx/core': resolve(repositoryRoot, 'packages/core/src/index.ts') },
  external: [
    '@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/*', 'zod',
    'fzstd', 'kiwi-schema', 'pixelmatch', 'pngjs', 'yauzl'
  ]
});
