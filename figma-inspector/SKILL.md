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
[Shell Component?]   [Check cloud key + API permission]
(expanded tree has         │
0 vector/image assets)     ▼
   /            \     [Targeted Official API Call]
 (No)          (Yes)  (GET /v1/files/:key/nodes?ids=ID)
  /               \        │
[Ready for Code]  [Check component.sourceLibraryKey]
                  [and componentKey via inspect_node]
                        │
                        ▼
                  [Search Peer Bundles (.figctx/*/manifest.json)]
                  (e.g. DesignSystem via search_nodes)
                        │
                  /           \
               (Found)     (Missing)
                 /               \
        [Extract True Asset]   [Fail Loud: Prompt User to]
        (get_vector_svg /      [Export External Library .fig]
         compose_vector_svg)
                        │
                        ▼
                  [Ready for Code Gen]
```

## Core Patterns

### 1. Offline-First, Cloud-Fallback
Always explore designs offline first via `figma-free` (`search_nodes`, `inspect_node`). Those local calls do not consume Figma REST API quota; any later official MCP／REST fallback remains a separately observable network operation.

### 1.1 Mandatory User Confirmation Gate for Official Figma API Calls (打官方 API 前必須徵詢使用者同意)
> [!IMPORTANT]
> **Free Account API Quota Protection**: Free Figma accounts have an extremely restrictive API rate limit. Calling the official Figma REST API or official Figma MCP (`figma: get_figma_data`, `figma: download_figma_images`) without consent can instantly exhaust the user's quota or trigger HTTP 429 rate limits.
>
> **Hard Rule**:
> 1. **Never call official Figma API tools autonomously.**
> 2. When local resolution and peer bundle searches are exhausted and official API hydration is genuinely required, **the Agent MUST pause and ask for explicit user confirmation first**.
> 3. The confirmation request must clearly state:
>    - The reason why local inspection/peer bundle failed.
>    - The exact `nodeId` and cloud `fileKey` to be fetched.
>    - The reminder that free account API quota is strictly limited.
> 4. **Only proceed if the user explicitly approves the API call.**

### 1.2 Fail Loud & Immediate User Alerting on Any Failure (遇到任何失敗一律特別提醒使用者)
> [!WARNING]
> **Zero Silent Degradation**:
> 1. If **ANY** step in the inspection process fails (e.g. node not found, shell component has no matching peer bundle, vector extraction fails, component swap cannot be resolved, or an API error occurs):
>    - **Immediately and explicitly alert the user.**
>    - Highlight the exact failure reason, affected node ID, and component name in high-visibility formatting.
>    - Provide actionable next steps (e.g., prompt user to export missing library `.fig`, verify node ID, or provide cloud URL).
> 2. **Strictly Prohibited**:
>    - NEVER silently skip missing layers or assets.
>    - NEVER invent, mock-stitch, or guess vector paths or SF Symbols.
>    - NEVER silently pick unrelated local images or default components as substitutes.
>    - NEVER claim completion when visual assets are unresolved.

### 1.3 Primary Bundle Short-Circuit Rule (主 Bundle 優先短路原則 — 嚴禁過度跨庫探索)
> [!IMPORTANT]
> **Primary-First Fast Path**:
> When the user specifies both a **primary local bundle** and an **external Design System bundle**:
> 1. **Always inspect and attempt output on the PRIMARY bundle first.**
> 2. Check if the target node in the primary bundle already contains rendered geometry or child layers (`resolvedChildIds.length > 0` or own vector/asset refs).
> 3. If the primary bundle already contains the needed vector or image assets:
>    - **IMMEDIATELY proceed with the output/render.**
>    - **DO NOT** proactively inspect, traverse, or query the external Design System bundle.
> 4. The external Design System is strictly a **fallback candidate** to be consulted ONLY IF:
>    - The primary bundle does NOT contain the node, OR
>    - The node in the primary bundle is verified to be a hollow Shell Component (0 vectors and 0 image fills).
> 5. Proactively exploring the external library when the primary bundle already has the required assets is an anti-pattern that wastes token budget and introduces confusion.



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

### 2.1 Instance Override & Swap Verification Gate (Override-First)
When inspecting an `INSTANCE` node:
1. **Never treat the base component as ground truth**: The base `SYMBOL` defines layout and default fallback values. When an instance overrides text or swaps child components, the instance's overrides supersede the base component.
2. **Resolve Instance Swaps**: Check `componentPropAssignments` and `symbolOverrides`. If child subcomponents (such as icon buttons) are swapped, trace and resolve the target swapped component rather than retaining the base template's default child.
3. **Fail Loud on Unresolved Swaps**: If the local tool or bundle cannot resolve the swapped component (e.g. cross-file Team Library reference), do NOT invent, mock-stitch, or guess icon paths or SF Symbols. Report the missing reference explicitly.
4. **Semantic Alignment Sanity Check**: Cross-check button labels against associated icon semantics (e.g., a "排序" button must not silently adopt a "History/Clock" icon without raising a semantic warning).

### 2.1.1 Final Instance Visibility Gate (實例最終可見性檢查)
Before implementing or reporting any UI from an `INSTANCE`, use this order:
1. Inspect the exact screen instance, not only its `mainComponentId` or base `SYMBOL`.
2. Resolve `resolvedChildIds` and retain raw `childIds` only as export diagnostics; raw `childIds: []` is not proof of visibility or absence.
3. Walk the resolved instance subtree and record each ancestor/child `visible` value. A layer is renderable only when it and every visible ancestor are enabled.
4. Apply `componentPropAssignments`, `symbolOverrides`, text overrides, visibility properties, and component swaps before describing the final UI.
5. If the instance and base component disagree, report the instance result and identify the overridden base layer that was excluded.
6. For visual claims, require a rendered reference or screenshot check after structural inspection; unresolved visibility or swap state must be reported as an evidence gap, not silently implemented.

### 2.2 Cross-Bundle Team Library Resolution (Peer-Bundle Discovery)
When an instance references an external Team Library component:
1. **Trace Library Pointers**: Raw nodes identify external symbols via:
   - `sourceLibraryKey`: The library's unique origin hash (e.g., `lk-d20be...`).
   - `publishID`: The canonical component ID within that library (e.g. `{ sessionID: 101, localID: 15798 }` -> `101:15798`).
2. **Automatic Peer-Bundle Resolution**: The `figma-free-mcp` server automatically indexes peer bundles in sibling directories (`.figctx/*/manifest.json`). When querying a node ID or Figma URL belonging to an external library, the MCP seamlessly routes queries to the corresponding peer bundle.
3. **Handling Missing Team Libraries**:
   - If the external `sourceLibraryKey` does not match any local bundle under `.figctx/`, **Fail Loud**: report to the user that the design references an external Team Library (`sourceLibraryKey`) that has not yet been exported locally.
   - Instruct the user to export the library `.fig` file into `.figctx/<library-name>` or await cloud API rate-limit recovery. Never guess or fabricate icon shapes.
4. **Stroke-Based Outline Icons**: Many design system icons use `stroke` instead of `fill`. Ensure vector extraction tools preserve stroke weight, stroke alignment, and color (`stroke="#HEX"` with `fill="none"`).

### 2.3 Shell Component Detection & Cross-Bundle Resolution (空殼元件偵測與跨庫解析)
In local `.fig` exports, **up to 74% of SYMBOL nodes and expanded INSTANCE nodes are "shell components"**:
Figma caches external Team Library component tree structures (child hierarchy, layout frames, text nodes) in the local `.fig` file, but **does NOT embed binary vector network blobs (`vectorRef`) or image fills (`assetRefs`)**.

#### Detection Criteria (空殼判定條件)
A node is an **External Library Shell Component** when:
1. `node.type === 'INSTANCE'` or `node.type === 'SYMBOL'`
2. `childCount > 0` (or `resolvedChildIds` populated), BUT **no node in the entire subtree has `vectorRef` or image `assetRefs`** (`assets.imageFillCount === 0 && assets.hasVector === false`).
3. `component.sourceLibraryKey` or `component.componentKey` is present (exposed in `inspect_node`), identifying its external origin.

#### Resolution Rules (解析原則)
1. **Never search the current bundle by name**: When an icon/button instance is a shell component, searching for its name in the current bundle will match unrelated local assets or time out with wrong images. **Stop immediately.**
2. **Read Library Metadata from `inspect_node`**:
   - `component.sourceLibraryKey`: origin library hash (e.g., `lk-d20be...`).
   - `component.componentKey`: cross-file unique component identifier.
3. **Query Peer Bundles**:
   - The `figma-free-mcp` automatically discovers peer bundles located in sibling directories under `.figctx/`.
   - Call `search_nodes(query: componentKey, type: 'SYMBOL')` or search by name across peer bundles to locate the original master `SYMBOL` that contains full vector networks and image assets.
   - Extract the asset using `get_vector_svg(reference: peerNodeId)` or `compose_vector_svg`.
4. **Fail Loud When Peer Bundle is Missing**:
   - If no peer bundle under `.figctx/` matches `sourceLibraryKey` or contains the component, **report the gap to the user immediately**.
   - Instruct the user to export the missing Team Library (e.g. `面試筆記 Design System.fig`) into `.figctx/<bundle-name>/`.
   - **Strictly forbid guessing, ad-hoc SVG fabrication, or using visually incorrect local assets.**

### 3. Micro-Scope Full-Depth + Property Pruning
To preserve measured visual properties without token bloat:
* **Scope down**: Never call full-depth on an entire canvas or page. Only call full-depth on the single isolated component instance (`ids=1518:55106`); `inspect_node(depth: 2)` is bounded inspection, not full-depth evidence.
* **Prune horizontally**: Recursively keep all nested children down to the leaves, but discard only metadata classified as non-rendering. Unsupported render properties are reported in `unsupportedProperties` rather than silently discarded.
* **Format CSS**: Convert colors to `#HEX` or `rgba()`, layout to CSS flexbox properties (`mode`, `gap`, `padding`), `layoutGrow: 1` to `flex: 1`, and format 4-corner radii to standard CSS string (`"8px 8px 0px 0px"`).
* **Extract Props & Icon Hints**: Keep `props` from `componentProperties` for TypeScript props interface generation, and `icon: { name, size }` for vector nodes so the frontend knows what icon component to render. An icon hint is semantic metadata, not a replacement for the original SVG path; render-critical output marks unconverted vector geometry explicitly, while lossless output preserves it.

The current pruner supports three explicit modes: `semantic` emits semantic node data and hierarchy, `render-critical` emits the supported layout/style subset plus `unsupportedProperties`, and `lossless-ast` additionally keeps selected original render metadata. None of these modes alone proves pixel equality. Gradient/image fills, fill/stroke geometry, multiple strokes, vector paths, mixed text styles, non-default blend modes, rotation, clipping/masks, and non-drop-shadow effects are not yet converted to compact CSS. Compression is fixture-dependent: small leaf nodes can grow after normalization, so report min/median/max measurements rather than promising a universal savings percentage.

### 3.1 Vector asset evidence gate

For any icon or SVG requested from a Figma URL:

1. Parse the URL's `fileKey` and `node-id` first. Route directly to the matching local `.figctx` bundle when its manifest, source filename, and source SHA are available; do not begin a repository-wide name search.
2. Confirm the exact node, its component/variant chain, vector blob reference, and intended use in the target frame. A same-named asset is only a candidate.
3. Inspect `fills`, `strokes`, `strokeWeight`, `strokeCap`, and `strokeJoin`. Preserve outline semantics as stroke geometry and filled semantics as fill geometry.
4. Treat generated SVG as an extracted representation that requires checks for connected region loops, segment orientation, and XML validity. Passing an SVG byte comparison alone does not prove that it is the correct product icon.
5. Record parser version and source freshness. If the local bundle is stale or the requested node is absent, report that evidence gap before using a cloud fallback.

6. When exporting an icon, use the component or instance frame as the default reference so its original canvas size and internal whitespace are preserved. Use a leaf VECTOR reference only when tight cropping is explicitly requested. Preserve the vector's transform and stroke cap/join in the resulting SVG.

### 3.2 Direct CLI Output Fallback (CLI 輸出備援原則)
When the user explicitly asks to **export an SVG or image file to a destination** (e.g. `Downloads/` or project assets):
1. **Try MCP tool first**: Call `figma-free: get_vector_svg` with the target `reference`.
2. **Immediate CLI Fallback on MCP failure**: If `get_vector_svg` fails (e.g. background daemon bundle root mismatch, stale daemon process, or `No renderable vector group` error):
   - **DO NOT** wander off to inspect raw AST JSON or search arbitrary peer libraries.
   - **IMMEDIATELY execute the figma-free CLI render command**:
     ```bash
     node packages/cli/dist/main.js render <bundlePath> --node <nodeId> > <outputPath>
     ```
   - The CLI directly accesses the target bundle on disk and renders without depending on daemon socket state.

### 3.3 Variant Stroke Weight Precision (變體筆觸寬度精確性)
Design System icons frequently share a single base vector network blob across multiple size variants (e.g., 20px with 1.2px stroke, 30px with 1.8px stroke):
1. **Shared Blob Default**: The Kiwi vector blob records the stroke weight of whichever variant defined it first (e.g. 1.2px).
2. **Instance Override**: The rendering engine (`pathElements` in `frame.ts`) must explicitly override the SVG fragment's `stroke-width` with the instance node's own `strokeWeight` (e.g. 1.8px).
3. **Verification**: Always confirm that exported SVGs reflect the instance's declared `strokeWeight` rather than falling back to the base fragment's default.


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
- **Red Flag: Using base component default icons on an overridden instance without verifying `componentPropAssignments`.** In Figma, an `INSTANCE` frequently swaps subcomponents (e.g. replacing default icons). Never assume the base `SYMBOL`'s default child nodes represent the final screen. When component prop assignments exist, they must be resolved or explicitly reported as unresolved.
- **Red Flag: Ad-hoc manual vector parsing or mock-stitching when extraction tools fail.** Never parse raw binary geometry with custom scratch scripts, guess SF Symbols, or manually stitch disparate coordinate paths together. Adhere strictly to Fail Loud: if the MCP tool cannot extract the SVG, state the gap clearly and prompt for official API fallback.
- **Red Flag: Skipping semantic alignment sanity checks.** Always verify that button labels match their associated icon semantics (e.g., a "排序" button should not be silently paired with a clock/history icon). If a conflict or mismatch exists, flag it immediately before presenting conclusions.
- **Red Flag: Searching current bundle by name when encountering a shell component.** External library instances frequently have child tree structure but 0 binary vector/image assets. Searching by name in the same bundle returns completely wrong local assets. Always inspect `component.sourceLibraryKey` / `component.componentKey` and route to the corresponding peer bundle.
- **Red Flag: Calling official Figma API without explicit user confirmation.** Free account API quota is severely limited. The Agent must never autonomously invoke `figma: get_figma_data` or `figma: download_figma_images` without first obtaining explicit approval from the user.
- **Red Flag: Silently ignoring or concealing inspection failures.** If an asset cannot be extracted, a component swap cannot be resolved, or a tool throws an error, the Agent must never silently guess, synthesize placeholders, or proceed without explicitly alerting the user.

## User Prompt Guidelines (提問參數指引)

When instructing an Agent using this skill, providing these three core parameters achieves maximum speed and accuracy:

1. **Figma Web URL with `node-id`**: e.g. `https://www.figma.com/design/:fileKey/...?...node-id=1437-42481` (avoids fuzzy search, jumps straight to exact node `1437:42481`, supplies real cloud `fileKey`).
2. **Local primary `.figctx` bundle path**: e.g. `.figctx/mail-template-expanded-v6/` (enables offline-first resolution with zero API quota consumption).
3. **External Team Library path**: e.g. `.figctx/design-system-full/` (enables cross-bundle peer resolution via `componentKey` when encountering shell components).
