import { expect, test } from 'vitest';
import { extractTokens } from '../src/tokens/extract.js';

test('deduplicates color, typography, and effect tokens with node references', () => {
  const tokens = extractTokens({ contractVersion: '1', rootIds: ['1:1'], nodesById: {
    '1:1': { id: '1:1', name: 'one', type: 'RECTANGLE', childIds: [], zIndex: 0, assetRefs: [], fills: [{ type: 'SOLID', color: { r: 1 } }], typography: { fontSize: 16, fontName: { family: 'Inter', style: 'Bold', postscript: 'Inter-Bold' } }, textLayout: { fontMetaData: [{ fontWeight: 700 }] }, effects: [{ type: 'DROP_SHADOW' }] },
    '1:2': { id: '1:2', name: 'two', type: 'RECTANGLE', childIds: [], zIndex: 1, assetRefs: [], fills: [{ type: 'SOLID', color: { r: 1 } }], typography: { fontSize: 16, fontName: { family: 'Inter', style: 'Bold', postscript: 'Inter-Bold' } }, textLayout: { fontMetaData: [{ fontWeight: 700 }] }, effects: [{ type: 'DROP_SHADOW' }] }
  } });
  expect(tokens.colors[0]!.nodeIds).toEqual(['1:1', '1:2']);
  expect(tokens.typography[0]!.nodeIds).toEqual(['1:1', '1:2']);
  expect(tokens.effects[0]!.nodeIds).toEqual(['1:1', '1:2']);
  expect(tokens.fonts).toMatchObject([{ family: 'Inter', style: 'Bold', postscript: 'Inter-Bold', weights: [700], nodeIds: ['1:1', '1:2'] }]);
});

test('extracts Figma variable collections and mode values', async () => {
  const module = await import('../src/tokens/extract.js') as typeof import('../src/tokens/extract.js') & {
    extractVariables?: (changes: readonly Record<string, unknown>[]) => unknown;
  };

  expect(module.extractVariables).toBeTypeOf('function');
  expect(module.extractVariables!([
    { guid: { sessionID: 1, localID: 10 }, type: 'VARIABLE_SET', name: 'Colors', variableSetModes: [{ id: { sessionID: 1, localID: 0 }, name: 'Light' }] },
    { guid: { sessionID: 1, localID: 11 }, type: 'VARIABLE', name: 'Brand', variableResolvedType: 'COLOR', variableSetID: { guid: { sessionID: 1, localID: 10 } }, variableDataValues: { entries: [{ modeID: { sessionID: 1, localID: 0 }, variableData: { value: { colorValue: { r: 1, g: 0, b: 0, a: 1 } }, dataType: 'COLOR', resolvedDataType: 'COLOR' } }] } }
  ])).toEqual({
    collections: [{ id: '1:10', name: 'Colors', modes: [{ id: '1:0', name: 'Light' }], variables: [{ id: '1:11', name: 'Brand', resolvedType: 'COLOR', values: [{ modeId: '1:0', value: { colorValue: { r: 1, g: 0, b: 0, a: 1 } }, dataType: 'COLOR', resolvedType: 'COLOR' }] }] }],
    ungrouped: []
  });
});
