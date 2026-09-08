import { describe, expect, test } from 'vitest';
import { buildVisualReview } from '../src/review.js';

const reference = Uint8Array.from([1, 2, 3]);
const candidate = Uint8Array.from([4, 5, 6]);
const diff = Uint8Array.from([7, 8, 9]);

describe('buildVisualReview', () => {
  test('passes at the 0.5% mismatch boundary and returns all comparison images', () => {
    const review = buildVisualReview({
      nodeId: '320:182023',
      phase: 'final',
      reference,
      candidate,
      comparison: { width: 20, height: 10, pixelCount: 200, mismatchPixels: 1, mismatchRatio: 0.005, diffPng: diff }
    });

    expect(review.passed).toBe(true);
    expect(review.content).toHaveLength(4);
    expect(review.content.slice(1)).toEqual([
      { type: 'image', data: Buffer.from(reference).toString('base64'), mimeType: 'image/png' },
      { type: 'image', data: Buffer.from(candidate).toString('base64'), mimeType: 'image/png' },
      { type: 'image', data: Buffer.from(diff).toString('base64'), mimeType: 'image/png' }
    ]);
  });

  test('requires another implementation pass when the visual gate fails', () => {
    const review = buildVisualReview({
      nodeId: '320:182023',
      phase: 'midpoint',
      reference,
      candidate,
      comparison: { width: 20, height: 10, pixelCount: 200, mismatchPixels: 2, mismatchRatio: 0.01, diffPng: diff }
    });

    expect(review.passed).toBe(false);
    expect(review.reviewPrompt).toContain('Do not declare this implementation complete');
    expect(review.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('"passed": false') });
  });
});
