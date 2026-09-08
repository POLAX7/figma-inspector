import { expect, test } from 'vitest';
import { publicToolNames, publicToolSchemas } from '../src/tool-schemas.js';

test('keeps existing MCP tool names and input fields stable', () => {
  expect(Object.values(publicToolNames)).toEqual([
    'list_frames', 'list_frame_summaries', 'search_nodes', 'get_node_context',
    'get_frame_bundle', 'get_vector_svg', 'get_style_tokens', 'get_asset', 'inspect_node'
  ]);
  expect(Object.keys(publicToolSchemas.list_frame_summaries)).toEqual(['cursor', 'limit']);
  expect(Object.keys(publicToolSchemas.search_nodes)).toEqual(['query', 'type', 'limit']);
  expect(Object.keys(publicToolSchemas.get_node_context)).toEqual(['reference']);
  expect(Object.keys(publicToolSchemas.get_frame_bundle)).toEqual(['reference']);
  expect(Object.keys(publicToolSchemas.get_vector_svg)).toEqual(['reference']);
  expect(Object.keys(publicToolSchemas.get_asset)).toEqual(['hash']);
});

test('bounds compact inspection controls', () => {
  const schema = publicToolSchemas.inspect_node;
  expect(Object.keys(schema)).toEqual(['reference', 'depth', 'maxChildren']);
  expect(schema.depth.safeParse(0).success).toBe(true);
  expect(schema.depth.safeParse(5).success).toBe(true);
  expect(schema.depth.safeParse(6).success).toBe(false);
  expect(schema.maxChildren.safeParse(100).success).toBe(true);
  expect(schema.maxChildren.safeParse(101).success).toBe(false);
});
