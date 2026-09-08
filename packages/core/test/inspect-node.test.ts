import { expect, test } from 'vitest';
import { inspectNode, type InspectedNode } from '../src/context/inspect-node.js';
import type { AgentDocument } from '../src/normalize/document.js';

const document: AgentDocument = {
  contractVersion: '1',
  originFileKey: 'LOCAL_FILE',
  rootIds: ['1:1'],
  nodesById: {
    '1:1': {
      id: '1:1', name: 'Card', type: 'FRAME', childIds: ['1:2', '1:3'], zIndex: 0,
      bounds: { x: 10, y: 20, width: 320, height: 180 }, layout: { stackMode: 'VERTICAL' }, visible: true,
      assetRefs: [{ hash: 'a'.repeat(40), path: 'assets/images/secret.png', kind: 'image-fill' }],
      vectorRef: { blobId: 7, path: 'assets/vectors/vector-network-7.bin.gz', format: 'kiwi-vector-network', compression: 'gzip' }
    },
    '1:2': { id: '1:2', name: 'Button', type: 'INSTANCE', parentId: '1:1', childIds: ['1:4'], zIndex: 1, typography: { fontSize: 16 }, assetRefs: [] },
    '1:3': { id: '1:3', name: 'Hidden sibling', type: 'RECTANGLE', parentId: '1:1', childIds: [], zIndex: 2, assetRefs: [] },
    '1:4': { id: '1:4', name: 'Label', type: 'TEXT', parentId: '1:2', childIds: [], zIndex: 3, text: 'Buy now', assetRefs: [] }
  }
};

test('returns a bounded safe node summary in child order', () => {
  const result = inspectNode(document, document.nodesById['1:1']!, { depth: 1, maxChildren: 1 });

  expect(result).toMatchObject({
    schemaVersion: '1',
    source: { nodeId: '1:1', originFileKey: 'LOCAL_FILE' },
    limits: { depth: 1, maxChildren: 1 },
    selection: {
      id: '1:1', name: 'Card', bounds: { width: 320 }, layout: { stackMode: 'VERTICAL' }, visible: true,
      component: null, assets: { imageFillCount: 1, hasVector: true }, childCount: 2,
      children: [{ id: '1:2', name: 'Button', component: { type: 'INSTANCE' }, childCount: 1, children: [] }]
    }
  });
  expect(result.omitted).toEqual(['node 1:1: 1 children omitted by maxChildren limit (1)', 'node 1:2: 1 children omitted by depth limit (1)']);
  expect(JSON.stringify(result)).not.toContain('assets/images/secret.png');
  expect(JSON.stringify(result)).not.toContain('a'.repeat(40));
  expect(JSON.stringify(result)).not.toContain('vector-network-7.bin.gz');
});

test('uses bounded defaults and clamps oversized limits', () => {
  expect(inspectNode(document, document.nodesById['1:1']!).limits).toEqual({ depth: 2, maxChildren: 20 });
  expect(inspectNode(document, document.nodesById['1:1']!, { depth: 99, maxChildren: 999 }).limits).toEqual({ depth: 5, maxChildren: 100 });
});

test('caps the complete summary at 1000 nodes', () => {
  const nodesById: AgentDocument['nodesById'] = {
    '1:1': { id: '1:1', name: 'Root', type: 'FRAME', childIds: [], zIndex: 0, assetRefs: [] }
  };
  for (let parent = 0; parent < 100; parent += 1) {
    const parentId = `2:${parent}`;
    nodesById['1:1']!.childIds.push(parentId);
    nodesById[parentId] = { id: parentId, name: parentId, type: 'FRAME', parentId: '1:1', childIds: [], zIndex: parent + 1, assetRefs: [] };
    for (let child = 0; child < 100; child += 1) {
      const childId = `3:${parent * 100 + child}`;
      nodesById[parentId]!.childIds.push(childId);
      nodesById[childId] = { id: childId, name: childId, type: 'TEXT', parentId, childIds: [], zIndex: child, assetRefs: [] };
    }
  }
  const result = inspectNode({ contractVersion: '1', rootIds: ['1:1'], nodesById }, nodesById['1:1']!, { depth: 2, maxChildren: 100 });

  expect(countNodes(result.selection)).toBe(1000);
  expect(result.omitted).toContain('node 1:1: 90 children omitted by node limit (1000)');
});

function countNodes(node: InspectedNode): number {
  return 1 + node.children.reduce((total, child) => total + countNodes(child), 0);
}
