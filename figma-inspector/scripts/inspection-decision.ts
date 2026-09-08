/**
 * inspection-decision.ts
 * 
 * Heuristic evaluator for determining whether a node reported with empty children
 * in local/offline tools (like figma-free) is actually an unhydrated external Component Instance
 * that requires targeted full-depth fetch via the official Figma REST API.
 */

export interface RecommendedToolCall {
  server: 'figma-free' | 'figma';
  tool: string;
  params: Record<string, any>;
  expectedTokenCost: 'LOW (<300)' | 'MEDIUM (300-1500)' | 'HIGH (1500+)';
  rationale: string;
  forbiddenAlternatives: string[];
}

export interface EvaluationResult {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  isLocalFileKey?: boolean;
  shouldFallback: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  reasons: string[];
  recommendation: 'DO_NOT_CALL_API' | 'LOCAL_SEARCH_FIRST' | 'FETCH_OFFICIAL_API' | 'PROMPT_CLOUD_URL';
  suggestedAction: string;
  recommendedTool?: RecommendedToolCall;
}

export type FallbackStage = 'LOCAL_INSPECT' | 'LOCAL_SEARCH' | 'CLOUD_HYDRATE' | 'USER_INPUT_REQUIRED';

export function validateInspectionNode(node: unknown): asserts node is Record<string, any> {
  if (!node || typeof node !== 'object') {
    throw new Error('Inspection node must be an object.');
  }
  const candidate = node as Record<string, any>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw new Error('Inspection node requires a non-empty string id.');
  }
  if (typeof candidate.type !== 'string' || candidate.type.length === 0) {
    throw new Error('Inspection node requires a non-empty string type.');
  }
}

export function validateFigmaNodesResponse(response: unknown, nodeId: string): Record<string, any> {
  if (!response || typeof response !== 'object') throw new Error('Figma nodes response must be an object.');
  const nodes = (response as Record<string, any>).nodes;
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) {
    throw new Error('Figma nodes response requires an object nodes map.');
  }
  const document = nodes?.[nodeId]?.document;
  if (!document) throw new Error(`Figma nodes response is missing document for nodeId "${nodeId}".`);
  validateInspectionNode(document);
  const normalizeNodeId = (value: string) => value.replace('-', ':');
  if (normalizeNodeId(document.id) !== normalizeNodeId(nodeId)) {
    throw new Error(`Figma nodes response document nodeId mismatch: expected "${nodeId}", received "${document.id}".`);
  }
  return document;
}

export type InspectionIntent =
  | 'LIST_SCREENS'
  | 'SEARCH_COMPONENT'
  | 'INSPECT_LAYOUT'
  | 'GET_DESIGN_TOKENS'
  | 'EXTRACT_ICON_SVG'
  | 'HYDRATE_INSTANCE'
  | 'DOWNLOAD_IMAGE';

export function resolveFallbackStage(
  evaluation: EvaluationResult,
  localSymbolFound?: boolean
): FallbackStage {
  if (!evaluation.shouldFallback) return 'LOCAL_INSPECT';
  if (evaluation.isLocalFileKey) return 'USER_INPUT_REQUIRED';
  if (localSymbolFound === true) return 'LOCAL_INSPECT';
  if (localSymbolFound === false) return 'CLOUD_HYDRATE';
  return 'LOCAL_SEARCH';
}

export interface ToolSelectionContext {
  fileKey?: string;
  nodeId?: string;
  query?: string;
  depth?: number;
  maxChildren?: number;
}

const LEAF_TYPES = new Set(['TEXT', 'VECTOR', 'RECTANGLE', 'ELLIPSE', 'LINE', 'STAR', 'POLYGON']);

const SEMANTIC_COMPONENT_NAMES = [
  'alert', 'button', 'modal', 'dialog', 'card', 'header', 'footer',
  'navbar', 'menu', 'dropdown', 'input', 'select', 'checkbox', 'radio',
  'badge', 'tag', 'tooltip', 'toast', 'listitem', 'tab', 'pagination'
];

export function evaluateNodeForFallback(node: any, fileKey?: string): EvaluationResult {
  validateInspectionNode(node);
  const nodeId = node.id || 'unknown';
  const nodeName = node.name || 'Unnamed';
  const nodeType = (node.type || '').toUpperCase();
  const reasons: string[] = [];
  const isLocalFileKey = Boolean(fileKey && fileKey.startsWith('lk-'));

  if (isLocalFileKey) {
    reasons.push(`Origin fileKey "${fileKey}" is a local Kiwi export hash (starts with 'lk-'). Official Figma REST API only accepts cloud fileKeys.`);
  }

  // 1. Terminal Leaf Node check
  if (LEAF_TYPES.has(nodeType)) {
    return {
      nodeId,
      nodeName,
      nodeType,
      isLocalFileKey,
      shouldFallback: false,
      confidence: 'NONE',
      reasons: [`Node type ${nodeType} is a terminal leaf node and cannot have children in Figma.`],
      recommendation: 'DO_NOT_CALL_API',
      suggestedAction: 'Do not call Figma API. This node is an atomic element.',
      recommendedTool: resolveRecommendedTool('INSPECT_LAYOUT', { nodeId, depth: 1 }),
    };
  }

  // 2. Children already populated
  const childCount = (node.children && node.children.length) || (node.resolvedChildIds && node.resolvedChildIds.length) || (node.childIds && node.childIds.length) || 0;
  if (childCount > 0) {
    return {
      nodeId,
      nodeName,
      nodeType,
      isLocalFileKey,
      shouldFallback: false,
      confidence: 'NONE',
      reasons: [`Node already has ${childCount} children populated.`],
      recommendation: 'DO_NOT_CALL_API',
      suggestedAction: 'No fallback needed. Proceed with current local children.',
      recommendedTool: resolveRecommendedTool('INSPECT_LAYOUT', { nodeId, depth: 2 }),
    };
  }

  // 3. Container check: Plain FRAME / GROUP with no children
  if (nodeType !== 'INSTANCE') {
    return {
      nodeId,
      nodeName,
      nodeType,
      isLocalFileKey,
      shouldFallback: false,
      confidence: 'LOW',
      reasons: [`Node is a ${nodeType} without children. Usually represents an empty placeholder or background canvas.`],
      recommendation: 'DO_NOT_CALL_API',
      suggestedAction: 'Check visual reference or design context. Calling API is unlikely to yield new children unless the file was modified.',
      recommendedTool: resolveRecommendedTool('INSPECT_LAYOUT', { nodeId, depth: 1 }),
    };
  }

  // 4. INSTANCE Node evaluation (The Critical Path)
  reasons.push('Node is an INSTANCE (Component Instance) with 0 local children.');

  let hasLayoutSignal = false;
  let hasNameSignal = false;
  let hasPropsSignal = false;

  // Component Properties signal
  if (node.componentProperties && Object.keys(node.componentProperties).length > 0) {
    hasPropsSignal = true;
    const propNames = Object.keys(node.componentProperties).join(', ');
    reasons.push(`Component properties detected: [${propNames}]. This is a candidate parameterized instance signal; it does not prove child layers are available.`);
  }

  // Layout signals (Auto layout spacing, padding)
  const layout = node.layout || {};
  const hasStack = Boolean(node.layoutMode && node.layoutMode !== 'NONE') || Boolean(layout.stackMode);
  const spacing = node.itemSpacing || layout.stackSpacing || 0;
  const hPadding = node.paddingLeft || node.paddingRight || layout.stackHorizontalPadding || 0;
  const vPadding = node.paddingTop || node.paddingBottom || layout.stackVerticalPadding || 0;

  if (hasStack && (spacing > 0 || hPadding > 0 || vPadding > 0)) {
    hasLayoutSignal = true;
    reasons.push(`Auto Layout detected: mode=${hasStack ? 'STACK' : 'NONE'}, gap=${spacing}px, hPadding=${hPadding}px, vPadding=${vPadding}px. This is a candidate signal for local symbol search; it does not prove child layers are available.`);
  }

  // Semantic naming signals
  const nameTokens = nodeName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const keyword of SEMANTIC_COMPONENT_NAMES) {
    if (nameTokens.includes(keyword)) {
      hasNameSignal = true;
      reasons.push(`Component name matches common composite UI pattern: "${keyword}".`);
      break;
    }
  }

  // Action based on fileKey validity
  const getAction = (cloudAction: string) => {
    if (isLocalFileKey) {
      return `1. Search local bundle for SYMBOL "${nodeName}". 2. If missing, obtain the real cloud Figma fileKey/URL (do NOT call official API with ${fileKey} to avoid 404).`;
    }
    const encodedFileKey = encodeURIComponent(fileKey || ':fileKey');
    const encodedNodeId = encodeURIComponent(nodeId);
    return `1. Search local bundle for SYMBOL with query "${nodeName}" (0 API cost). 2. If not found, call official Figma REST API GET /v1/files/${encodedFileKey}/nodes?ids=${encodedNodeId}&depth=all and prune the response.`;
  };

  const getRecommendation = (): 'LOCAL_SEARCH_FIRST' | 'PROMPT_CLOUD_URL' => {
    return isLocalFileKey ? 'PROMPT_CLOUD_URL' : 'LOCAL_SEARCH_FIRST';
  };

  // Final scoring
  if ((hasLayoutSignal && hasNameSignal) || hasPropsSignal) {
    const rec = getRecommendation();
    return {
      nodeId,
      nodeName,
      nodeType,
      isLocalFileKey,
      shouldFallback: true,
      confidence: 'HIGH',
      reasons,
      recommendation: rec,
      suggestedAction: getAction(`call official API for node ${nodeId}`),
      recommendedTool: resolveRecommendedTool(
        rec === 'PROMPT_CLOUD_URL' ? 'SEARCH_COMPONENT' : 'SEARCH_COMPONENT',
        { query: nodeName, nodeId, fileKey }
      ),
    };
  }

  if (hasLayoutSignal || hasNameSignal) {
    const rec = getRecommendation();
    return {
      nodeId,
      nodeName,
      nodeType,
      isLocalFileKey,
      shouldFallback: true,
      confidence: 'MEDIUM',
      reasons,
      recommendation: rec,
      suggestedAction: getAction(`fetch from official Figma API for node ${nodeId}`),
      recommendedTool: resolveRecommendedTool('SEARCH_COMPONENT', { query: nodeName, nodeId, fileKey }),
    };
  }

  return {
    nodeId,
    nodeName,
    nodeType,
    isLocalFileKey,
    shouldFallback: false,
    confidence: 'LOW',
    reasons: [...reasons, 'No strong layout or semantic signals indicating missing child layers.'],
    recommendation: 'DO_NOT_CALL_API',
    suggestedAction: 'Treat as minimal instance or verify via attached visual reference image first.',
    recommendedTool: resolveRecommendedTool('INSPECT_LAYOUT', { nodeId, depth: 2 }),
  };
}

/**
 * Resolves the most token-efficient MCP method/tool call for a specific inspection intent.
 */
export function resolveRecommendedTool(
  intent: InspectionIntent,
  context: ToolSelectionContext = {}
): RecommendedToolCall {
  switch (intent) {
    case 'LIST_SCREENS':
      return {
        server: 'figma-free',
        tool: 'list_frame_summaries',
        params: { limit: 50 },
        expectedTokenCost: 'LOW (<300)',
        rationale: 'Lists high-level frame/canvas summaries without expanding internal child layers.',
        forbiddenAlternatives: ['get_frame_bundle (consumes 15k-50k tokens)', 'list_frames (dumps raw nodes)'],
      };

    case 'SEARCH_COMPONENT':
      return {
        server: 'figma-free',
        tool: 'search_nodes',
        params: {
          query: context.query || '',
          type: 'SYMBOL',
        },
        expectedTokenCost: 'LOW (<300)',
        rationale: 'Targeted name/type query directly locates master components offline with 0 API quota.',
        forbiddenAlternatives: ['get_frame_bundle on all frames', 'inspect_node traversal'],
      };

    case 'INSPECT_LAYOUT':
      return {
        server: 'figma-free',
        tool: 'inspect_node',
        params: {
          reference: context.nodeId || '',
          depth: context.depth ?? 2,
          maxChildren: context.maxChildren ?? 50,
        },
        expectedTokenCost: 'MEDIUM (300-1500)',
        rationale: 'Extracts bounded structure and CSS properties while stripping asset paths/hashes.',
        forbiddenAlternatives: ['get_frame_bundle (contains bloated binary asset hashes and full vector trees)'],
      };

    case 'GET_DESIGN_TOKENS':
      return {
        server: 'figma-free',
        tool: 'get_style_tokens',
        params: {},
        expectedTokenCost: 'LOW (<300)',
        rationale: 'Reads extracted color variables and typography tokens without parsing node trees.',
        forbiddenAlternatives: ['inspect_node on multiple nodes to deduce styles'],
      };

    case 'EXTRACT_ICON_SVG':
      return {
        server: 'figma-free',
        tool: 'get_vector_svg',
        params: {
          reference: context.nodeId || '',
        },
        expectedTokenCost: 'LOW (<300)',
        rationale: 'Directly compiles vector nodes into a clean standalone SVG string.',
        forbiddenAlternatives: ['download_figma_images (consumes cloud quota)', 'get_frame_bundle'],
      };

    case 'HYDRATE_INSTANCE':
      if (!context.fileKey || !context.nodeId) {
        throw new Error('HYDRATE_INSTANCE requires both fileKey and nodeId.');
      }
      if (context.fileKey.startsWith('lk-')) {
        throw new Error('HYDRATE_INSTANCE does not accept local lk- fileKeys; obtain the cloud fileKey first.');
      }
      return {
        server: 'figma',
        tool: 'get_figma_data',
        params: {
          fileKey: context.fileKey || '',
          nodeId: context.nodeId || '',
        },
        expectedTokenCost: 'MEDIUM (300-1500)',
        rationale: 'Surgically hydrates single component instance via official API. Must be pruned immediately.',
        forbiddenAlternatives: ['get_figma_data without nodeId (dumps entire file AST, 100k+ tokens)'],
      };

    case 'DOWNLOAD_IMAGE':
      return {
        server: 'figma',
        tool: 'download_figma_images',
        params: {
          fileKey: context.fileKey || '',
          nodeIds: [context.nodeId || ''],
        },
        expectedTokenCost: 'LOW (<300)',
        rationale: 'Cloud rasterization of component preview image.',
        forbiddenAlternatives: ['get_frame_bundle PNG base64 embed'],
      };
  }
}
