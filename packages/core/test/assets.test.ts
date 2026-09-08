import { describe, expect, test } from 'vitest';

const loadAssets = () => import('../src/assets.js').catch(() => undefined);

describe('detectAssetFormat', () => {
  test.each([
    ['png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['jpeg', Uint8Array.from([0xff, 0xd8, 0xff])],
    ['gif', new TextEncoder().encode('GIF89a')],
    ['webp', new TextEncoder().encode('RIFFxxxxWEBP')],
    ['svg', new TextEncoder().encode('  <svg xmlns="http://www.w3.org/2000/svg">')],
    ['unknown', Uint8Array.from([0, 1, 2])]
  ] as const)('detects %s payloads', async (expected, bytes) => {
    const assets = await loadAssets();

    expect(assets?.detectAssetFormat(bytes)).toBe(expected);
  });
});
