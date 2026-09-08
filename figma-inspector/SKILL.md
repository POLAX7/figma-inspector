---
name: figma-inspector
description: Use when inspecting Figma designs, expanding local component instances, extracting UI styles for frontend implementation, or avoiding unnecessary Figma API HTTP 429 rate limits and token bloat.
---

# Figma Inspection & AST Compression

## Overview
A token-efficient, rate-limit-resistant workflow for extracting Figma designs. It first expands component instances from local `symbolData` and component definitions, then uses targeted cloud API fallback only when local resolution is unavailable, followed by AST property pruning. The current pruner preserves full traversed hierarchy plus a documented subset of render-critical properties; fidelity and compression must be reported from the tested fixture rather than assumed globally.

## When to Use
- Translating Figma components into frontend code (React, Vue, SwiftUI) requiring measured visual consistency.
- Inspecting a component `INSTANCE` in `figma-free` where `childIds` is empty (`[]`) but an expand arrow or internal layers appear in Figma Web.
- Encountering HTTP 429 Too Many Requests errors from the official Figma REST API.
- Prompt context window is constrained and large Figma node trees need to be drastically compressed.

**When NOT to use:**
- Simple asset/image export where only raw PNG/SVG download is requested.
- Pure design review without frontend code generation intent.

## Decision Flowchart

```
[Inspect Node in figma-free]
            │
            ▼
    [Has Children?] ──────(Yes)─────► [Ready for Code Gen]
            │ (No / childIds: [])
            ▼
     [Is Leaf Node?] ─────(Yes)─────► [Atomic Element: Stop]
     (TEXT, VECTOR, RECTANGLE)
            │ (No)
            ▼
     [Is INSTANCE?] ──────(No)──────► [Empty Frame / Spacer: Stop]
            │ (Yes)
            ▼
  [Check Local Component Metadata]
  - symbolData.symbolID / component reference
  - local component definition and variant children
            │
            ▼
  [Check Local Disk Cache] ──(Hit)──► [Load Cached Compact AST]
            │ (Miss)                  (0 API, 0 Wait, 0 429 Risk)
            ▼
  [Expand local component]
       /                 \
 (Success)          (Unavailable)
     /                     \
[Use resolved tree]   [Check cloud key + API permission]
 (0 API Cost)              │
                           ▼
                   [Targeted Official API Call]
                   (GET /v1/files/:key/nodes?ids=ID)
                           │
                           ▼
                 [Full-Depth Pruning]
                 (Strip matrix/noise, preserve CSS)
                           │
                           ▼
                  [Save to Disk Cache]
                           │
                           ▼
                   [Ready for Code Gen]
```

## Core Patterns

### 1. Offline-First, Cloud-Fallback
Always explore designs offline first via `figma-free` (`search_nodes`, `inspect_node`). Those local calls do not consume Figma REST API quota; any later official MCP／REST fallback remains a separately observable network operation.

### 2. Heuristic Detection for Unhydrated Instances
When an `INSTANCE` shows `childIds: []` locally, check:
1. **Auto Layout Signals**: `gap > 0` or padding is a candidate signal for local symbol search; it does not prove that children exist.
2. **Semantic Naming**: Token-boundary names like `Alert`, `Button`, `Dialog`, `Card`, `Header` are candidate composite components, not confirmation.
3. **Component Properties**: `componentProperties` indicates a parameterized instance; it does not by itself prove that child layers are available.
4. **Origin FileKey Check (`lk-` Detection)**: If `originFileKey` starts with `lk-`, it is a local Kiwi export hash. **Do NOT call the cloud API with `lk-` (it will 404)**; search local symbol canvases first, or ask the user for the real Figma cloud URL.
5. **Local Cache First with SHA Validation**: Check disk cache (`.figctx/<design>/hydrated/` or `.figma-cache/components/`). A cache hit requires matching `fileKey`, `nodeId`, schema version, and source SHA; missing manifest SHA or source file is a miss.
6. **Local Instance Expansion**: If `symbolData.symbolID` is present, resolve that ID in the same bundle and expand the component's child tree. Preserve raw `childIds` and expose the result through `resolvedChildIds`; a successful expansion ends the fallback flow and must not call the cloud API.
7. **Local Component Search**: If the reference is unavailable, search the same `.fig` file for a named component container (`FRAME`／`CANVAS`) and inspect its `SYMBOL` children. Do not assume that a literal `SYMBOL` name equals the container name.

An empty raw `childIds` result proves only that the local export did not attach child layers directly to the instance. Check normalized `resolvedChildIds` and raw `symbolData` before considering cloud fallback. Missing `mainComponentId`, `componentProperties`, or `overrides` does not by itself prove a cross-file Team Library origin; record that as an unverified hypothesis unless the source metadata supports it.

### 3. Micro-Scope Full-Depth + Property Pruning
To preserve measured visual properties without token bloat:
* **Scope down**: Never call full-depth on an entire canvas or page. Only call full-depth on the single isolated component instance (`ids=1518:55106`); `inspect_node(depth: 2)` is bounded inspection, not full-depth evidence.
* **Prune horizontally**: Recursively keep all nested children down to the leaves, but discard only metadata classified as non-rendering. Unsupported render properties are reported in `unsupportedProperties` rather than silently discarded.
* **Format CSS**: Convert colors to `#HEX` or `rgba()`, layout to CSS flexbox properties (`mode`, `gap`, `padding`), `layoutGrow: 1` to `flex: 1`, and format 4-corner radii to standard CSS string (`"8px 8px 0px 0px"`).
* **Extract Props & Icon Hints**: Keep `props` from `componentProperties` for TypeScript props interface generation, and `icon: { name, size }` for vector nodes so the frontend knows what icon component to render. An icon hint is semantic metadata, not a replacement for the original SVG path; render-critical output marks unconverted vector geometry explicitly, while lossless output preserves it.

The current pruner supports three explicit modes: `semantic` emits semantic node data and hierarchy, `render-critical` emits the supported layout/style subset plus `unsupportedProperties`, and `lossless-ast` additionally keeps selected original render metadata. None of these modes alone proves pixel equality. Gradient/image fills, fill/stroke geometry, multiple strokes, vector paths, mixed text styles, non-default blend modes, rotation, clipping/masks, and non-drop-shadow effects are not yet converted to compact CSS. Compression is fixture-dependent: small leaf nodes can grow after normalization, so report min/median/max measurements rather than promising a universal savings percentage.

### 4. API Resilience & Circuit-Breaker Rules
When falling back to the official Figma REST API, calls must go through a resilient HTTP client (`scripts/figma-fetcher.ts`):
1. **Max Retry Cap (Fail-Fast)**: `maxAttempts` counts the initial request. The compatibility option `maxRetries` means `1 + maxRetries` total requests. Never loop indefinitely.
2. **Circuit Breaker on Cooldown (Max 60s)**: If `Retry-After > 60s`, **abort immediately with `FigmaRateLimitError`** rather than hanging the agent thread. Do not infer quota exhaustion solely from the header; preserve Figma rate-limit metadata for diagnosis.
3. **Fast-Fail on 4xx Client Errors**: Never retry 400, 401, 403, or 404. Fail immediately and alert the user (e.g. invalid token, `lk-` local fileKey).
4. **Exponential Backoff with Jitter**: If `Retry-After` header is missing, back off exponentially ($2^{\text{attempt}-1} + \text{jitter}$ seconds: ~1s, 2s, 4s).

Cache and failure handling:

- Cache misses fail closed when the source bundle cannot be identified exactly, the entry identity/schema does not match, the source SHA is missing or changed, or the manifest source file is unavailable.
- Concurrent misses for the same `fileKey` and `nodeId` are deduplicated within one process; this does not guarantee one request across processes or source versions.
- A 429 is bounded by `maxAttempts` and `maxWaitSeconds`; preserve available rate-limit metadata, abort on long cooldowns, and allow `AbortSignal`／request timeout to cancel waiting.
- Network failures may retry within the same bounded budget. Permanent 4xx and non-retryable 5xx fail immediately.
- Error messages and retry logs must not include Authorization headers, tokens, or URL query／fragment data.
- Render-like fields whose names contain `render` or `geometry` are treated conservatively: `render-critical` records them in `unsupportedProperties`, while `lossless-ast` retains their original values.

### 5. MCP Tool Selection Matrix (Token Optimization)
To prevent token budget exhaustion, select the minimal viable MCP tool based on inspection intent (`scripts/inspection-decision.ts` -> `resolveRecommendedTool`):

`figma-free` tools are local bundle operations. The `figma` MCP tool is a separate client-facing cloud tool contract; `figma-fetcher.ts` is a REST HTTP helper and is not automatically invoked by the matrix. Verify the active session's tool list and parameter schema before calling either server. Configuration or enablement alone does not prove current-session callability.

| Intent | Recommended Tool | Params | Token Tier | Forbidden High-Token Alternatives |
| :--- | :--- | :--- | :--- | :--- |
| **List Canvases / Screens** | `figma-free: list_frame_summaries` | `{ limit: 50 }` | 🟢 LOW (<300) | `get_frame_bundle` (15k-50k tokens), `list_frames` |
| **Find Local Component** | `figma-free: search_nodes` + local expansion | `{ query, type: 'FRAME'／'CANVAS'／'SYMBOL' }` | 🟢 LOW (<300) | `get_frame_bundle` on all frames |
| **Inspect Layout / Node** | `figma-free: inspect_node` | `{ reference, depth: 2, maxChildren: 50 }` | 🟡 MEDIUM (300-1500) | `get_frame_bundle` (dumps binary assets & full vectors) |
| **Extract Color/Font Tokens** | `figma-free: get_style_tokens` | `{}` | 🟢 LOW (<300) | Deducing tokens via repeated `inspect_node` |
| **Extract Single Icon SVG** | `figma-free: get_vector_svg` | `{ reference }` | 🟢 LOW (<300) | `download_figma_images` (burns cloud quota) |
| **Expand Local Instance** | `figma-free: extract` + resolver | `{ symbolData.symbolID }` | 🟢 LOW (<300) | Calling cloud API before local expansion |
| **Cloud Hydration Fallback** | `figma: get_figma_data` | `{ fileKey, nodeId }` | 🟡 MEDIUM (500-1500)* | `get_figma_data` without `nodeId` (100k+ tokens) |
| **Raster Image Preview** | `figma: download_figma_images` | `{ fileKey, nodeIds: [id] }` | 🟢 LOW (<300) | Base64 PNG embeds from `get_frame_bundle` |

*\*Always pipe official `get_figma_data` responses through `pruneFigmaNode()` before feeding to LLM prompt.*

## Reusable Scripts

The skill includes executable TypeScript utilities:

- **`scripts/prune-figma-node.ts`**: Recursively strips non-render properties, converts colors to `#RRGGBB`, formats Auto Layout, maps `componentProperties` & `layoutGrow`, extracts icon hints, and reports compression stats.
- **`scripts/inspection-decision.ts`**: Validates inspection nodes and Figma nodes responses, evaluates whether a node with missing children should trigger fallback, detects `lk-` local hashes, resolves recommended MCP tools via `resolveRecommendedTool()`, and exposes `resolveFallbackStage()` for the local-search to cloud-hydrate transition.
- **Local resolver (`figma-free-mcp/packages/core`)**: Preserves `symbolData` references and expands local instances into `resolvedChildIds`; use this before any cloud fallback.
- **`scripts/cache-manager.ts`**: Local disk persistence manager with exact `.figctx` bundle identity, source/schema validation, atomic writes, and `getOrSet()` in-process concurrent miss deduplication.
- **`scripts/figma-fetcher.ts`**: Resilient HTTP client with bounded total attempts, abortable backoff, 60s circuit-breaker on long cooldowns, rate-limit metadata, and 4xx fast-fail.
- **`scripts/test-runner.ts`**: Verifies the Alert-shaped synthetic fixture, full-depth retention, supported styling properties, unsupported-property markers, compression ratios, props/flex extraction, cache auto-invalidation, and tool selection matrix.

### Usage Example
```typescript
import { pruneFigmaNode } from './scripts/prune-figma-node.ts';
import { evaluateNodeForFallback, validateFigmaNodesResponse } from './scripts/inspection-decision.ts';
import { FigmaCacheManager } from './scripts/cache-manager.ts';
import { fetchFigmaWithRetry, FigmaRateLimitError } from './scripts/figma-fetcher.ts';
import { expandLocalInstances } from '@figctx/core';

const cacheManager = new FigmaCacheManager();

// 1. Expand local component definitions before considering cloud fallback.
const expandedDocument = expandLocalInstances(localDocument);
const expandedNode = expandedDocument.nodesById[localNode.id] ?? localNode;
if (expandedNode.resolvedChildIds?.length) return buildLocalContext(expandedDocument, expandedNode);

// 2. Evaluate node heuristics only after local expansion misses.
const evaluation = evaluateNodeForFallback(localNode, fileKey);
if (evaluation.shouldFallback) {
  if (evaluation.isLocalFileKey) {
    console.warn('Local lk- key detected. Obtain cloud Figma URL before calling official API.');
    return;
  }

  // 3. Cache miss and targeted fetch with bounded attempts and 60s circuit breaker
  try {
    const url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(localNode.id)}`;
    const entry = await cacheManager.getOrSet(fileKey, localNode.id, async () => {
      const response = await fetchFigmaWithRetry(url, {
        headers: { 'X-Figma-Token': process.env.FIGMA_ACCESS_TOKEN || '' }
      }, { maxAttempts: 3, maxWaitSeconds: 60 });
      const rawNode = validateFigmaNodesResponse(await response.json(), localNode.id);
      return { componentName: localNode.name, ast: pruneFigmaNode(rawNode) };
    });

    // Measure compression per fixture before making savings claims.
    return entry.ast;
  } catch (err) {
    if (err instanceof FigmaRateLimitError) {
      console.error(`Circuit breaker tripped or max retries exceeded: ${err.message}`);
    }
    throw err;
  }
}
```

## Quick Reference

| Dimension | `figma-free` | Official `figma` API | Pruned Hybrid Approach |
| :--- | :--- | :--- | :--- |
| **Network & 429 Risk** | No REST quota for local calls | Depends on current Figma seat/tier/plan limits | Reduced by local-first and cache; fallback still consumes quota |
| **Instance Hydration** | Local `symbolData` + component expansion | Full cloud hydration | Local expansion first; cloud only when local resolution misses |
| **Token Consumption** | Moderate | Very High (Raw AST) | Measure per fixture; current synthetic benchmark reports min=-11%, median=24%, max=30% byte savings |
| **Visual Parity** | High for frames, low for external instances | Depends on returned data | Full hierarchy plus supported render-critical properties |
| **Cache Reliability** | N/A | None (Stateless) | Source/schema/identity checks plus in-process concurrent deduplication |
| **Resilience & Safety** | N/A | Depends on client | Bounded attempts + abortable backoff + 60s circuit breaker |

## Common Mistakes & Red Flags

- **Red Flag: Calling official API with `lk-...` fileKey.** Local Kiwi export hashes will return HTTP 404. Ask user for real cloud URL first.
- **Red Flag: Calling official API on leaf nodes** (`TEXT`, `RECTANGLE`, `VECTOR`). They never have children.
- **Red Flag: Full-depth fetch on entire pages.** This triggers HTTP 414, 504 timeouts, or 429 rate limits. Always target single component IDs.
- **Red Flag: Truncating depth on composite components.** Truncating depth at `depth=2` drops typography, corner radii, and icon vectors, breaking visual parity.
- **Red Flag: Calling API before local expansion.** For an empty Instance, inspect `symbolData.symbolID`, resolve the local component, and check `resolvedChildIds` before making external HTTP requests.
- **Red Flag: Searching only literal SYMBOL names.** A component may be a named `FRAME`／`CANVAS` container whose variant `SYMBOL` children use property-style names such as `Type=Warning...`.
- **Red Flag: Manual cache clearing.** Trust `sourceSha256` auto-invalidation; only clear cache manually when debugging or renaming files.
- **Red Flag: Unbounded `Retry-After` sleep.** A long cooldown may indicate rate limiting or quota pressure; never sleep indefinitely and preserve response metadata for diagnosis.
- **Red Flag: Retrying 4xx client errors.** 400, 401, 403, and 404 are permanent client errors. Retrying them wastes time and masks setup errors.
- **Red Flag: Blindly calling `get_frame_bundle`.** `get_frame_bundle` dumps all assets, vectors, and PNG references (15k-50k tokens). Always prefer `list_frame_summaries`, `search_nodes`, or `inspect_node(depth: 2)`.
- **Red Flag: Calling `get_figma_data` without `nodeId`.** Fetching the entire Figma cloud file returns tens of MBs (100k+ tokens) and triggers HTTP 504. Always specify the target `nodeId`.
