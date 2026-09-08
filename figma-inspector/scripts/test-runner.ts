/**
 * test-runner.ts
 * 
 * Verifies prune-figma-node and inspection-decision algorithms.
 */

import { pruneFigmaNode, colorToHex, calculateCompressionStats } from './prune-figma-node.ts';
import { evaluateNodeForFallback, resolveRecommendedTool, resolveFallbackStage, validateInspectionNode, validateFigmaNodesResponse } from './inspection-decision.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

console.log('--- Running Tests for Figma Inspector Engine ---\n');

// 1. Test color conversion
console.log('Test 1: Color to Hex conversion');
assert(colorToHex({ r: 1, g: 1, b: 1 }) === '#FFFFFF', 'Pure white to #FFFFFF');
assert(colorToHex({ r: 0, g: 0, b: 0 }) === '#000000', 'Pure black to #000000');
assert(colorToHex({ r: 0.09411765, g: 0.38039216, b: 0.98039216 }) === '#1861FA', 'Figma blue conversion');
assert(colorToHex({ r: 1, g: 0, b: 0 }, 0.5) === 'rgba(255, 0, 0, 0.5)', 'Semi-transparent red to rgba');

// 2. Test Deep Node Pruning
console.log('\nTest 2: Full-Depth AST Pruning with Alert-Shaped Synthetic Structure');
const syntheticFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/alert-shaped.synthetic.json', import.meta.url), 'utf-8'));
const syntheticMetadata = JSON.parse(fs.readFileSync(new URL('../fixtures/alert-shaped.synthetic.meta.json', import.meta.url), 'utf-8'));
assert(syntheticMetadata.sourceType === 'synthetic', 'Fixture metadata identifies synthetic provenance');
assert(syntheticMetadata.schemaVersion === '1.0.0' && syntheticMetadata.authorized === true, 'Fixture metadata records schema and authorization');
assert(typeof syntheticMetadata.testCommand === 'string' && syntheticMetadata.testCommand.length > 0, 'Fixture metadata records the consuming test command');
assert(syntheticFixture.type === 'INSTANCE', 'Synthetic fixture records an instance node');
assert(pruneFigmaNode(syntheticFixture).children?.length === 2, 'Synthetic fixture can be pruned from disk');
const mockAlertNode = {
  id: '1518:55106',
  name: 'Alert',
  type: 'INSTANCE',
  visible: true,
  opacity: 1,
  blendMode: 'PASS_THROUGH',
  componentProperties: {
    Type: { type: 'VARIANT', value: 'Warning' },
    ShowIcon: { type: 'BOOLEAN', value: true }
  },
  layoutGrow: 1,
  absoluteBoundingBox: { x: 754, y: 2943, width: 355, height: 240 },
  relativeTransform: [[1, 0, 754], [0, 1, 2943]],
  layoutMode: 'VERTICAL',
  itemSpacing: 24,
  paddingLeft: 24,
  paddingRight: 24,
  paddingTop: 36,
  paddingBottom: 36,
  primaryAxisAlignItems: 'CENTER',
  counterAxisAlignItems: 'CENTER',
  cornerRadius: 8,
  fills: [
    {
      type: 'SOLID',
      color: { r: 1, g: 1, b: 1 },
      visible: true,
      opacity: 1
    }
  ],
  strokes: [],
  exportSettings: [{ format: 'PNG' }],
  transitionNodeID: null,
  children: [
    {
      id: 'I1518:55106;10:1',
      name: 'Header Container',
      type: 'FRAME',
      visible: true,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 12,
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
      rectangleCornerRadii: [8, 8, 0, 0],
      children: [
        {
          id: 'I1518:55106;10:2',
          name: 'Warning Icon',
          type: 'VECTOR',
          visible: true,
          absoluteBoundingBox: { x: 778, y: 2979, width: 24, height: 24 },
          vectorData: 'M12 2L2 22h20L12 2zm0 4l7.5 13H4.5L12 6z' // mock large vector
        },
        {
          id: 'I1518:55106;10:3',
          name: 'Alert Title',
          type: 'TEXT',
          visible: true,
          characters: '提醒通知',
          style: {
            fontFamily: 'PingFang TC',
            fontWeight: 600,
            fontSize: 18,
            lineHeightPx: 26,
            textAlignHorizontal: 'CENTER'
          },
          fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 }, opacity: 1, visible: true, blendMode: 'NORMAL' }],
          constraints: { vertical: 'TOP', horizontal: 'LEFT' },
          relativeTransform: [[1, 0, 810], [0, 1, 2980]],
          exportSettings: [],
          effects: [],
          strokes: []
        }
      ],
      constraints: { vertical: 'TOP', horizontal: 'LEFT' },
      relativeTransform: [[1, 0, 754], [0, 1, 2960]],
      exportSettings: [],
      effects: [],
      strokes: [],
      clipsContent: false,
      blendMode: 'PASS_THROUGH'
    },
    {
      id: 'I1518:55106;20:1',
      name: 'Alert Body',
      type: 'TEXT',
      visible: true,
      characters: '您的變更將會影響所有套用此範本的信件，請確認是否繼續執行？',
      style: {
        fontFamily: 'PingFang TC',
        fontWeight: 400,
        fontSize: 14,
        lineHeightPx: 20,
        lineHeightPercent: 142.85,
        lineHeightUnit: 'PIXELS',
        letterSpacing: 0,
        italic: false
      },
      fills: [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 }, opacity: 1, visible: true, blendMode: 'NORMAL' }],
      constraints: { vertical: 'TOP', horizontal: 'LEFT' },
      relativeTransform: [[1, 0, 778], [0, 1, 3020]],
      exportSettings: [],
      effects: [],
      strokes: [],
      blendMode: 'PASS_THROUGH'
    },
    {
      id: 'I1518:55106;30:1',
      name: 'Action Button',
      type: 'FRAME',
      visible: true,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 8,
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 8,
      paddingBottom: 8,
      cornerRadius: 4,
      fills: [{ type: 'SOLID', color: { r: 0.0941, g: 0.38, b: 0.98 }, opacity: 1, visible: true, blendMode: 'NORMAL' }],
      constraints: { vertical: 'TOP', horizontal: 'LEFT' },
      relativeTransform: [[1, 0, 778], [0, 1, 3100]],
      exportSettings: [],
      effects: [],
      strokes: [],
      clipsContent: false,
      blendMode: 'PASS_THROUGH',
      children: [
        {
          id: 'I1518:55106;30:2',
          name: 'Button Text',
          type: 'TEXT',
          visible: true,
          characters: '確定套用',
          style: {
            fontFamily: 'PingFang TC',
            fontWeight: 500,
            fontSize: 14,
            lineHeightPercent: 100,
            lineHeightUnit: 'FONT_SIZE_%',
            letterSpacing: 0,
            italic: false
          },
          fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1, visible: true, blendMode: 'NORMAL' }],
          constraints: { vertical: 'TOP', horizontal: 'LEFT' },
          relativeTransform: [[1, 0, 800], [0, 1, 3110]],
          exportSettings: [],
          effects: [],
          strokes: [],
          blendMode: 'PASS_THROUGH'
        }
      ]
    }
  ]
};

const pruned = pruneFigmaNode(mockAlertNode);

// Verify hierarchy depth is 100% intact
assert(pruned.id === '1518:55106', 'Root ID preserved');
assert(pruned.children?.length === 3, 'All 3 direct children preserved');
assert(pruned.children?.[0].children?.length === 2, 'Nested Header children preserved (Icon + Title)');
assert(pruned.children?.[0].children?.[1].text?.content === '提醒通知', 'Leaf text content preserved');
assert(pruned.children?.[2].children?.[0].text?.content === '確定套用', 'Leaf button text preserved');
assert(pruned.style?.fill === '#FFFFFF', 'Root fill correctly converted to #FFFFFF');
assert(pruned.style?.radius === 8, 'Root corner radius preserved');
assert(pruned.layout?.gap === 24, 'Auto layout gap preserved');
assert(pruned.layout?.padding === '36px 24px 36px 24px', 'Auto layout padding formatted to CSS standard');

// New P1 assertions: Props, Flex, Radius format, Icon hint
assert(pruned.props?.Type === 'Warning', 'Component variant prop Type extracted');
assert(pruned.props?.ShowIcon === true, 'Component boolean prop ShowIcon extracted');
assert(pruned.layout?.flex === 1, 'Auto layout layoutGrow: 1 mapped to flex: 1');
assert(pruned.children?.[0].style?.radius === '8px 8px 0px 0px', '4-corner radii formatted to CSS shorthand string');
assert(pruned.children?.[0].children?.[0].icon?.name === 'Warning Icon', 'Vector node icon name extracted');
assert(pruned.children?.[0].children?.[0].icon?.size === '24x24', 'Vector node icon size extracted');

const richTextNode = pruneFigmaNode({
  id: '1:rich', name: 'Rich Label', type: 'TEXT', characters: 'Rich',
  style: {
    fontFamily: 'Inter', fontSize: 16, fontWeight: 500, lineHeightPercent: 120,
    lineHeightUnit: 'FONT_SIZE_%', letterSpacing: 0.5, textCase: 'UPPER', textDecoration: 'UNDERLINE'
  },
  fills: [
    { type: 'GRADIENT_LINEAR', gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0 } }] },
    { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }
  ],
  effects: [
    { type: 'INNER_SHADOW', offset: { x: 0, y: 1 }, radius: 2, color: { r: 0, g: 0, b: 0, a: 0.2 } },
    { type: 'LAYER_BLUR', radius: 4 }
  ]
}, { fidelity: 'render-critical' } as any);
assert(richTextNode.text?.letterSpacing === 0.5, 'Text letter spacing is preserved');
assert(richTextNode.text?.textCase === 'UPPER', 'Text case is preserved');
assert(richTextNode.text?.textDecoration === 'UNDERLINE', 'Text decoration is preserved');
assert(richTextNode.unsupportedProperties?.includes('fills'), 'Unsupported gradient or multiple fills are explicitly marked');
assert(richTextNode.unsupportedProperties?.includes('effects'), 'Unsupported inner shadow or blur effects are explicitly marked');
const fontFallbackNode = pruneFigmaNode({
  id: '1:font-fallback', name: 'Fallback Label', type: 'TEXT', characters: '通知',
  style: { fontSize: 14, lineHeightPx: 20 }
});
assert(fontFallbackNode.text?.content === '通知', 'Font fallback fixture preserves text content');
assert(fontFallbackNode.text?.font === '14px sans-serif 400', 'Font fallback fixture uses explicit sans-serif fallback');

const geometryAndAssetNode = pruneFigmaNode({
  id: '1:geometry', name: 'Masked Image', type: 'FRAME', rotation: 12,
  clipsContent: true, isMask: true, blendMode: 'MULTIPLY', opacity: 0.75,
  fills: [{ type: 'IMAGE', imageRef: 'private-image-ref', scaleMode: 'FILL' }],
  strokes: [
    { type: 'SOLID', color: { r: 0, g: 0, b: 0 } },
    { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }
  ],
  children: [{
    id: '1:mixed', name: 'Mixed Text', type: 'TEXT', characters: 'Mixed',
    style: { fontFamily: 'Inter', fontSize: 14 },
    characterStyleOverrides: [0, 1], styleOverrideTable: { '1': { fontSize: 18 } }
  }]
}, { fidelity: 'render-critical' } as any);
assert(geometryAndAssetNode.style?.opacity === 0.75, 'Node opacity is preserved');
assert(geometryAndAssetNode.unsupportedProperties?.includes('fills'), 'Image fills are explicitly marked');
assert(geometryAndAssetNode.unsupportedProperties?.includes('strokes'), 'Multiple strokes are explicitly marked');
assert(geometryAndAssetNode.unsupportedProperties?.includes('blendMode'), 'Non-default blend mode is explicitly marked');
assert(geometryAndAssetNode.unsupportedProperties?.includes('rotation'), 'Rotation is explicitly marked');
assert(geometryAndAssetNode.unsupportedProperties?.includes('clipsContent'), 'Clipping and mask geometry are explicitly marked');
assert(geometryAndAssetNode.children?.[0].unsupportedProperties?.includes('textStyles'), 'Mixed text styles are explicitly marked');

const layoutBoundaryNode = pruneFigmaNode({
  id: '1:layout-boundary', name: 'Hidden Overlay', type: 'FRAME', visible: false,
  layoutPositioning: 'ABSOLUTE', minWidth: 120, maxWidth: 480, minHeight: 24, maxHeight: 96,
  layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG', children: []
}, { fidelity: 'render-critical' } as any);
assert(layoutBoundaryNode.unsupportedProperties?.includes('absolutePositioning'), 'Absolute positioning is explicitly marked');
assert(layoutBoundaryNode.unsupportedProperties?.includes('sizingConstraints'), 'Min/max and layout sizing are explicitly marked');
assert(layoutBoundaryNode.unsupportedProperties?.includes('invisibleOverlay'), 'Invisible overlay nodes are explicitly marked');

const semanticNode = pruneFigmaNode(syntheticFixture, { fidelity: 'semantic' });
assert(!semanticNode.layout && !semanticNode.style, 'Semantic fidelity omits render layout and style data');
assert(semanticNode.props?.Type === 'Warning' && semanticNode.children?.length === 2, 'Semantic fidelity preserves props and hierarchy');
const losslessNode = pruneFigmaNode(syntheticFixture, { fidelity: 'lossless-ast' });
assert(losslessNode.renderMetadata?.fills !== undefined, 'Lossless fidelity preserves original render metadata');
const vectorFixture = {
  id: '1:vector-fixture', name: 'Warning Icon', type: 'VECTOR',
  absoluteBoundingBox: { width: 24, height: 24 },
  vectorPaths: [{ path: 'M0 0L24 24', windingRule: 'NONZERO' }]
};
const vectorSemanticNode = pruneFigmaNode(vectorFixture, { fidelity: 'render-critical' });
assert(vectorSemanticNode.icon?.name === 'Warning Icon', 'Vector render-critical output keeps semantic icon hint');
assert(vectorSemanticNode.unsupportedProperties?.includes('vectorPaths'), 'Render-critical output marks vector paths as unsupported');
const vectorLosslessNode = pruneFigmaNode(vectorFixture, { fidelity: 'lossless-ast' });
assert(vectorLosslessNode.renderMetadata?.vectorPaths !== undefined, 'Lossless fidelity preserves original vector paths');
const unconvertedRenderFixture = {
  id: '1:render-metadata', name: 'Gradient Geometry', type: 'RECTANGLE',
  fillGeometry: [{ path: 'M0 0L1 1', windingRule: 'NONZERO' }]
};
const unconvertedRenderCritical = pruneFigmaNode(unconvertedRenderFixture, { fidelity: 'render-critical' });
assert(unconvertedRenderCritical.unsupportedProperties?.includes('fillGeometry'), 'Render-critical output marks unconverted fill geometry');
const unconvertedLossless = pruneFigmaNode(unconvertedRenderFixture, { fidelity: 'lossless-ast' });
assert(unconvertedLossless.renderMetadata?.fillGeometry !== undefined, 'Lossless fidelity preserves unconverted fill geometry');
const strokeGeometryFixture = {
  id: '1:stroke-geometry', name: 'Outlined Icon', type: 'VECTOR',
  strokeGeometry: [{ path: 'M0 0L24 24', windingRule: 'NONZERO' }]
};
const strokeCritical = pruneFigmaNode(strokeGeometryFixture, { fidelity: 'render-critical' });
assert(strokeCritical.unsupportedProperties?.includes('strokeGeometry'), 'Render-critical output marks unconverted stroke geometry');
const strokeLossless = pruneFigmaNode(strokeGeometryFixture, { fidelity: 'lossless-ast' });
assert(strokeLossless.renderMetadata?.strokeGeometry !== undefined, 'Lossless fidelity preserves unconverted stroke geometry');
const unknownRenderFixture = {
  id: '1:unknown-render', name: 'Unknown Render', type: 'FRAME',
  customRenderGeometry: { path: 'M0 0L1 1' }
};
const unknownRenderCritical = pruneFigmaNode(unknownRenderFixture, { fidelity: 'render-critical' });
assert(unknownRenderCritical.unsupportedProperties?.includes('customRenderGeometry'), 'Render-critical output marks unknown render geometry');
const unknownRenderLossless = pruneFigmaNode(unknownRenderFixture, { fidelity: 'lossless-ast' });
assert(unknownRenderLossless.renderMetadata?.customRenderGeometry !== undefined, 'Lossless fidelity preserves unknown render geometry');
const boundsFixture = {
  id: '1:render-bounds', name: 'Render Bounds', type: 'FRAME',
  absoluteRenderBounds: { x: 10, y: 20, width: 100, height: 40 }
};
const boundsCritical = pruneFigmaNode(boundsFixture, { fidelity: 'render-critical' });
assert(boundsCritical.unsupportedProperties?.includes('absoluteRenderBounds'), 'Render-critical output marks unconverted render bounds');
const boundsLossless = pruneFigmaNode(boundsFixture, { fidelity: 'lossless-ast' });
assert(boundsLossless.renderMetadata?.absoluteRenderBounds !== undefined, 'Lossless fidelity preserves render bounds');

// Compression benchmark uses three synthetic complexity tiers; it is not a claim about all Figma files.
const benchmarkInputs = [
  { name: 'leaf', node: { id: 'bench:leaf', name: 'Label', type: 'TEXT', characters: 'Label', style: { fontSize: 14 } } },
  { name: 'component', node: syntheticFixture },
  { name: 'rich', node: { ...syntheticFixture, children: [...(syntheticFixture.children || []), geometryAndAssetNode] } }
];
const benchmarkStats = benchmarkInputs.map(({ name, node }) => {
  const compact = pruneFigmaNode(node);
  const stats = calculateCompressionStats(node, compact);
  return { name, savingsPercent: stats.savingsPercent };
});
const sortedSavings = benchmarkStats.map((item) => item.savingsPercent).sort((a, b) => a - b);
const benchmarkMedian = sortedSavings[Math.floor(sortedSavings.length / 2)];
console.log(`\nSynthetic compression benchmark: min=${sortedSavings[0]}%, median=${benchmarkMedian}%, max=${sortedSavings[sortedSavings.length - 1]}%`);
assert(benchmarkStats.length === 3, 'Compression benchmark covers leaf, component, and rich tiers');
assert(sortedSavings[0] <= benchmarkMedian && benchmarkMedian <= sortedSavings[2], 'Compression benchmark reports ordered min/median/max values');

// Verify token savings
const stats = calculateCompressionStats(mockAlertNode, pruned);
assert(stats.rawCharacterProxy !== undefined && stats.compactCharacterProxy !== undefined, 'Compression stats label character proxies explicitly');
assert(stats.charactersSaved !== undefined, 'Compression stats reports character proxy savings');
console.log(`\nCompression Stats:`);
console.log(`- Raw Size: ${stats.rawBytes} bytes (~${stats.rawCharacterProxy} character proxy)`);
console.log(`- Pruned Size: ${stats.compactBytes} bytes (~${stats.compactCharacterProxy} character proxy)`);
console.log(`- Savings: ${stats.savingsPercent}% (Saved ~${stats.charactersSaved} character proxy)`);
assert(stats.savingsPercent >= 55, `Compression achieved >55% savings (Actual: ${stats.savingsPercent}%)`);

// 3. Test Decision Engine
console.log('\nTest 3: Heuristic Decision Engine');

// 3a. Leaf node (TEXT)
const leafResult = evaluateNodeForFallback({ id: '1:1', name: 'Some Label', type: 'TEXT' });
assert(!leafResult.shouldFallback, 'Leaf node should NOT fallback to API');
assert(leafResult.recommendation === 'DO_NOT_CALL_API', 'Leaf recommendation is DO_NOT_CALL_API');

// 3b. Empty frame without layout
const emptyFrameResult = evaluateNodeForFallback({ id: '1:2', name: 'Background Box', type: 'FRAME', childIds: [] });
assert(!emptyFrameResult.shouldFallback, 'Empty regular frame should NOT fallback to API');
const expandedInstanceResult = evaluateNodeForFallback({ id: '1:3', name: 'Alert', type: 'INSTANCE', childIds: [], resolvedChildIds: ['1:4'] }, 'lk-local-export');
assert(!expandedInstanceResult.shouldFallback && expandedInstanceResult.recommendation === 'DO_NOT_CALL_API', 'Expanded local instance should stop before API fallback');

// 3c. Unhydrated Alert instance with cloud key vs lk- local key
const actualAlertNodeFromFigmaFree = {
  id: '1518:55106',
  name: 'Alert',
  type: 'INSTANCE',
  childIds: [],
  layout: {
    stackMode: 'VERTICAL',
    stackSpacing: 24,
    stackHorizontalPadding: 24,
    stackVerticalPadding: 36,
    stackPrimaryAlignItems: 'CENTER',
    stackCounterAlignItems: 'CENTER'
  }
};

const cloudKeyDecision = evaluateNodeForFallback(actualAlertNodeFromFigmaFree, 'EXfHitAQKwAIBHdY5fqa9A');
assert(cloudKeyDecision.shouldFallback, 'Unhydrated Alert instance with cloud key SHOULD trigger fallback');
assert(cloudKeyDecision.isLocalFileKey === false, 'Cloud key recognized as non-local');
assert(cloudKeyDecision.recommendation === 'LOCAL_SEARCH_FIRST', 'Recommends local search first for cloud key');
assert(cloudKeyDecision.recommendedTool?.tool === 'search_nodes', 'Cloud key recommendation tool is search_nodes');
assert(cloudKeyDecision.recommendedTool?.server === 'figma-free', 'Cloud key recommendation server is figma-free');
assert(!cloudKeyDecision.reasons.some((reason) => /confirms|definitely|100%/i.test(reason)), 'Heuristic reasons do not overstate child-layer certainty');
const encodedUrlDecision = evaluateNodeForFallback(
  { ...actualAlertNodeFromFigmaFree, id: '1431:38302' },
  'file/key'
);
assert(encodedUrlDecision.suggestedAction?.includes('/file%2Fkey/nodes?ids=1431%3A38302'), 'Suggested API URL encodes fileKey and nodeId');

const localKeyDecision = evaluateNodeForFallback(actualAlertNodeFromFigmaFree, 'lk-ca859ba73ce45a4497033bde');
assert(localKeyDecision.shouldFallback, 'Unhydrated Alert instance with lk- key flags fallback needed');
assert(localKeyDecision.isLocalFileKey === true, 'Local lk- key recognized correctly');
assert(localKeyDecision.recommendation === 'PROMPT_CLOUD_URL', 'lk- key triggers PROMPT_CLOUD_URL recommendation');
assert(resolveFallbackStage(cloudKeyDecision) === 'LOCAL_SEARCH', 'Cloud instance starts with local symbol search');
assert(resolveFallbackStage(cloudKeyDecision, true) === 'LOCAL_INSPECT', 'Local symbol hit stops cloud fallback');
assert(resolveFallbackStage(cloudKeyDecision, false) === 'CLOUD_HYDRATE', 'Local symbol miss proceeds to cloud hydrate');
assert(resolveFallbackStage(localKeyDecision) === 'USER_INPUT_REQUIRED', 'Local lk- instance requires cloud URL input');
console.log(`Reasons identified for lk- key: \n  ${localKeyDecision.reasons.join('\n  ')}`);

// 3e. Local .figctx evidence: an empty instance and its component definitions
// must remain separate facts so an omitted child tree is not reported as no text.
const localBundlePath = path.resolve(process.cwd(), '.figctx/mail-template/document.agent.json');
assert(fs.existsSync(localBundlePath), 'Local .figctx fixture is available for runtime verification');
const localBundle = JSON.parse(fs.readFileSync(localBundlePath, 'utf-8'));
const localInstance = localBundle.nodesById['1431:38302'];
assert(localInstance?.type === 'INSTANCE' && localInstance.childIds?.length === 0, 'Local fixture preserves the empty Alert instance export');
const localAlertFrame = localBundle.nodesById['30:3559'];
assert(localAlertFrame?.type === 'FRAME' && localAlertFrame.childIds?.length === 24, 'Local fixture preserves the Alert symbol container');
const localAlertText = Object.values(localBundle.nodesById).some((node: any) =>
  node.type === 'TEXT' && ['成功訊息', '提示訊息', '警告訊息', '錯誤訊息'].includes(node.name)
);
assert(localAlertText, 'Local Alert component definitions contain text layers');

// 3d. Granular Tool Selection Matrix tests
const screenTool = resolveRecommendedTool('LIST_SCREENS');
assert(screenTool.tool === 'list_frame_summaries', 'LIST_SCREENS maps to list_frame_summaries');
assert(screenTool.forbiddenAlternatives.some(f => f.includes('get_frame_bundle')), 'LIST_SCREENS explicitly forbids get_frame_bundle');

const tokenTool = resolveRecommendedTool('GET_DESIGN_TOKENS');
assert(tokenTool.tool === 'get_style_tokens', 'GET_DESIGN_TOKENS maps to get_style_tokens');

const iconTool = resolveRecommendedTool('EXTRACT_ICON_SVG', { nodeId: '10:2' });
assert(iconTool.tool === 'get_vector_svg', 'EXTRACT_ICON_SVG maps to get_vector_svg');
assert(iconTool.params.reference === '10:2', 'EXTRACT_ICON_SVG passes reference');

const cloudHydrateTool = resolveRecommendedTool('HYDRATE_INSTANCE', { fileKey: 'EXfHitAQKwAIBHdY5fqa9A', nodeId: '1518:55106' });
assert(cloudHydrateTool.server === 'figma', 'HYDRATE_INSTANCE maps to official figma MCP');
assert(cloudHydrateTool.tool === 'get_figma_data', 'HYDRATE_INSTANCE maps to get_figma_data');
assert(cloudHydrateTool.params.nodeId === '1518:55106', 'HYDRATE_INSTANCE requires nodeId');
assert(cloudHydrateTool.forbiddenAlternatives.some(f => f.includes('without nodeId')), 'HYDRATE_INSTANCE forbids calling get_figma_data without nodeId');


// 4. Test Cache Manager
console.log('\nTest 4: Cache Manager (Persistence, Retrieval & SHA Auto-Invalidation)');
import { FigmaCacheManager } from './cache-manager.ts';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const tempCacheDir = path.join(os.tmpdir(), 'figma-cache-test-' + Date.now());
const cacheManager = new FigmaCacheManager(tempCacheDir);

const testFileKey = 'mockFile123';
const testNodeId = '1518:55106';

assert(!cacheManager.has(testFileKey, testNodeId), 'Cache should initially be empty');
const savedPath = cacheManager.set(testFileKey, testNodeId, 'Alert', pruned, { sourceSha256: 'sha_version_1' });
console.log(`Saved cache file to: ${savedPath}`);
assert(path.basename(savedPath).includes(testFileKey), 'Cache filename includes the fileKey identity');
assert(path.basename(savedPath).includes('schema-1.0.0'), 'Cache filename includes the schema identity');
assert(path.basename(savedPath).includes('1518-55106'), 'Cache filename includes the nodeId identity');
assert(cacheManager.has(testFileKey, testNodeId), 'Cache should exist after set()');

const cachedEntry = cacheManager.get(testFileKey, testNodeId);
assert(cachedEntry !== null, 'Retrieved cache entry should not be null');
assert(cachedEntry?.ast.id === '1518:55106', 'Cached AST root ID matches');
assert(cachedEntry?.ast.children?.length === 3, 'Cached AST children preserved');
assert(cachedEntry?.sourceSha256 === 'sha_version_1', 'sourceSha256 stored in cache entry');

// A cache file can be copied or partially restored under the wrong request key;
// treating that entry as a hit could return another file's component AST.
const identityCachePath = cacheManager.getCacheFilePath(testFileKey, testNodeId);
fs.writeFileSync(identityCachePath, JSON.stringify({
  ...cachedEntry,
  fileKey: 'different-file',
}));
assert(!cacheManager.has(testFileKey, testNodeId), 'Cache entry with mismatched fileKey is a miss');
cacheManager.set(testFileKey, testNodeId, 'Alert', pruned, { sourceSha256: 'sha_version_1' });
fs.writeFileSync(identityCachePath, JSON.stringify({
  ...cachedEntry,
  nodeId: 'different-node',
}));
assert(!cacheManager.has(testFileKey, testNodeId), 'Cache entry with mismatched nodeId is a miss');
cacheManager.set(testFileKey, testNodeId, 'Alert', pruned, { sourceSha256: 'sha_version_1' });

// Test auto-invalidation when source SHA differs
cacheManager.getSourceSha256 = () => 'sha_version_2_updated';
assert(!cacheManager.has(testFileKey, testNodeId), 'Cache should auto-invalidate when sourceSha256 differs');
assert(cacheManager.get(testFileKey, testNodeId) === null, 'get() should return null after auto-invalidation');

cacheManager.clear();
assert(!cacheManager.has(testFileKey, testNodeId), 'Cache should remain empty after clear()');
(cacheManager as any).getSourceSha256 = () => null;
let concurrentLoaderCalls = 0;
const concurrentEntries = await Promise.all(Array.from({ length: 3 }, () => cacheManager.getOrSet(
  testFileKey,
  testNodeId,
  async () => {
    concurrentLoaderCalls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { componentName: 'Alert', ast: pruned, sourceSha256: 'sha_version_3' };
  }
)));
assert(concurrentLoaderCalls === 1, 'Concurrent cache misses share one loader call');
assert(concurrentEntries.every((entry) => entry.ast.id === testNodeId), 'Concurrent cache callers receive the same cached AST');
fs.rmSync(tempCacheDir, { recursive: true, force: true });
assert(!fs.existsSync(tempCacheDir), 'Temporary custom cache directory is removed after focused validation');

// 4b. Bundle identity must fail closed instead of selecting the first bundle.
const figctxTestRoot = path.join(os.tmpdir(), 'figctx-cache-test-' + Date.now());
const bundleA = path.join(figctxTestRoot, 'design-a');
const bundleB = path.join(figctxTestRoot, 'design-b');
fs.mkdirSync(bundleA, { recursive: true });
fs.mkdirSync(bundleB, { recursive: true });
fs.writeFileSync(path.join(bundleA, 'manifest.json'), JSON.stringify({ originFileKey: 'file-a', sourceSha256: 'sha-a' }));
fs.writeFileSync(path.join(bundleB, 'manifest.json'), JSON.stringify({ originFileKey: 'file-b', sourceSha256: 'sha-b' }));
const figctxManager = new FigmaCacheManager();
(figctxManager as any).figctxRoot = figctxTestRoot;
(figctxManager as any).baseDir = null;
let unknownBundleRejected = false;
try {
  figctxManager.getCacheFilePath('file-unknown', testNodeId);
} catch {
  unknownBundleRejected = true;
}
assert(unknownBundleRejected, 'Unknown fileKey must not fall back to the first .figctx bundle');
assert(typeof figctxManager.getCacheDirectory() === 'string', '.figctx cache directory must resolve to a string');
const staleFigctxPath = path.join(bundleA, 'hydrated');
fs.mkdirSync(staleFigctxPath, { recursive: true });
const staleFigctxManager = new FigmaCacheManager();
(staleFigctxManager as any).figctxRoot = figctxTestRoot;
(staleFigctxManager as any).baseDir = null;
fs.writeFileSync(staleFigctxManager.getCacheFilePath('file-a', testNodeId), JSON.stringify({
  fileKey: 'file-a', nodeId: testNodeId, componentName: 'Alert', cachedAt: new Date().toISOString(),
  version: '1.0.0', schemaVersion: '1.0.0', ast: pruned
}));
assert(!staleFigctxManager.has('file-a', testNodeId), 'A .figctx cache without source SHA must not be treated as fresh');
fs.writeFileSync(path.join(bundleA, 'source.fig'), 'source');
fs.writeFileSync(path.join(bundleA, 'manifest.json'), JSON.stringify({
  originFileKey: 'file-a', sourceFilename: 'source.fig', sourceSha256: 'sha-a'
}));
staleFigctxManager.set('file-a', testNodeId, 'Alert', pruned, { sourceSha256: 'sha-a' });
fs.unlinkSync(path.join(bundleA, 'source.fig'));
assert(!staleFigctxManager.has('file-a', testNodeId), 'Cache must miss when the manifest source file is removed');
fs.writeFileSync(path.join(bundleA, 'manifest.json'), JSON.stringify({
  originFileKey: 'file-a', sourceFilename: 'source.fig'
}));
staleFigctxManager.set('file-a', testNodeId, 'Alert', pruned, { sourceSha256: 'sha-a' });
assert(!staleFigctxManager.has('file-a', testNodeId), 'Cache must miss when manifest source SHA is missing');
const corruptCachePath = staleFigctxManager.getCacheFilePath('file-a', testNodeId);
fs.mkdirSync(path.dirname(corruptCachePath), { recursive: true });
fs.writeFileSync(corruptCachePath, '{ malformed json');
assert(!staleFigctxManager.has('file-a', testNodeId), 'Malformed cache JSON must be removed and treated as a miss');
assert(!fs.existsSync(corruptCachePath), 'Malformed cache JSON file is removed from disk');
staleFigctxManager.set('file-a', testNodeId, 'Alert', pruned, { sourceSha256: 'sha-a' });
assert(fs.existsSync(staleFigctxManager.getCacheFilePath('file-a', testNodeId)), 'Cache entry exists before .figctx clear');
staleFigctxManager.clear('file-a', testNodeId);
assert(!fs.existsSync(corruptCachePath), '.figctx clear(fileKey, nodeId) removes the targeted entry');
fs.rmSync(figctxTestRoot, { recursive: true, force: true });

// 5. Test Figma Fetcher Resilience (429, Circuit Breaker & Max Retries)
console.log('\nTest 5: Figma Fetcher Resilience & Circuit Breaker');
import { fetchFigmaWithRetry, FigmaRateLimitError } from './figma-fetcher.ts';

// 5a. Fast-fail on 404
let fastFailTriggered = false;
let sensitiveUrlRedacted = false;
try {
  await fetchFigmaWithRetry('https://api.figma.com/test?token=secret-value', {}, {
    customFetch: async () => new Response('Not Found', { status: 404, statusText: 'Not Found' })
  });
} catch (err: any) {
  if (err.message.includes('404')) {
    fastFailTriggered = true;
  }
  sensitiveUrlRedacted = !err.message.includes('secret-value') && err.message.includes('/test');
}
assert(fastFailTriggered, 'Fast-fail immediately on 404 client error');
assert(sensitiveUrlRedacted, 'Error messages redact sensitive URL query parameters');

let timeoutSignalObserved = false;
const timeoutStartedAt = Date.now();
let timeoutError: unknown;
try {
  await fetchFigmaWithRetry('https://api.figma.com/test', {
    headers: { Authorization: 'Bearer secret-header-value' }
  }, {
    maxAttempts: 1,
    requestTimeoutMs: 5,
    customFetch: async (_url, request) => new Promise<Response>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fetch did not timeout')), 100);
      request?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        timeoutSignalObserved = true;
        reject(request.signal?.reason || new Error('request timed out'));
      }, { once: true });
    })
  });
} catch (err) {
  timeoutError = err;
}
assert(timeoutSignalObserved, 'requestTimeoutMs aborts an in-flight request');
assert(timeoutError instanceof Error && !timeoutError.message.includes('secret-header-value'), 'Timeout errors do not expose Authorization header');
assert(Date.now() - timeoutStartedAt < 500, 'requestTimeoutMs does not wait indefinitely');

let retryable5xxCalls = 0;
const retryable5xxResult = await fetchFigmaWithRetry('https://api.figma.com/test', {}, {
  maxAttempts: 2,
  maxWaitSeconds: 0.001,
  customFetch: async () => {
    retryable5xxCalls++;
    return retryable5xxCalls === 1
      ? new Response('Unavailable', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Retry-After': '0' }
      })
      : new Response('OK', { status: 200 });
  }
});
assert(retryable5xxResult.ok && retryable5xxCalls === 2, '503 is retried and can recover');

let permanent5xxCalls = 0;
try {
  await fetchFigmaWithRetry('https://api.figma.com/test', {}, {
    maxAttempts: 3,
    customFetch: async () => {
      permanent5xxCalls++;
      return new Response('Not Implemented', { status: 501, statusText: 'Not Implemented' });
    }
  });
} catch (err: any) {
  assert(err.message.includes('501'), 'Non-retryable 5xx reports its status');
}
assert(permanent5xxCalls === 1, 'Non-retryable 5xx fails without retry');

for (const retryableStatus of [500, 502, 504]) {
  let calls = 0;
  const recovered = await fetchFigmaWithRetry('https://api.figma.com/test', {}, {
    maxAttempts: 2,
    maxWaitSeconds: 0,
    customFetch: async () => {
      calls++;
      return calls === 1
        ? new Response('Temporary failure', {
          status: retryableStatus,
          headers: { 'Retry-After': '0' }
        })
        : new Response('OK', { status: 200 });
    }
  });
  assert(recovered.ok && calls === 2, `${retryableStatus} is retried and can recover`);
}

for (const permanentStatus of [400, 401, 403]) {
  let calls = 0;
  try {
    await fetchFigmaWithRetry('https://api.figma.com/test', {}, {
      maxAttempts: 3,
      customFetch: async () => {
        calls++;
        return new Response('Client failure', { status: permanentStatus });
      }
    });
  } catch (err: any) {
    assert(err.message.includes(String(permanentStatus)), `${permanentStatus} reports its client error status`);
  }
  assert(calls === 1, `${permanentStatus} fails without retry`);
}

let zeroRetryAfterCalls = 0;
await fetchFigmaWithRetry('https://api.figma.com/test', {}, {
  maxAttempts: 2,
  maxWaitSeconds: 0,
  customFetch: async () => {
    zeroRetryAfterCalls++;
    return new Response('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': '0' }
    });
  }
}).catch(() => undefined);
assert(zeroRetryAfterCalls === 2, 'Retry-After zero is honored without fallback delay');

for (const invalidRetryAfter of ['-1', 'not-a-number']) {
  let invalidHeaderTriggered = false;
  try {
    await fetchFigmaWithRetry('https://api.figma.com/test', {}, {
      maxAttempts: 2,
      maxWaitSeconds: 0,
      customFetch: async () => new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': invalidRetryAfter }
      })
    });
  } catch (err: any) {
    invalidHeaderTriggered = err instanceof FigmaRateLimitError && err.message.includes('Circuit Breaker');
  }
  assert(invalidHeaderTriggered, `Invalid Retry-After (${invalidRetryAfter}) uses bounded backoff`);
}

// 5b. Circuit Breaker aborts when Retry-After > 60s
let circuitBreakerTriggered = false;
try {
  await fetchFigmaWithRetry('https://api.figma.com/test', {}, {
    maxWaitSeconds: 60,
    customFetch: async () => new Response('Too Many Requests', {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'Retry-After': '3600', 'X-Figma-Plan-Tier': 'starter' }
    })
  });
} catch (err: any) {
  if (err instanceof FigmaRateLimitError && err.message.includes('Circuit Breaker')) {
    circuitBreakerTriggered = true;
    assert(err.planTier === 'starter', 'Rate-limit error preserves plan tier metadata');
    assert(err.rateLimitType === undefined, 'Missing rate-limit type remains undefined');
  }
}
assert(circuitBreakerTriggered, 'Circuit breaker immediately aborts on long Retry-After (> 60s)');

// 5c. Max retries exceeded aborts
let maxRetriesExceeded = false;
let callCount = 0;
try {
  await fetchFigmaWithRetry('https://api.figma.com/test', {}, {
    maxRetries: 2,
    maxWaitSeconds: 5,
    customFetch: async () => {
      callCount++;
      return new Response('Too Many Requests', {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'Retry-After': '0' }
      });
    }
  });
} catch (err: any) {
  if (err instanceof FigmaRateLimitError && err.message.includes('Exceeded maximum attempts')) {
    maxRetriesExceeded = true;
  }
}
assert(maxRetriesExceeded, 'Aborts when max retries exceeded');
assert(callCount === 3, 'Called initial (1) + 2 retries = 3 total attempts');

// 5d. maxAttempts must include the initial request and network errors must retry.
let maxAttemptsCallCount = 0;
let networkRetryCallCount = 0;
try {
  await fetchFigmaWithRetry('https://api.figma.com/test', {}, {
    maxAttempts: 3,
    maxWaitSeconds: 0.001,
    customFetch: async () => {
      maxAttemptsCallCount++;
      return new Response('Too Many Requests', {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'Retry-After': '0' }
      });
    }
  } as any);
} catch {
  // Expected after the configured attempts are exhausted.
}
assert(maxAttemptsCallCount === 3, 'maxAttempts counts the initial request and allows exactly 3 total calls');

const networkRetryResult = await fetchFigmaWithRetry('https://api.figma.com/test', {}, {
  maxAttempts: 3,
  maxWaitSeconds: 0.001,
  customFetch: async () => {
    networkRetryCallCount++;
    if (networkRetryCallCount < 3) throw new Error('temporary network failure');
    return new Response('OK', { status: 200 });
  }
} as any);
assert(networkRetryResult.ok, 'Temporary network errors are retried until a successful response');
assert(networkRetryCallCount === 3, 'Network retry stops after the successful third attempt');

// 6. Decision engine must not use broad substring matches or emit empty hydrate calls.
const cardinalDecision = evaluateNodeForFallback({
  id: '1:3', name: 'Cardinal', type: 'INSTANCE', childIds: [],
  layout: { stackMode: 'VERTICAL', stackSpacing: 8 }
}, 'cloud-file');
assert(!cardinalDecision.reasons.some((reason) => reason.includes('common composite UI pattern: "card"')), 'Semantic name matching must not treat Cardinal as Card');

let invalidHydrateRejected = false;
try {
  resolveRecommendedTool('HYDRATE_INSTANCE', { fileKey: '', nodeId: '' });
} catch {
  invalidHydrateRejected = true;
}
assert(invalidHydrateRejected, 'Hydrate tool selection rejects missing fileKey and nodeId');

let localHydrateRejected = false;
try {
  resolveRecommendedTool('HYDRATE_INSTANCE', { fileKey: 'lk-local-export', nodeId: '1:3' });
} catch {
  localHydrateRejected = true;
}
assert(localHydrateRejected, 'Hydrate tool selection rejects local lk- fileKeys');

const headerlineDecision = evaluateNodeForFallback({ id: '1:4', name: 'Headerline', type: 'INSTANCE', childIds: [], layout: { stackMode: 'VERTICAL', stackSpacing: 8 } }, 'cloud-file');
assert(!headerlineDecision.reasons.some((reason) => reason.includes('common composite UI pattern')), 'Semantic name matching must not treat Headerline as Header');

const componentDecision = evaluateNodeForFallback({ id: '1:5', name: 'Alert', type: 'COMPONENT', childIds: [] }, 'cloud-file');
assert(!componentDecision.shouldFallback, 'Unsupported component types do not trigger an official hydrate fallback');
const componentSetDecision = evaluateNodeForFallback({ id: '1:6', name: 'Alert', type: 'COMPONENT_SET', childIds: [] }, 'cloud-file');
assert(!componentSetDecision.shouldFallback, 'COMPONENT_SET does not trigger an official hydrate fallback');
assert(resolveFallbackStage(componentSetDecision) === 'LOCAL_INSPECT', 'Non-instance component stages stop at local inspection');
const unknownContainerDecision = evaluateNodeForFallback({ id: '1:7', name: 'Alert', type: 'UNKNOWN_CONTAINER', childIds: [] }, 'cloud-file');
assert(!unknownContainerDecision.shouldFallback, 'Unknown container types fail closed without cloud hydrate');
assert(unknownContainerDecision.recommendation === 'DO_NOT_CALL_API', 'Unknown container recommendation does not call API');
let invalidNodeRejected = false;
try {
  validateInspectionNode({ id: '1:invalid', name: 'Missing Type' });
} catch (err: any) {
  invalidNodeRejected = err.message.includes('type');
}
assert(invalidNodeRejected, 'Inspection input validation rejects nodes without a type');
let invalidResponseRejected = false;
try {
  validateFigmaNodesResponse({ nodes: { '1:missing': {} } }, '1:missing');
} catch (err: any) {
  invalidResponseRejected = err.message.includes('missing document');
}
assert(invalidResponseRejected, 'Figma nodes response validation rejects a missing document');
let malformedNodesRejected = false;
try {
  validateFigmaNodesResponse({ nodes: [] }, '1:invalid');
} catch (err: any) {
  malformedNodesRejected = err.message.includes('nodes');
}
assert(malformedNodesRejected, 'Figma nodes response validation rejects a non-object nodes map');
let mismatchedDocumentRejected = false;
try {
  validateFigmaNodesResponse({ nodes: { '1:requested': { document: { id: '1:other', type: 'FRAME' } } } }, '1:requested');
} catch (err: any) {
  mismatchedDocumentRejected = err.message.includes('nodeId');
}
assert(mismatchedDocumentRejected, 'Figma nodes response validation rejects a document ID mismatch');
assert(validateFigmaNodesResponse({ nodes: { '1:valid': { document: { id: '1:valid', type: 'FRAME' } } } }, '1:valid').type === 'FRAME', 'Figma nodes response validation returns the document');

// 6b. Abort signals must cancel backoff without waiting for the full Retry-After.
const abortController = new AbortController();
const abortStartedAt = Date.now();
const abortPromise = fetchFigmaWithRetry('https://api.figma.com/test', {}, {
  maxAttempts: 3,
  customFetch: async () => new Response('Too Many Requests', {
    status: 429,
    headers: { 'Retry-After': '10' }
  }),
  signal: abortController.signal
} as any).then(() => false).catch(() => true);
setTimeout(() => abortController.abort(new Error('test abort')), 5);
assert(await abortPromise, 'AbortSignal cancels retry backoff');
assert(Date.now() - abortStartedAt < 1000, 'AbortSignal does not wait for the complete Retry-After duration');

console.log('\n✨ ALL TESTS PASSED SUCCESSFULLY! ✨');
console.log('\nValidation layers:');
console.log('- Static/unit: passed');
console.log('- Synthetic/mock contract: passed');
console.log('- Local .figctx runtime: passed');
console.log('- Real Figma API QA: not run in default tests');
console.log('- Visual QA: not run; no renderer/diff evidence available');
