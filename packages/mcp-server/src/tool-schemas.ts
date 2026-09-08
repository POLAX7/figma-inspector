import { z } from 'zod';

export const publicToolNames = {
  listFrames: 'list_frames',
  listFrameSummaries: 'list_frame_summaries',
  searchNodes: 'search_nodes',
  getNodeContext: 'get_node_context',
  getFrameBundle: 'get_frame_bundle',
  getVectorSvg: 'get_vector_svg',
  getStyleTokens: 'get_style_tokens',
  getAsset: 'get_asset',
  inspectNode: 'inspect_node'
} as const;

export const publicToolSchemas = {
  list_frames: { cursor: z.number().int().nonnegative().optional(), limit: z.number().int().positive().max(30).optional() },
  list_frame_summaries: { cursor: z.number().int().nonnegative().optional(), limit: z.number().int().positive().max(30).optional() },
  search_nodes: { query: z.string(), type: z.string().optional(), limit: z.number().int().positive().max(30).optional() },
  get_node_context: { reference: z.string() },
  get_frame_bundle: { reference: z.string() },
  get_vector_svg: { reference: z.string() },
  get_asset: { hash: z.string().regex(/^[a-f0-9]{40}$/) },
  inspect_node: { reference: z.string(), depth: z.number().int().nonnegative().max(5).optional(), maxChildren: z.number().int().nonnegative().max(100).optional() }
} as const;
