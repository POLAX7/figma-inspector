import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { PNG } from 'pngjs';
import { writeBundle } from '../src/bundle/write-bundle.js';
import { normalizeDocument } from '../src/normalize/document.js';

const loadDiscovery = () => import('../src/discovery.js').catch(() => ({}));

describe('searchNodes', () => {
  const document = normalizeDocument([
    { guid: { sessionID: 1, localID: 1 }, type: 'FRAME', name: 'Landing page' },
    { guid: { sessionID: 1, localID: 2 }, type: 'TEXT', name: 'Hero title', parentIndex: 0, textData: { characters: 'Build with confidence' } },
    { guid: { sessionID: 1, localID: 3 }, type: 'TEXT', name: 'Footer', parentIndex: 0, textData: { characters: 'Contact us' } }
  ]);

  test('finds case-insensitive matches in names and text with ancestry', async () => {
    const { searchNodes } = await loadDiscovery() as { searchNodes?: (document: typeof document, query: string) => Array<Record<string, unknown>> };

    expect(searchNodes).toBeTypeOf('function');
    expect(searchNodes!(document, 'CONFIDENCE')).toEqual([
      expect.objectContaining({ id: '1:2', name: 'Hero title', type: 'TEXT', matched: ['text'], ancestors: [{ id: '1:1', name: 'Landing page', type: 'FRAME' }] })
    ]);
  });

  test('applies type and limit filters', async () => {
    const { searchNodes } = await loadDiscovery() as { searchNodes?: (document: typeof document, query: string, options: { type?: string; limit?: number }) => Array<Record<string, unknown>> };

    expect(searchNodes).toBeTypeOf('function');
    expect(searchNodes!(document, 'title', { type: 'TEXT', limit: 1 })).toHaveLength(1);
    expect(searchNodes!(document, 'title', { type: 'FRAME' })).toEqual([]);
  });
});

describe('doctorBundle', () => {
  test('reports a valid bundle and every local integrity problem', async () => {
    const { doctorBundle } = await loadDiscovery() as { doctorBundle?: (bundle: string) => Promise<{ ok: boolean; checks: Array<{ code: string; ok: boolean }> }> };
    const root = await mkdtemp(join(tmpdir(), 'figctx-doctor-'));
    const bundle = join(root, 'bundle');
    await writeBundle({
      outDir: bundle,
      manifest: { contractVersion: '1' },
      raw: { source: 'test' },
      agent: normalizeDocument([{ guid: { sessionID: 1, localID: 1 }, type: 'FRAME' }]),
      images: [{ hash: 'image', bytes: Uint8Array.from([0xff, 0xd8, 0xff]), format: 'jpeg' }],
      vectors: [{ blobId: 7, bytes: Uint8Array.from([1, 2, 3]) }],
      tokens: { colors: [], typography: [], effects: [], fonts: [] }
    });

    try {
      expect(doctorBundle).toBeTypeOf('function');
      await expect(doctorBundle!(bundle)).resolves.toMatchObject({ ok: true });

      await unlink(join(bundle, 'assets/images/image.jpg'));
      await writeFile(join(bundle, 'tokens/colors.json'), '{');
      await writeFile(join(bundle, 'tokens/variables.json'), '{');
      await expect(doctorBundle!(bundle)).resolves.toMatchObject({
        ok: false,
        checks: expect.arrayContaining([
          expect.objectContaining({ code: 'MISSING_INDEXED_FILE', ok: false }),
          expect.objectContaining({ code: 'INVALID_JSON', ok: false, path: 'tokens/variables.json' })
        ])
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('checks reference PNG hashes and decodability', async () => {
    const { doctorBundle } = await loadDiscovery() as { doctorBundle?: (bundle: string) => Promise<{ checks: Array<{ code: string; ok: boolean }> }> };
    const root = await mkdtemp(join(tmpdir(), 'figctx-doctor-reference-'));
    const bundle = join(root, 'bundle');
    await writeBundle({ outDir: bundle, manifest: { contractVersion: '1' }, raw: {}, agent: normalizeDocument([]), images: [], vectors: [], tokens: { colors: [], typography: [], effects: [], fonts: [] } });
    const image = new PNG({ width: 1, height: 1 });
    image.data.set([255, 0, 0, 255]);
    await mkdir(join(bundle, 'references'), { recursive: true });
    await writeFile(join(bundle, 'references/valid.png'), PNG.sync.write(image));
    await writeFile(join(bundle, 'references/invalid.png'), 'not a PNG');
    await writeFile(join(bundle, 'references/index.json'), JSON.stringify({ references: [
      { nodeId: '1:1', path: 'references/missing.png', width: 1, height: 1, sha256: '0'.repeat(64) },
      { nodeId: '1:2', path: 'references/valid.png', width: 1, height: 1, sha256: '0'.repeat(64) },
      { nodeId: '1:3', path: 'references/invalid.png', width: 1, height: 1, sha256: '0'.repeat(64) }
    ] }));

    try {
      expect(doctorBundle).toBeTypeOf('function');
      await expect(doctorBundle!(bundle)).resolves.toMatchObject({
        checks: expect.arrayContaining([
          expect.objectContaining({ code: 'MISSING_INDEXED_FILE', ok: false }),
          expect.objectContaining({ code: 'REFERENCE_HASH_MISMATCH', ok: false }),
          expect.objectContaining({ code: 'INVALID_REFERENCE_IMAGE', ok: false })
        ])
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
