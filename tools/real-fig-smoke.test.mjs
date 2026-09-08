import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFixtureContract } from './real-fig-smoke.mjs';

const validContract = {
  releaseTag: 'figctx-acceptance-v1',
  assetName: 'acceptance.fig',
  assetSha256: 'a'.repeat(64),
  sourceSha256: 'b'.repeat(64),
  minimums: { nodes: 1, images: 0, vectors: 0 },
  outputSha256: { 'document.agent.json': 'c'.repeat(64) }
};

test('accepts a complete real-fig fixture contract', () => {
  assert.deepEqual(validateFixtureContract(validContract), validContract);
});

test('rejects a malformed fixture checksum before extraction', () => {
  assert.throws(() => validateFixtureContract({ ...validContract, assetSha256: 'not-a-sha' }), /assetSha256/);
});
