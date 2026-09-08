import assert from 'node:assert/strict';
import test from 'node:test';
import { findSecretFindings } from './check-secrets.mjs';

test('reports the secret type and line without retaining the secret value', () => {
  const findings = findSecretFindings(`const token = "figd_${'a'.repeat(22)}";\n`);
  assert.deepEqual(findings, [{ line: 1, type: 'Figma personal access token' }]);
  assert.equal(JSON.stringify(findings).includes('figd_'), false);
});

test('ignores the documented redacted Figma token placeholder', () => {
  assert.deepEqual(findSecretFindings('FIGMA_TOKEN=figd_xxxxxxxxxxxxxxxxxxxx'), []);
});
