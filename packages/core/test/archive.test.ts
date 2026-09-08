import { describe, expect, test } from 'vitest';
import { kiwiCanvas, writeFixtureZip } from './fixtures.js';

const loadReadFigArchive = async () => {
  const archive = await import('../src/archive/read-archive.js').catch(() => undefined);

  return archive?.readFigArchive ?? (() => Promise.reject(new Error('readFigArchive is unavailable')));
};

describe('readFigArchive', () => {
  test('rejects archives without canvas.fig', async () => {
    const readFigArchive = await loadReadFigArchive();
    const sourcePath = await writeFixtureZip({ 'meta.json': new TextEncoder().encode('{}') });

    await expect(readFigArchive(sourcePath)).rejects.toMatchObject({ code: 'MISSING_CANVAS' });
  });

  test('rejects canvas payloads with an unsupported variant', async () => {
    const readFigArchive = await loadReadFigArchive();
    const sourcePath = await writeFixtureZip({ 'canvas.fig': Uint8Array.from([1, 2, 3]) });

    await expect(readFigArchive(sourcePath)).rejects.toMatchObject({ code: 'UNSUPPORTED_FIG_VARIANT' });
  });

  test('reads a fig-kiwi canvas and extensionless image asset', async () => {
    const readFigArchive = await loadReadFigArchive();
    const sourcePath = await writeFixtureZip({
      'canvas.fig': kiwiCanvas,
      'meta.json': new TextEncoder().encode('{"file_name":"fixture"}'),
      'images/abc123': Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])
    });

    await expect(readFigArchive(sourcePath)).resolves.toMatchObject({
      canvasVariant: 'fig-kiwi',
      meta: { file_name: 'fixture' },
      images: [{ hash: 'abc123', format: 'jpeg' }]
    });
  });
});
