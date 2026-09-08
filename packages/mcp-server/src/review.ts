import type { PixelComparison } from '@figctx/core';

export type ReviewPhase = 'midpoint' | 'final';

interface VisualReviewInput {
  nodeId: string;
  phase: ReviewPhase;
  reference: Uint8Array;
  candidate: Uint8Array;
  comparison: PixelComparison;
}

type ReviewContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: 'image/png' };

export function buildVisualReview(input: VisualReviewInput): { passed: boolean; reviewPrompt: string; content: ReviewContent[] } {
  const maxMismatchRatio = 0.005;
  const passed = input.comparison.mismatchRatio <= maxMismatchRatio;
  const reviewPrompt = passed
    ? 'Inspect the attached Figma reference, candidate screenshot, and diff image. The pixel gate passed; address any remaining clearly visible mismatch before continuing.'
    : 'Inspect the attached Figma reference, candidate screenshot, and diff image. Identify the largest visible mismatches, make the smallest corrective changes, capture a new screenshot, and call review_visual_match again. Do not declare this implementation complete until passed is true.';
  const report = {
    nodeId: input.nodeId,
    phase: input.phase,
    passed,
    maxMismatchRatio,
    comparison: {
      width: input.comparison.width,
      height: input.comparison.height,
      pixelCount: input.comparison.pixelCount,
      mismatchPixels: input.comparison.mismatchPixels,
      mismatchRatio: input.comparison.mismatchRatio
    },
    reviewPrompt
  };

  return {
    passed,
    reviewPrompt,
    content: [
      { type: 'text', text: JSON.stringify(report, null, 2) },
      image(input.reference),
      image(input.candidate),
      image(input.comparison.diffPng)
    ]
  };
}

function image(bytes: Uint8Array): ReviewContent { return { type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: 'image/png' }; }
