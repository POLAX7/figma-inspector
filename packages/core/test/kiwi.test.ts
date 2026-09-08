import { describe, expect, test } from 'vitest';
import { readFigArchive } from '../src/archive/read-archive.js';
import { FigctxError } from '../src/errors.js';
import { kiwiCanvas } from './fixtures.js';

const loadDecoder = () => import('../src/decoder/kiwi.js').catch(() => undefined);

const loadDecodeKiwiCanvas = async () => {
  const decoder = await loadDecoder();

  return decoder?.decodeKiwiCanvas ?? (() => Promise.reject(new Error('decodeKiwiCanvas is unavailable')));
};

describe('decodeKiwiCanvas', () => {
  test('reports malformed fig-kiwi chunks as structured errors', async () => {
    const decodeKiwiCanvas = await loadDecodeKiwiCanvas();

    try {
      await decodeKiwiCanvas(kiwiCanvas);
      throw new Error('Expected malformed input to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(FigctxError);
      expect((error as FigctxError).code).toBe('CORRUPT_KIWI_CHUNK');
    }
  });

  const sourcePath = process.env.FIGCTX_ACCEPTANCE_FIG;
  test.runIf(sourcePath)('decodes the configured real local export', async () => {
    const decodeKiwiCanvas = await loadDecodeKiwiCanvas();
    const archive = await readFigArchive(sourcePath!);
    const decoded = await decodeKiwiCanvas(archive.canvas);

    expect(decoded.document).toBeTruthy();
    expect(decoded.nodeChanges.length).toBeGreaterThan(0);
  }, 120_000);
});
