import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  resolve: {
    alias: {
      '@figctx/core': resolve(packageRoot, '../core/src/index.ts')
    }
  }
});
