import type { AgentDocument } from '@figctx/core';

export interface FrameSummaryPageOptions { cursor?: number; limit?: number; }

function frameNodes(document: AgentDocument) {
  return Object.values(document.nodesById).filter((node) => node.type === 'FRAME' || node.type === 'CANVAS');
}

export function pageFrames(document: AgentDocument, options: FrameSummaryPageOptions = {}) {
  const cursor = options.cursor ?? 0;
  const limit = options.limit ?? 100;
  const frames = frameNodes(document);
  const items = frames.slice(cursor, cursor + limit);
  const nextCursor = cursor + items.length;
  return { items, total: frames.length, ...(nextCursor < frames.length ? { nextCursor } : {}) };
}

export function pageFrameSummaries(document: AgentDocument, referenceNodeIds: ReadonlySet<string>, options: FrameSummaryPageOptions = {}) {
  const cursor = options.cursor ?? 0;
  const limit = options.limit ?? 100;
  const frames = frameNodes(document);
  const items = frames.slice(cursor, cursor + limit).map((node) => ({ id: node.id, name: node.name, type: node.type, ...(node.bounds === undefined ? {} : { bounds: node.bounds }), childCount: node.childIds.length, hasReference: referenceNodeIds.has(node.id) }));
  const nextCursor = cursor + items.length;
  return { items, total: frames.length, ...(nextCursor < frames.length ? { nextCursor } : {}) };
}
