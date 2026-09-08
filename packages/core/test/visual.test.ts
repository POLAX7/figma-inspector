import { expect, test } from 'vitest';
import { PNG } from 'pngjs';
import { comparePng, describePng } from '../src/visual/compare.js';

function png(pixel: [number, number, number, number]): Uint8Array {
  const image = new PNG({ width: 1, height: 1 });
  image.data.set(pixel);
  return PNG.sync.write(image);
}

test('reports exact pixel mismatches and writes a diff PNG', () => {
  const result = comparePng(png([255, 0, 0, 255]), png([0, 0, 255, 255]));
  expect(result).toMatchObject({ width: 1, height: 1, pixelCount: 1, mismatchPixels: 1, mismatchRatio: 1 });
  expect(result.diffPng).toBeInstanceOf(Uint8Array);
});

test('rejects candidate images with a different size', () => {
  const reference = png([0, 0, 0, 255]);
  const candidate = new PNG({ width: 2, height: 1 });
  candidate.data.fill(255);
  expect(() => comparePng(reference, PNG.sync.write(candidate))).toThrow(/dimensions/i);
});

test('describes a reference PNG with deterministic SHA-256 and dimensions', () => {
  expect(describePng(png([1, 2, 3, 255]))).toMatchObject({ width: 1, height: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
});
