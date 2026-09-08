import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, test } from 'vitest';

test('loads inspect_node and returns a bounded summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'figctx-mcp-'));
  const bundle = join(root, 'bundle');
  await mkdir(join(bundle, 'tokens'), { recursive: true });
  await Promise.all([
    writeFile(join(bundle, 'manifest.json'), '{}'),
    writeFile(join(bundle, 'document.agent.json'), JSON.stringify({ contractVersion: '1', rootIds: ['1:1'], nodesById: {
      '1:1': { id: '1:1', name: 'Frame', type: 'FRAME', childIds: ['1:2'], zIndex: 0, assetRefs: [] },
      '1:2': { id: '1:2', name: 'Text', type: 'TEXT', parentId: '1:1', childIds: [], zIndex: 1, assetRefs: [] }
    } })),
    ...['colors', 'typography', 'effects'].map((name) => writeFile(join(bundle, `tokens/${name}.json`), JSON.stringify({ tokens: [] }))),
    writeFile(join(bundle, 'tokens/fonts.json'), JSON.stringify({ fonts: [] }))
  ]);

  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/main.js', import.meta.url)), '--root', bundle], stderr: 'pipe' });
  const client = new Client({ name: 'figctx-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'list_frames', 'list_frame_summaries', 'search_nodes', 'get_node_context', 'get_frame_bundle',
      'review_visual_match', 'get_vector_svg', 'get_style_tokens', 'get_asset', 'inspect_node'
    ]);
    const result = await client.callTool({ name: 'inspect_node', arguments: { reference: '1:1', depth: 0, maxChildren: 1 } });
    const content = result.content[0] as { type: string; text: string };
    expect(JSON.parse(content.text)).toMatchObject({ limits: { depth: 0, maxChildren: 1 }, selection: { id: '1:1', children: [] }, omitted: ['node 1:1: 1 children omitted by depth limit (0)'] });
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
