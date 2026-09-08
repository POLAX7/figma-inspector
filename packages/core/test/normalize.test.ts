import { describe, expect, test } from 'vitest';
import { effectiveChildIds, expandLocalInstances, hashToHex, normalizeDocument, resolveNodeReference } from '../src/normalize/document.js';
import { buildNodeContext } from '../src/context/node-context.js';
import { inspectNode } from '../src/context/inspect-node.js';

const document = normalizeDocument([
  { guid: { sessionID: 1, localID: 1 }, type: 'DOCUMENT', name: 'Document' },
  { guid: { sessionID: 1, localID: 2 }, type: 'FRAME', name: 'Hero', parentIndex: 0, size: { x: 100, y: 50 } },
  { guid: { sessionID: 1, localID: 3 }, type: 'TEXT', name: 'Title', parentIndex: 1, textData: { characters: 'Hello' } }
]);

describe('normalized document', () => {
  test('exposes stable component metadata and resolved child access', () => {
    const normalized = normalizeDocument([
      { guid: { sessionID: 10, localID: 1 }, type: 'INSTANCE', name: 'Alert', symbolData: { symbolID: { sessionID: 20, localID: 1 } } },
      { guid: { sessionID: 20, localID: 1 }, type: 'SYMBOL', name: 'Alert Variant' },
      { guid: { sessionID: 20, localID: 2 }, type: 'TEXT', name: 'Title', parentIndex: 1, textData: { characters: 'Title' } }
    ]);
    const expanded = expandLocalInstances(normalized);
    const instance = expanded.nodesById['10:1']!;
    expect(instance.node_id).toBe('10:1');
    expect(instance.main_component_id).toBe('20:1');
    expect(effectiveChildIds(instance)).toEqual(instance.resolvedChildIds);
  });

  test('stops nested expansion when a component cycle is encountered', () => {
    const normalized = normalizeDocument([
      { guid: { sessionID: 1, localID: 1 }, type: 'INSTANCE', name: 'A', symbolData: { symbolID: { sessionID: 2, localID: 1 } } },
      { guid: { sessionID: 2, localID: 1 }, type: 'SYMBOL', name: 'A Symbol' },
      { guid: { sessionID: 2, localID: 2 }, type: 'INSTANCE', name: 'B', parentIndex: 1, symbolData: { symbolID: { sessionID: 2, localID: 1 } } }
    ]);
    const expanded = expandLocalInstances(normalized);
    expect(Object.keys(expanded.nodesById).length).toBeLessThan(20);
  });

  test('reports component identity and expansion state in bounded inspection', () => {
    const normalized = normalizeDocument([
      { guid: { sessionID: 30, localID: 1 }, type: 'INSTANCE', symbolData: { symbolID: { sessionID: 40, localID: 1 } } },
      { guid: { sessionID: 40, localID: 1 }, type: 'SYMBOL' },
      { guid: { sessionID: 40, localID: 2 }, type: 'TEXT', parentIndex: 1, textData: { characters: 'Label' } }
    ]);
    const node = expandLocalInstances(normalized).nodesById['30:1']!;
    expect(inspectNode(expandLocalInstances(normalized), node).selection.component).toEqual({ type: 'INSTANCE', mainComponentId: '40:1', expanded: true });
  });

  test('expands an empty instance from its local symbol definition without changing raw children', () => {
    const normalized = normalizeDocument([
      { guid: { sessionID: 10, localID: 1 }, type: 'INSTANCE', name: 'Alert', symbolData: { symbolID: { sessionID: 20, localID: 1 }, symbolOverrides: [{ textData: { characters: '刪除範本' } }, { textData: { characters: '刪除範本後將無法再恢復，確定要刪除嗎？' } }, { textData: { characters: '刪除' } }] } },
      { guid: { sessionID: 20, localID: 1 }, type: 'SYMBOL', name: 'Alert Variant', parentIndex: undefined },
      { guid: { sessionID: 20, localID: 2 }, type: 'TEXT', name: 'Title', parentIndex: 1, textData: { characters: 'Title here' } },
      { guid: { sessionID: 20, localID: 3 }, type: 'TEXT', name: 'Description', parentIndex: 1, textData: { characters: 'Content here' } },
      { guid: { sessionID: 20, localID: 4 }, type: 'TEXT', name: 'Button', parentIndex: 1, textData: { characters: 'Button here' } }
    ]);

    const expanded = expandLocalInstances(normalized);
    const instance = expanded.nodesById['10:1']!;
    expect(instance.childIds).toEqual([]);
    expect(instance.resolvedChildIds).toHaveLength(3);
    expect(instance.resolvedComponentId).toBe('20:1');
    expect(instance.resolvedChildIds.map((id) => expanded.nodesById[id]!.text)).toEqual(['刪除範本', '刪除範本後將無法再恢復，確定要刪除嗎？', '刪除']);
  });

  test('applies remaining instance text overrides to nested component text', () => {
    const normalized = normalizeDocument([
      { guid: { sessionID: 11, localID: 1 }, type: 'INSTANCE', name: 'Alert', symbolData: { symbolID: { sessionID: 21, localID: 1 }, symbolOverrides: [{ textData: { characters: '標題' } }, { textData: { characters: '主按鈕' } }] } },
      { guid: { sessionID: 21, localID: 1 }, type: 'SYMBOL', name: 'Alert Variant', parentIndex: undefined },
      { guid: { sessionID: 21, localID: 2 }, type: 'TEXT', name: 'Title', parentIndex: 1, textData: { characters: 'Title here' } },
      { guid: { sessionID: 21, localID: 3 }, type: 'INSTANCE', name: 'Button', parentIndex: 1, symbolData: { symbolID: { sessionID: 31, localID: 1 }, symbolOverrides: [] } },
      { guid: { sessionID: 31, localID: 1 }, type: 'SYMBOL', name: 'Button Variant', parentIndex: undefined },
      { guid: { sessionID: 31, localID: 2 }, type: 'TEXT', name: 'Label', parentIndex: 4, textData: { characters: 'Confirm' } }
    ]);

    const expanded = expandLocalInstances(normalized);
    const texts: string[] = [];
    const visit = (id: string) => { const node = expanded.nodesById[id]!; if (node.text !== undefined) texts.push(node.text); for (const childId of node.resolvedChildIds ?? node.childIds) visit(childId); };
    for (const id of expanded.nodesById['11:1']!.resolvedChildIds ?? []) visit(id);
    expect(texts).toEqual(['標題', '主按鈕']);
  });

  test('builds stable IDs, hierarchy, and text context', () => {
    expect(document.nodesById['1:2']).toMatchObject({ id: '1:2', type: 'FRAME', childIds: ['1:3'] });
    expect(document.nodesById['1:3']).toMatchObject({ text: 'Hello', parentId: '1:2' });
  });

  test.each(['1:3', '1-3', 'https://www.figma.com/design/file/name?node-id=1-3'])
  ('resolves %s', (reference) => expect(resolveNodeReference(document, reference).id).toBe('1:3'));

  test('rejects a Figma URL for another file key', () => {
    const keyed = normalizeDocument([], { originFileKey: 'local-file' });
    expect(() => resolveNodeReference(keyed, 'https://www.figma.com/design/other-file/name?node-id=1-3')).toThrow(/bundle is for local-file/);
  });

  test('links an image fill to its extracted asset path', () => {
    const hash = Uint8Array.from({ length: 20 }, (_value, index) => index);
    const normalized = normalizeDocument([{ guid: { sessionID: 2, localID: 4 }, fillPaints: [{ type: 'IMAGE', image: { hash } }] }], { assetPaths: { [hashToHex(hash)!]: 'assets/images/example.png' } });
    expect(normalized.nodesById['2:4']!.assetRefs).toEqual([{ hash: hashToHex(hash), path: 'assets/images/example.png', kind: 'image-fill' }]);
  });

  test('preserves a vector-network blob reference', () => {
    const normalized = normalizeDocument([{ guid: { sessionID: 2, localID: 5 }, vectorData: { vectorNetworkBlob: 7 } }], { vectorPaths: { 7: 'assets/vectors/vector-network-7.bin.gz' }, vectorSvgPaths: { 7: 'assets/vectors/vector-network-7.svg' } });
    expect(normalized.nodesById['2:5']!.vectorRef).toEqual({ blobId: 7, path: 'assets/vectors/vector-network-7.bin.gz', format: 'kiwi-vector-network', compression: 'gzip', svgPath: 'assets/vectors/vector-network-7.svg' });
  });

  test('collects every descendant text and asset for a frame context', () => {
    const normalized = normalizeDocument([
      { guid: { sessionID: 4, localID: 1 }, type: 'FRAME' },
      { guid: { sessionID: 4, localID: 2 }, type: 'TEXT', parentIndex: 0, textData: { characters: 'Nested' } },
      { guid: { sessionID: 4, localID: 3 }, type: 'RECTANGLE', parentIndex: 1, fillPaints: [{ type: 'IMAGE', image: { hash: Uint8Array.from({ length: 20 }, () => 1) } }] }
    ], { assetPaths: { ['01'.repeat(20)]: 'assets/images/nested.png' } });
    const context = buildNodeContext(normalized, normalized.nodesById['4:1']!);
    expect(context.nodeIds).toEqual(['4:1', '4:2', '4:3']);
    expect(context.text).toEqual([expect.objectContaining({ id: '4:2', text: 'Nested' })]);
    expect(context.assets).toEqual([{ hash: '01'.repeat(20), path: 'assets/images/nested.png', kind: 'image-fill' }]);
  });

  test('lists maximal vector groups in a packed node context', () => {
    const normalized = normalizeDocument([
      { guid: { sessionID: 7, localID: 1 }, type: 'FRAME', size: { x: 100, y: 50 } },
      { guid: { sessionID: 7, localID: 2 }, type: 'FRAME', parentIndex: 0, name: 'Artwork', size: { x: 20, y: 10 } },
      { guid: { sessionID: 7, localID: 3 }, type: 'VECTOR', parentIndex: 1, size: { x: 20, y: 10 }, vectorData: { vectorNetworkBlob: 9 } },
      { guid: { sessionID: 7, localID: 4 }, type: 'TEXT', parentIndex: 0, textData: { characters: 'Caption' } }
    ], { vectorPaths: { 9: 'assets/vectors/vector-network-9.bin.gz' }, vectorSvgPaths: { 9: 'assets/vectors/vector-network-9.svg' } });

    expect(buildNodeContext(normalized, normalized.nodesById['7:1']!)).toMatchObject({
      vectorGroups: [{ nodeId: '7:2', name: 'Artwork', bounds: { x: 20, y: 10 }, vectorCount: 1 }]
    });
  });

  test('does not list a group whose vector SVG fragments are unavailable', () => {
    const normalized = normalizeDocument([
      { guid: { sessionID: 8, localID: 1 }, type: 'FRAME', size: { x: 20, y: 10 } },
      { guid: { sessionID: 8, localID: 2 }, type: 'VECTOR', parentIndex: 0, size: { x: 20, y: 10 }, vectorData: { vectorNetworkBlob: 1 } }
    ], { vectorPaths: { 1: 'assets/vectors/vector-network-1.bin.gz' } });

    expect(buildNodeContext(normalized, normalized.nodesById['8:1']!).vectorGroups).toEqual([]);
  });

  test('retains Figma-computed text layout and visibility fields', () => {
    const normalized = normalizeDocument([{ guid: { sessionID: 5, localID: 1 }, type: 'TEXT', visible: false, opacity: 0.6, textData: { characters: 'Measured' }, derivedTextData: { layoutSize: { x: 80, y: 20 }, baselines: [{ position: { x: 0, y: 14 } }], glyphs: [{ commandsBlob: 99 }] } }]);
    expect(normalized.nodesById['5:1']).toMatchObject({ visible: false, opacity: 0.6, textLayout: { layoutSize: { x: 80, y: 20 }, baselines: [{ position: { x: 0, y: 14 } }] } });
    expect(normalized.nodesById['5:1']!.textLayout).not.toHaveProperty('glyphs');
  });

  test('groups text style overrides into resolved character runs', () => {
    const normalized = normalizeDocument([{
      guid: { sessionID: 9, localID: 1 },
      type: 'TEXT',
      textData: {
        characters: 'Hi all',
        characterStyleIDs: [7, 7, 0, 9, 9, 9],
        styleOverrideTable: [
          { styleID: 7, fontName: { family: 'Inter', style: 'Bold' }, fillPaints: [{ type: 'SOLID', color: { r: 1 } }] },
          { styleID: 9, textDecoration: 'UNDERLINE' }
        ]
      },
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 16,
      textDecoration: 'NONE'
    }]);

    expect(normalized.nodesById['9:1']!.textSegments).toEqual([
      { start: 0, end: 2, text: 'Hi', styleId: 7, typography: { fontName: { family: 'Inter', style: 'Bold' }, fontSize: 16, textDecoration: 'NONE' }, fills: [{ type: 'SOLID', color: { r: 1 } }] },
      { start: 2, end: 3, text: ' ', styleId: 0, typography: { fontName: { family: 'Inter', style: 'Regular' }, fontSize: 16, textDecoration: 'NONE' } },
      { start: 3, end: 6, text: 'all', styleId: 9, typography: { fontName: { family: 'Inter', style: 'Regular' }, fontSize: 16, textDecoration: 'UNDERLINE' } }
    ]);
  });

  test('retains mask and frame clipping flags for SVG composition', () => {
    const normalized = normalizeDocument([{ guid: { sessionID: 6, localID: 1 }, type: 'FRAME', mask: true, frameMaskDisabled: false }]);
    expect(normalized.nodesById['6:1']).toMatchObject({ mask: true, frameMaskDisabled: false });
  });
});
