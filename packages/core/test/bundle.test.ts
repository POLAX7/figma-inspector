import { mkdtemp, readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { writeBundle } from '../src/bundle/write-bundle.js';

test('writes an atomic inspectable bundle', async () => {
  const outDir = join(await mkdtemp(join(tmpdir(), 'figctx-bundle-')), 'design');
  const tokens = { colors: [], typography: [], effects: [], fonts: [] };
  await writeBundle({ outDir, manifest: { contractVersion: '1', status: 'success' }, raw: { source: 'test' }, agent: { contractVersion: '1', rootIds: [], nodesById: {} }, images: [{ hash: 'a', bytes: Uint8Array.from([0xff, 0xd8, 0xff]), format: 'jpeg' }], vectors: [{ blobId: 7, bytes: Uint8Array.from([5, 6]) }], svgVectors: [{ blobId: 7, svg: '<svg/>' }], thumbnail: Uint8Array.from([1, 2, 3]), tokens });
  expect(JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'))).toMatchObject({ status: 'success' });
  expect(JSON.parse(await readFile(join(outDir, 'tokens/variables.json'), 'utf8'))).toEqual({ contractVersion: '1', collections: [], ungrouped: [] });
  await expect(readFile(join(outDir, 'assets/images/a.jpg'))).resolves.toBeTruthy();
  expect(JSON.parse(await readFile(join(outDir, 'assets/images.json'), 'utf8'))).toMatchObject({ images: [{ hash: 'a', path: 'assets/images/a.jpg', format: 'jpeg' }] });
  await expect(readFile(join(outDir, 'assets/thumbnail.png'))).resolves.toEqual(Buffer.from([1, 2, 3]));
  expect(JSON.parse(await readFile(join(outDir, 'assets/vectors.json'), 'utf8'))).toMatchObject({ vectors: [{ blobId: 7, path: 'assets/vectors/vector-network-7.bin.gz', compression: 'gzip', svgPath: 'assets/vectors/vector-network-7.svg' }] });
  expect(gunzipSync(await readFile(join(outDir, 'assets/vectors/vector-network-7.bin.gz')))).toEqual(Buffer.from([5, 6]));
  await expect(readFile(join(outDir, 'assets/vectors/vector-network-7.svg'), 'utf8')).resolves.toBe('<svg/>');
  await expect(writeBundle({ outDir, manifest: {}, raw: {}, agent: { contractVersion: '1', rootIds: [], nodesById: {} }, images: [], vectors: [], tokens })).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' });
});
