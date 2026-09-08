import { expect, test } from 'vitest';
import { vectorNetworkToSvg } from '../src/vectors/svg.js';

test('converts a closed Figma vector-network into a portable SVG', () => {
  const bytes = new Uint8Array(12 + 3 * 12 + 3 * 28 + 8 + 4 + 3 * 4);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  view.setUint32(offset, 3, true); offset += 4;
  view.setUint32(offset, 3, true); offset += 4;
  view.setUint32(offset, 1, true); offset += 4;
  for (const [x, y] of [[0, 0], [24, 0], [12, 18]]) {
    view.setUint32(offset, 0, true); offset += 4;
    view.setFloat32(offset, x, true); offset += 4;
    view.setFloat32(offset, y, true); offset += 4;
  }
  for (const [start, end] of [[0, 1], [1, 2], [2, 0]]) {
    view.setUint32(offset, 0, true); offset += 4;
    view.setUint32(offset, start, true); offset += 4;
    view.setFloat32(offset, 0, true); offset += 4;
    view.setFloat32(offset, 0, true); offset += 4;
    view.setUint32(offset, end, true); offset += 4;
    view.setFloat32(offset, 0, true); offset += 4;
    view.setFloat32(offset, 0, true); offset += 4;
  }
  view.setUint32(offset, 0, true); offset += 4;
  view.setUint32(offset, 1, true); offset += 4;
  view.setUint32(offset, 3, true); offset += 4;
  for (const index of [0, 1, 2]) { view.setUint32(offset, index, true); offset += 4; }

  expect(vectorNetworkToSvg(bytes, { x: 24, y: 18 })).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 18"><path d="M 0 0 L 24 0 L 12 18 L 0 0 Z" fill="currentColor" fill-rule="evenodd"/></svg>'
  );
});

test('rejects malformed vector-network bytes instead of producing invalid SVG', () => {
  expect(vectorNetworkToSvg(Uint8Array.from([1, 2, 3]), { x: 1, y: 1 })).toBeUndefined();
});

test('preserves separate regions and uses evenodd fill for holes', () => {
  const bytes = new Uint8Array(12 + 4 * 12 + 4 * 28 + 2 * (8 + 4 + 4 * 4));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  view.setUint32(offset, 4, true); offset += 4;
  view.setUint32(offset, 4, true); offset += 4;
  view.setUint32(offset, 2, true); offset += 4;
  for (const [x, y] of [[0, 0], [20, 0], [20, 20], [0, 20]]) {
    view.setUint32(offset, 0, true); offset += 4;
    view.setFloat32(offset, x, true); offset += 4;
    view.setFloat32(offset, y, true); offset += 4;
  }
  for (const [start, end] of [[0, 1], [1, 2], [2, 3], [3, 0]]) {
    view.setUint32(offset, 0, true); offset += 4;
    view.setUint32(offset, start, true); offset += 4;
    view.setFloat32(offset, 0, true); offset += 4;
    view.setFloat32(offset, 0, true); offset += 4;
    view.setUint32(offset, end, true); offset += 4;
    view.setFloat32(offset, 0, true); offset += 4;
    view.setFloat32(offset, 0, true); offset += 4;
  }
  for (const indices of [[0, 1, 2, 3], [0, 1, 2, 3]]) {
    view.setUint32(offset, 0, true); offset += 4;
    view.setUint32(offset, 1, true); offset += 4;
    view.setUint32(offset, indices.length, true); offset += 4;
    for (const index of indices) { view.setUint32(offset, index, true); offset += 4; }
  }

  const svg = vectorNetworkToSvg(bytes, { x: 20, y: 20 });
  expect(svg?.match(/fill-rule="evenodd"/g)).toHaveLength(2);
  expect(svg?.match(/<path /g)).toHaveLength(2);
});
