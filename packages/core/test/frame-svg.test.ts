import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import * as frameSvg from '../src/vectors/frame.js';

const { composeFrameSvg } = frameSvg;

test('composes descendant vector paths with their Figma transforms and fills', () => {
  const document = {
    contractVersion: '1' as const,
    rootIds: ['1:1'],
    nodesById: {
      '1:1': { id: '1:1', name: 'Card', type: 'FRAME', childIds: ['1:2'], zIndex: 0, bounds: { x: 100, y: 80 }, transform: { m00: 1, m01: 0, m02: 200, m10: 0, m11: 1, m12: 300 }, assetRefs: [] },
      '1:2': { id: '1:2', name: 'Star', type: 'VECTOR', childIds: [], zIndex: 1, bounds: { x: 10, y: 10 }, transform: { m00: 1, m01: 0, m02: 12, m10: 0, m11: 1, m12: 8 }, fills: [{ type: 'SOLID', color: { r: 1, g: 0.5, b: 0 } }], assetRefs: [], vectorRef: { blobId: 7, path: 'assets/vectors/vector-network-7.bin.gz', format: 'kiwi-vector-network' as const, compression: 'gzip', svgPath: 'assets/vectors/vector-network-7.svg' } }
    }
  };

  expect(composeFrameSvg(document, '1:1', new Map([[7, '<svg><path d="M 0 0 L 10 0 Z" fill="currentColor"/></svg>']]))).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><path d="M 0 0 L 10 0 Z" fill="#ff8000" transform="matrix(1 0 0 1 12 8)"/></svg>'
  );
});

test('clips frame contents and applies a mask to following sibling layers', () => {
  const document = {
    contractVersion: '1' as const,
    rootIds: ['1:1'],
    nodesById: {
      '1:1': { id: '1:1', name: 'Card', type: 'FRAME', childIds: ['1:2', '1:3'], zIndex: 0, bounds: { x: 100, y: 80 }, transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, frameMaskDisabled: false, assetRefs: [] },
      '1:2': { id: '1:2', name: 'Mask', type: 'VECTOR', childIds: [], zIndex: 1, bounds: { x: 20, y: 20 }, transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 10 }, mask: true, assetRefs: [], vectorRef: { blobId: 7, path: 'assets/vectors/vector-network-7.bin.gz', format: 'kiwi-vector-network' as const, compression: 'gzip' } },
      '1:3': { id: '1:3', name: 'Artwork', type: 'VECTOR', childIds: [], zIndex: 2, bounds: { x: 20, y: 20 }, transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, fills: [{ type: 'SOLID', color: { r: 0, g: 1, b: 0 } }], assetRefs: [], vectorRef: { blobId: 8, path: 'assets/vectors/vector-network-8.bin.gz', format: 'kiwi-vector-network' as const, compression: 'gzip' } }
    }
  };

  const svg = composeFrameSvg(document, '1:1', new Map([
    [7, '<svg><path d="M 0 0 H 20 V 20 Z"/></svg>'],
    [8, '<svg><path d="M -10 -10 H 40 V 40 Z"/></svg>']
  ]));

  expect(svg).toContain('<clipPath id="clip-0"><path d="M 0 0 H 100 V 80 H 0 Z" fill="#ffffff" transform="matrix(1 0 0 1 0 0)"/></clipPath>');
  expect(svg).toContain('<mask id="mask-1" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="#000000"/><path d="M 0 0 H 20 V 20 Z" fill="#ffffff" transform="matrix(1 0 0 1 10 10)"/></mask>');
  expect(svg).toContain('<g mask="url(#mask-1)"><path d="M -10 -10 H 40 V 40 Z" fill="#00ff00" transform="matrix(1 0 0 1 0 0)"/></g>');
});

test('finds a maximal vector group and composes every descendant path once', () => {
  expect(frameSvg).toHaveProperty('findVectorGroups');
  expect(frameSvg).toHaveProperty('composeVectorGroupSvg');

  const document = {
    contractVersion: '1' as const,
    rootIds: ['1:1'],
    nodesById: {
      '1:1': { id: '1:1', name: 'Card', type: 'FRAME', childIds: ['1:2', '1:5'], zIndex: 0, bounds: { x: 100, y: 80 }, assetRefs: [] },
      '1:2': { id: '1:2', name: 'Illustration', type: 'FRAME', parentId: '1:1', childIds: ['1:3', '1:4'], zIndex: 1, bounds: { x: 40, y: 30 }, assetRefs: [] },
      '1:3': { id: '1:3', name: 'Circle', type: 'VECTOR', parentId: '1:2', childIds: [], zIndex: 2, bounds: { x: 10, y: 10 }, transform: { m00: 1, m01: 0, m02: 2, m10: 0, m11: 1, m12: 3 }, opacity: 0.5, fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }], assetRefs: [], vectorRef: { blobId: 7, path: 'assets/vectors/vector-network-7.bin.gz', format: 'kiwi-vector-network' as const, compression: 'gzip' } },
      '1:4': { id: '1:4', name: 'Dot', type: 'VECTOR', parentId: '1:2', childIds: [], zIndex: 3, bounds: { x: 10, y: 10 }, transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 4 }, fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }], assetRefs: [], vectorRef: { blobId: 8, path: 'assets/vectors/vector-network-8.bin.gz', format: 'kiwi-vector-network' as const, compression: 'gzip' } },
      '1:5': { id: '1:5', name: 'Label', type: 'TEXT', parentId: '1:1', childIds: [], zIndex: 4, text: 'Not SVG', assetRefs: [] }
    }
  };

  const groups = (frameSvg as typeof frameSvg & { findVectorGroups: (document: typeof document, rootId: string) => Array<{ nodeId: string }> }).findVectorGroups(document, '1:1');
  expect(groups).toEqual([{ nodeId: '1:2', name: 'Illustration', bounds: { x: 40, y: 30 }, vectorCount: 2 }]);

  const svg = (frameSvg as typeof frameSvg & { composeVectorGroupSvg: (document: typeof document, nodeId: string, vectors: ReadonlyMap<number, string>) => string | undefined }).composeVectorGroupSvg(document, '1:2', new Map([
    [7, '<svg><path d="M 0 0 H 10 V 10 Z" fill="currentColor"/></svg>'],
    [8, '<svg><path d="M 0 0 H 4 V 4 Z" fill="currentColor"/><path d="M 1 1 H 3 V 3 Z" fill="currentColor" fill-rule="evenodd"/></svg>']
  ]));

  expect(svg).toContain('viewBox="0 0 40 30"');
  expect(svg?.match(/<path /g)).toHaveLength(3);
  expect(svg).toContain('<g opacity="0.5">');
  expect(svg).toContain('fill="#ff0000" transform="matrix(1 0 0 1 2 3)"');
  expect(svg).toContain('fill="#0000ff" transform="matrix(1 0 0 1 20 4)"');
  expect(svg).toContain('fill-rule="evenodd"');
});

test('loads a selected vector group from its bundle SVG files', async () => {
  expect(frameSvg).toHaveProperty('composeBundleVectorGroupSvg');
  const bundle = await mkdtemp(join(tmpdir(), 'figctx-vector-group-'));
  await writeFile(join(bundle, 'vector.svg'), '<svg><path d="M 0 0 H 5 V 5 Z" fill="currentColor"/></svg>');
  const document = {
    contractVersion: '1' as const,
    rootIds: ['2:1'],
    nodesById: {
      '2:1': { id: '2:1', name: 'Icon', type: 'FRAME', childIds: ['2:2'], zIndex: 0, bounds: { x: 5, y: 5 }, assetRefs: [] },
      '2:2': { id: '2:2', name: 'Path', type: 'VECTOR', parentId: '2:1', childIds: [], zIndex: 1, bounds: { x: 5, y: 5 }, fills: [{ type: 'SOLID', color: { r: 0, g: 1, b: 0 } }], assetRefs: [], vectorRef: { blobId: 3, path: 'vector.bin.gz', svgPath: 'vector.svg', format: 'kiwi-vector-network' as const, compression: 'gzip' } }
    }
  };

  const svg = await (frameSvg as typeof frameSvg & { composeBundleVectorGroupSvg: (bundle: string, document: typeof document, nodeId: string) => Promise<string | undefined> }).composeBundleVectorGroupSvg(bundle, document, '2:1');
  expect(svg).toContain('fill="#00ff00"');
});
