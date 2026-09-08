import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '../..');
const coreEntry = resolve(repositoryRoot, 'packages/core/dist/index.js');
const external = [
  'commander',
  'fontkit',
  'fzstd',
  'kiwi-schema',
  'pixelmatch',
  'pngjs',
  'yauzl',
  'zod',
  '@modelcontextprotocol/sdk',
  '@modelcontextprotocol/sdk/*'
];

await rm(resolve(packageRoot, 'dist'), { recursive: true, force: true });
await mkdir(resolve(packageRoot, 'dist'), { recursive: true });
await build({
  absWorkingDir: repositoryRoot,
  entryPoints: {
    main: resolve(packageRoot, 'src/main.ts'),
    mcp: resolve(repositoryRoot, 'packages/mcp-server/src/main.ts')
  },
  outdir: resolve(packageRoot, 'dist'),
  platform: 'node',
  target: 'node20',
  format: 'esm',
  bundle: true,
  legalComments: 'none',
  alias: { '@figctx/core': coreEntry },
  external
});
