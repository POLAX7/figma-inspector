import { expect, test } from 'vitest';
import { normalizeDocument } from '@figctx/core';

const loadSummaries = () => import('../src/frame-summaries.js').catch(() => ({}));

test('returns compact frame summaries in sequential batches', async () => {
  const { pageFrameSummaries } = await loadSummaries() as { pageFrameSummaries?: (document: ReturnType<typeof normalizeDocument>, referenceNodeIds: ReadonlySet<string>, options?: { cursor?: number; limit?: number }) => { items: Array<{ id: string; hasReference: boolean }>; total: number; nextCursor?: number } };
  const document = normalizeDocument([
    { guid: { sessionID: 1, localID: 1 }, type: 'CANVAS', name: 'Canvas' },
    { guid: { sessionID: 1, localID: 2 }, type: 'FRAME', name: 'First', parentIndex: 0 },
    { guid: { sessionID: 1, localID: 3 }, type: 'FRAME', name: 'Second', parentIndex: 0 },
    { guid: { sessionID: 1, localID: 4 }, type: 'TEXT', name: 'Ignored', parentIndex: 0 }
  ]);

  expect(pageFrameSummaries).toBeTypeOf('function');
  expect(pageFrameSummaries!(document, new Set(['1:2']), { limit: 2 })).toEqual({
    items: [expect.objectContaining({ id: '1:1', hasReference: false }), expect.objectContaining({ id: '1:2', hasReference: true })],
    total: 3,
    nextCursor: 2
  });
  expect(pageFrameSummaries!(document, new Set(['1:2']), { cursor: 2, limit: 2 })).toEqual({
    items: [expect.objectContaining({ id: '1:3', hasReference: false })],
    total: 3
  });
});
