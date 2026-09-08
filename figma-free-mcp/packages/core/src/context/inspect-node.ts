import { effectiveChildIds, type AgentDocument, type AgentNode } from '../normalize/document.js';

export interface InspectNodeOptions { depth?: number; maxChildren?: number; }
export interface InspectNodeLimits { depth: number; maxChildren: number; }
export interface InspectedNode {
  id: string;
  name: string;
  type: string;
  bounds?: unknown;
  transform?: unknown;
  layout?: Record<string, unknown>;
  typography?: Record<string, unknown>;
  visible?: boolean;
  opacity?: number;
  component: { type: string; mainComponentId?: string; expanded: boolean } | null;
  assets: { imageFillCount: number; hasVector: boolean };
  childCount: number;
  children: InspectedNode[];
}
export interface NodeInspection {
  schemaVersion: '1';
  source: { nodeId: string; originFileKey?: string };
  limits: InspectNodeLimits;
  selection: InspectedNode;
  omitted: string[];
}

const defaultLimits: InspectNodeLimits = { depth: 2, maxChildren: 20 };
const maxDepth = 5;
const maxChildren = 100;
const maxSummaryNodes = 1000;

/** Builds a bounded, asset-safe summary for MCP discovery without loading a full subtree. */
export function inspectNode(document: AgentDocument, node: AgentNode, options: InspectNodeOptions = {}): NodeInspection {
  const limits = resolveLimits(options);
  const state = { remainingNodes: maxSummaryNodes, omitted: [] as string[] };
  return {
    schemaVersion: '1',
    source: { nodeId: node.id, ...(document.originFileKey ? { originFileKey: document.originFileKey } : {}) },
    limits,
    selection: inspect(document, node, limits.depth, limits.maxChildren, limits.depth, state),
    omitted: state.omitted
  };
}

function resolveLimits(options: InspectNodeOptions): InspectNodeLimits {
  return {
    depth: limit(options.depth, defaultLimits.depth, maxDepth),
    maxChildren: limit(options.maxChildren, defaultLimits.maxChildren, maxChildren)
  };
}

function limit(value: number | undefined, fallback: number, maximum: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.min(maximum, Math.max(0, Math.trunc(value)));
}

function inspect(document: AgentDocument, node: AgentNode, depth: number, childLimit: number, depthLimit: number, state: { remainingNodes: number; omitted: string[] }): InspectedNode {
  state.remainingNodes -= 1;
  const sourceChildIds = effectiveChildIds(node);
  const childIds = sourceChildIds.slice(0, childLimit);
  if (sourceChildIds.length > childIds.length) state.omitted.push(`node ${node.id}: ${sourceChildIds.length - childIds.length} children omitted by maxChildren limit (${childLimit})`);
  if (depth === 0 && childIds.length) state.omitted.push(`node ${node.id}: ${childIds.length} children omitted by depth limit (${depthLimit})`);
  const children: InspectedNode[] = [];
  if (depth > 0) for (let index = 0; index < childIds.length; index += 1) {
    if (state.remainingNodes === 0) {
      state.omitted.push(`node ${node.id}: ${childIds.length - index} children omitted by node limit (${maxSummaryNodes})`);
      break;
    }
    const child = document.nodesById[childIds[index]!];
    if (child) children.push(inspect(document, child, depth - 1, childLimit, depthLimit, state));
  }
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    ...(node.bounds === undefined ? {} : { bounds: node.bounds }),
    ...(node.transform === undefined ? {} : { transform: node.transform }),
    ...(node.layout === undefined ? {} : { layout: node.layout }),
    ...(node.typography === undefined ? {} : { typography: node.typography }),
    ...(node.visible === undefined ? {} : { visible: node.visible }),
    ...(node.opacity === undefined ? {} : { opacity: node.opacity }),
    component: isComponent(node) ? { type: node.type, ...(node.main_component_id ? { mainComponentId: node.main_component_id } : {}), expanded: Boolean(node.resolvedChildIds) } : null,
    assets: { imageFillCount: node.assetRefs.length, hasVector: Boolean(node.vectorRef) },
    childCount: sourceChildIds.length,
    children
  };
}

function isComponent(node: AgentNode): boolean {
  return node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' || node.type === 'INSTANCE';
}
