import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { FigctxError } from '../errors.js';

export interface PixelComparison {
  width: number;
  height: number;
  pixelCount: number;
  mismatchPixels: number;
  mismatchRatio: number;
  diffPng: Uint8Array;
}
export interface PngDescription { width: number; height: number; sha256: string; }

/** Compares two local PNGs. A mismatch is intentional evidence, not an error. */
export function comparePng(referenceBytes: Uint8Array, candidateBytes: Uint8Array, threshold = 0.1): PixelComparison {
  const reference = decode(referenceBytes, 'reference');
  const candidate = decode(candidateBytes, 'candidate');
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    throw new FigctxError('REFERENCE_IMAGE_DIMENSION_MISMATCH', `Image dimensions differ: reference is ${reference.width}x${reference.height}; candidate is ${candidate.width}x${candidate.height}.`);
  }
  const diff = new PNG({ width: reference.width, height: reference.height });
  const mismatchPixels = pixelmatch(reference.data, candidate.data, diff.data, reference.width, reference.height, { threshold, includeAA: true });
  const pixelCount = reference.width * reference.height;
  return { width: reference.width, height: reference.height, pixelCount, mismatchPixels, mismatchRatio: pixelCount === 0 ? 0 : mismatchPixels / pixelCount, diffPng: PNG.sync.write(diff) };
}
export function describePng(bytes: Uint8Array): PngDescription { const image = decode(bytes, 'reference'); return { width: image.width, height: image.height, sha256: createHash('sha256').update(bytes).digest('hex') }; }
function decode(bytes: Uint8Array, label: string): PNG { try { return PNG.sync.read(Buffer.from(bytes)); } catch (error) { throw new FigctxError('INVALID_REFERENCE_IMAGE', `Cannot decode ${label} PNG.`, error); } }
