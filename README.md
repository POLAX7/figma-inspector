# Figma Inspector and Token Compression Architecture Analysis Report

- **Analysis topic**: Resolve the instance expansion gap between `figma-free` and the official Figma API, reduce HTTP 429 risk, and use AST pruning to retain supported render-critical data while measuring fixture compression results
- **Deliverables**:
  - Skill specification: `.agents/skills/figma-inspector/SKILL.md`
  - Core script: `.agents/skills/figma-inspector/scripts/prune-figma-node.ts`
  - Decision engine: `.agents/skills/figma-inspector/scripts/inspection-decision.ts`
  - Cache manager: `.agents/skills/figma-inspector/scripts/cache-manager.ts`
  - Resilient fetcher: `.agents/skills/figma-inspector/scripts/figma-fetcher.ts`
  - Test suite: `.agents/skills/figma-inspector/scripts/test-runner.ts`
  - Local resolver: `figma-free-mcp/packages/core/src/normalize/document.ts`
  - Local extraction pipeline: `figma-free-mcp/packages/core/src/extract.ts`
  - Local context traversal: `figma-free-mcp/packages/core/src/context/node-context.ts`
  - Local bounded inspection: `figma-free-mcp/packages/core/src/context/inspect-node.ts`
  - Core exports: `figma-free-mcp/packages/core/src/index.ts`
  - Resolver tests: `figma-free-mcp/packages/core/test/normalize.test.ts`
  - Actual validation fixture: `.figctx/mail-template-expanded-v4/`

---

## 1. Background and Core Tensions

During Figma design analysis and frontend reconstruction with an AI Agent, analysis of node `1518:55106` (named `Alert`) revealed two key tensions:

1. **Offline tooling and the web presentation are inconsistent (partly based on user observation)**:
   - In the local offline tool `figma-free`, this node has an empty `childIds` array (`[]`, `childCount: 0`).
   - The Figma Web screenshot provided by the user visibly shows the instance's internal text and layers: `Title`, `Text`, `Cancel Button`, and `Buttons`. The Properties panel also shows component properties and layout/style fields. The Agent could not independently operate a logged-in Figma Web session, but the screenshot provides visual and property evidence.
   - Further inspection of the raw `.fig` Kiwi data shows that the `INSTANCE` does contain a parent-component reference: the raw node retains `symbolData.symbolID` and `symbolData.symbolOverrides`, including text overrides. The original exporter only emitted the instance's own `childIds: []` and did not reconnect and expand the corresponding `SYMBOL` component definition. Therefore, the first conclusion should be an instance hydration/parse expansion problem; it should not be concluded that `DesignSystem.fig` lacks the Alert content.
2. **The trade-off between full-depth visual consistency and token/API limits (to prevent 429s)**:
   - The official Figma REST API can serve as a server-side component hydration fallback, but rate limits must be determined from the official documentation and response metadata. The targeted request in this investigation actually returned HTTP 429.
   - Full-depth retrieval of an entire page or canvas for high fidelity can produce very large JSON payloads, HTTP 414 URI-too-long errors, server 504 timeouts, and excessive LLM context usage.
   - Truncating depth at `depth=2` to save tokens loses critical leaf-node CSS properties such as `fontSize`, `fontWeight`, `lineHeight`, `radius`, `box-shadow`, and SVG icons, reducing visual fidelity.

## 2. Underlying Mechanisms and Root Causes

### Why is `figma-free`'s `childIds` empty?

Figma's underlying `.fig` binary Kiwi format uses a lightweight representation for **`INSTANCE`** nodes to improve performance and reduce file size:

* The instance itself stores only its bounds, Auto Layout settings, override properties, and the parent-component reference ID.
* Default child layers of the parent **`SYMBOL`** that are not overridden are not duplicated into the instance.
* **Figma Web** uses its WASM core engine to trace the parent component and perform in-memory hydration while loading.
* **`figma-free`** reads the local offline file structure directly. If the component is an externally referenced Team Library component and the local file has no parent-component entity, the instance naturally appears with `childIds: []` until cross-library composition is implemented.

### Official Figma API 429 rate limiting

The Figma REST API uses a leaky-bucket algorithm, with quotas calculated across several dimensions:

1. **Seat type**: `View/Collab` seats have lower quotas and are more sensitive to traffic variation than `Dev/Full` seats.
2. **File plan and resource scope**: Actual quotas vary by team, seat, resource, and API type as described in the official documentation. This report does not hard-code universal Starter, Professional, or Enterprise numbers.
3. **Observed in this investigation**: The targeted request for the file returned HTTP 429. Available limit information must be taken from that response's metadata and the current official documentation.

## 3. Architecture: Offline First, Targeted Full Depth, and AST Pruning

To reduce API 429 and context expansion risk while retaining supported render-critical fields, we propose a hybrid architecture based on **micro-scope full-depth inspection with horizontal property pruning**:

```
       [Use local figma-free for fast location (0 network requests, 0 429 risk)]
                                │
                                ▼
                   [Are childIds empty?]
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
         [Normal leaf/empty frame]       [Potentially unexpanded INSTANCE]
         (TEXT, RECT, FRAME)             (Auto Layout or semantic signals)
                 │                             │
          (🚫 Do not call API)                  ▼
                                   [Search locally for the parent SYMBOL]
                                        /             \
                                    (Found)         (Not found)
                                      /                 \
                           [Reuse local parent]   [🎯 Surgical official API call]
                           (🎉 0 API usage)       (single Node ID, unlimited depth)
                                                        │
                                                        ▼
                                             [✂️ Retain depth + prune properties]
                                             (remove transform/matrix/noise)
                                             (retain supported font/color/radius/shadow fields)
                                                        │
                                                        ▼
                                             [💾 Cache locally and reuse while source is unchanged]
                                             (measure compression against fixtures)
```

### Key technical points

#### 1. Heuristic decision evaluation

Before making any network request, the code evaluates these signals:

* **Leaf filtering**: `TEXT`, `VECTOR`, and `RECTANGLE` nodes cannot contain child layers, so API calls are blocked immediately.
* **Layout signals (candidate indicators)**: `type === 'INSTANCE'` with `layout.stackSpacing > 0` or padding suggests that a local symbol search is worthwhile. It does not prove that an unexpanded subtree exists.
* **Semantic and variant signals**: names matching `Alert`, `Button`, or `Modal`, and the presence of `componentProperties`, increase candidacy only; they cannot independently confirm a complete subtree.
* **Local-key guard (`lk-` detection)**: if `originFileKey` starts with `lk-` (a local Kiwi-export hash), official API calls are blocked because the API accepts cloud FileKeys, not local hashes. The Agent is directed to search the local parent-component page (such as `Internal Only Canvas`) or request a real cloud URL.
* **Local-first search**: use `figma-free`'s `search_nodes(query, type: 'SYMBOL')` to check whether the parent definition already exists in the current file.

#### 2. Micro-scope full depth

Do not retrieve an entire page. Request only the single target component ID (for example, `1518:55106`) from the official API, with timeout, payload, and rate-limit protections still applied. A single component is usually smaller than a page, but node count, payload size, and the possibility of 414/429 responses remain source- and service-dependent.

#### 3. Complete vertical recursion with horizontal property pruning

* **Retain supported render-critical properties**:
  * Layout: `mode` (ROW/COL), `gap`, `padding` (formatted as CSS `T R B L`), `flex` (when `layoutGrow: 1`), `align`, `justify`, `width`, and `height`.
  * Style: `fill` (converted to `#RRGGBB` or `rgba()`), `stroke`, `radius` (including independent corner radii such as `"8px 8px 0px 0px"`), and `shadow`.
  * Text: `font` (combined into a CSS shorthand), `characters`, `color`, and `lineHeight`.
  * Vector icon hinting: retain `icon: { name, size }` so frontend code can reference `<Icon name="warning" size={24} />` without carrying large vector paths.
  * Component variants: extract `props` from `componentProperties` for direct React/Vue prop translation.
  * Child nodes: recursively retain all children present in the input through the leaf nodes; the tool does not invent children when an instance has none.
* **Remove noise**: `relativeTransform` matrices, `constraints`, `blendMode: PASS_THROUGH`, `exportSettings`, and empty arrays.

#### 4. Strict retry limits and circuit-breaker protection

Official REST API calls must be protected by explicit safety rules:

1. **Bounded total attempts**: `maxAttempts` includes the initial request. 429 and retryable 5xx responses have a clear upper bound; infinite loops are prohibited.
2. **Circuit-breaker cooldown cap (currently 60 seconds)**: if `Retry-After` exceeds the configured cap, immediately throw `FigmaRateLimitError` while retaining available rate-limit metadata. This alone does not prove that the quota is exhausted.
3. **Fast fail for client errors**: never retry 400, 401, 403, or 404 responses (including missing files/nodes and local `lk-` keys).
4. **Exponential backoff with jitter**: if the server does not return `Retry-After`, back off according to $2^{\text{attempt}-1} + \text{jitter}$ (approximately 1s, 2s, and 4s).

#### 5. MCP tool selection matrix

`inspection-decision.ts` includes `resolveRecommendedTool()` to prevent accidental use of high-token methods such as `get_frame_bundle`:

| Development intent | Recommended tool | Minimum parameters | Token rating | Strictly prohibited alternative |
| :--- | :--- | :--- | :--- | :--- |
| **Page overview/find canvas** | `figma-free: list_frame_summaries` | `{ limit: 50 }` | 🟢 LOW (<300) | `get_frame_bundle` (15k–50k tokens at once), `list_frames` |
| **Search parent components/find elements** | `figma-free: search_nodes` | `{ query, type: 'SYMBOL' }` | 🟢 LOW (<300) | Looping over every Frame with `get_frame_bundle` |
| **Inspect local layout** | `figma-free: inspect_node` | `{ reference, depth: 2, maxChildren: 50 }` | 🟡 MEDIUM (300–1500) | `get_frame_bundle` with large binary hashes and full vectors |
| **Read design tokens/variables** | `figma-free: get_style_tokens` | `{}` | 🟢 LOW (<300) | Inferring styles by traversing many nodes |
| **Extract one icon SVG** | `figma-free: get_vector_svg` | `{ reference }` | 🟢 LOW (<300) | `download_figma_images` (network and quota cost) |
| **Hydrate one unexpanded instance** | `figma: get_figma_data` | `{ fileKey, nodeId }` | 🟡 MEDIUM (500–1500)* | `get_figma_data` without `nodeId` (entire-file retrieval) |
| **Preview a rendered image** | `figma: download_figma_images` | `{ fileKey, nodeIds: [id] }` | 🟢 LOW (<300) | Reading base64 PNG from `get_frame_bundle` |

\* Official `get_figma_data` output must be passed through `pruneFigmaNode()` before entering the LLM prompt.

## 4. Engineering Validation and Results

The architecture has been implemented as TypeScript code and a test suite.

### Implementation results

* **`scripts/prune-figma-node.ts`**: complete AST traversal pruning, color-to-hex conversion, Auto Layout CSS formatting, component prop extraction, and semantic icon annotation.
* **`scripts/inspection-decision.ts`**: automated decision evaluation with diagnostic reasons, `lk-` local-key protection, recommended actions, and the `resolveRecommendedTool` safety matrix.
* **`scripts/cache-manager.ts`**: local disk-cache lifecycle, safe filenames, automatic upward `.figctx` discovery, and `sourceSha256` invalidation.
* **`scripts/figma-fetcher.ts`**: resilient HTTP requests with a three-attempt limit, 60-second circuit-breaker cooldown, immediate 4xx fast fail, and exponential backoff.
* **`scripts/test-runner.ts`**: unit tests covering an Alert-shaped synthetic fixture, local `.figctx` runtime, Props/Flex/Icon extraction, `lk-` boundaries, disk-cache SHA invalidation, API retry/circuit-breaker mocks, and the tool-selection matrix.

### Test data and measured results

Running `node --experimental-strip-types scripts/test-runner.ts` verified:

* **Hierarchy integrity**: the synthetic fixture retained the root, Header, Warning Icon vector, title, explanatory text, button container, and button text through pruning.
* **Semantic and style fidelity**: extracted `Type: "Warning"`, `ShowIcon: true`; mapped `layoutGrow: 1` to `flex: 1`; formatted independent corner radii as `"8px 8px 0px 0px"`; and annotated `Warning Icon (24x24)`.
* **Fixture compression (not a real API payload)**: original node JSON was `6,533 bytes` (character proxy `1,615`); pruned JSON was `2,543 bytes` (character proxy `617`), a **61% byte reduction for this fixture**. Actual project results must be remeasured with the same renderer, input data, and measurement method.
* **Decision engine**: `TEXT` and empty `FRAME` correctly returned `DO_NOT_CALL_API`; a `lk-ca859ba...` key correctly blocked direct API access and suggested `PROMPT_CLOUD_URL` plus local search; a real cloud key correctly suggested `LOCAL_SEARCH_FIRST`.
* **Cache management**: upward search identified `/Users/DavidTai/Documents/GitHub/.figctx` and claimed `.figctx/mail-template/hydrated/`; changing the source `.fig` `sourceSha256` automatically invalidated and removed stale cache data.
* **Retry and circuit breaker**: a mock `Retry-After: 3600` was intercepted above the 60-second cap and stopped immediately with 0ms wait; a 404 fast-failed on the first attempt; and a short 429 (`Retry-After: 0.05s`) succeeded after retry.

## 5. Local Cache Architecture and Persistence

To reduce repeated requests and 429 risk, the system includes a local cache. Existing results can be reused when source version, cache identity, and same-process de-duplication conditions all match; this does not guarantee one official API call across processes or forever.

### Where

The default cache is stored in a dedicated directory under the local project workspace:

```text
<project root>/
└── .figma-cache/
    └── components/
        ├── EXfHitAQKwAIBHdY5fqa9A_1518-55106.json
        ├── EXfHitAQKwAIBHdY5fqa9A_1204-33120.json
        └── ...
```

* Default path: `<cwd>/.figma-cache/components/`; projects using `figma-free-mcp` may instead configure `.figctx/design/hydrated/`.
* Filename format: `${fileKey}_${nodeId.replace(':', '-')}.json`. Colons are replaced to support Windows, Linux, and macOS, and the FileKey prefix prevents node-ID collisions between Figma files.

### How

The cache stores the compact AST after `pruneFigmaNode`, rather than the official API's tens-of-megabytes response. Each file is typically about 2–5 KB and follows this structure:

```json
{
  "fileKey": "EXfHitAQKwAIBHdY5fqa9A",
  "nodeId": "1518:55106",
  "componentName": "Alert",
  "cachedAt": "2026-09-04T09:42:30.000Z",
  "version": "1.0.0",
  "ast": {
    "id": "1518:55106",
    "name": "Alert",
    "type": "INSTANCE",
    "layout": {
      "mode": "COL",
      "gap": 24,
      "padding": "36px 24px 36px 24px",
      "width": 355,
      "height": 240
    },
    "style": {
      "fill": "#FFFFFF",
      "radius": 8
    },
    "children": [
      {
        "id": "I1518:55106;10:1",
        "name": "Header Container",
        "type": "FRAME",
        "children": [
          {
            "id": "I1518:55106;10:3",
            "name": "Alert Title",
            "type": "TEXT",
            "text": {
              "content": "提醒通知",
              "font": "18px PingFang TC 600",
              "color": "#1A1A1A"
            }
          }
        ]
      }
    ]
  }
}
```

### Read/write lifecycle

```
[Agent prepares to analyze node 1518:55106]
             │
             ▼
[Step 1: Check disk cache] ─── cacheManager.has(fileKey, nodeId)
             │
      ┌──────┴──────┐
      ▼ (Hit)       ▼ (Miss)
[Read local JSON]  [Step 2: Start inspection-decision.ts]
(0 API usage)              │
(0 seconds wait)     [Step 3: Full-depth official API call]
(0% 429 trigger)           │
                    [Step 4: Run pruneFigmaNode()]
                            │
                    [Step 5: Write local cache cacheManager.set()]
                            │
                    [Complete; future pages can reuse it]
```

### Cache invalidation and update strategy

* **Refresh one component**: when a designer changes a cloud component, call `cacheManager.clear(fileKey, nodeId)` to remove that file; the next run retrieves the latest style from the official API.
* **Reset all caches**: call `cacheManager.clear()` to clear the entire cache directory.

### Git and team collaboration

* **Default**: add `.figma-cache/` to `.gitignore` as a local acceleration and rate-limit barrier.
* **Shared team use**: if multiple developers or CI/CD frequently generate code, consider committing `.figma-cache/`. Cache identity and source version still require validation, and this cannot guarantee that all future API quota consumption will be eliminated.

## 6. Unverified Items and Known Limitations

### Additional fixture comparison (2026-09-04)

The two source `.fig` files supplied by the user were unpacked:

* `DesignSystem.fig`: 36,659 nodes; contains an `Alert` FRAME `105:18807` with 24 `SYMBOL` variants and related text layers.
* `MailTemplate.fig`: 28,120 nodes; contains an `Alert` FRAME `30:3559` with 24 `SYMBOL` variants and related text layers.
* The variant naming pattern and child counts of both `Alert` containers match; however, the target [1431:38302](/Users/DavidTai/Documents/GitHub/.figctx/mail-template-full/document.agent.json:671588) in MailTemplate is still an `INSTANCE` with `childIds: []`.

The more precise conclusion is therefore that component definitions do exist in the local export, but the `figma-free` exporter does not automatically expand or reconnect them to the instance. This is not simply a missing-library-file problem.

The following items are intentionally not claimed as complete:

* Real cloud API hydration/contract fixture: the targeted request for `node-id=1431-38302` with `depth=2` returned 429 in about 0.9 seconds; no usable real payload was obtained and the request was not retried.
* Direct Figma Web reading by this Agent: the user's screenshot proves that the Web runtime displays the text and properties, but the Agent could not independently operate the Web session and therefore does not have a machine-reproducible Web/API payload.
* Pixel-level or pixel-perfect visual differences: there is no stable renderer, screenshot baseline, or diff report yet; visual QA must be performed separately.
* Fixed API rate-limit numbers by plan: this report does not replace official documentation or response metadata with estimates.
* Final Git worktree state: `.agents` is not a Git repository, so a valid branch/status/HEAD verification cannot be produced there.

## 7. Delivered Assets and Usage Guidance

### Local instance-expansion validation

The `figma-free-mcp/packages/core` local resolver preserves the original `childIds` and stores symbol expansion in `resolvedChildIds`, applying nested component text overrides. After unpacking `MailTemplate.fig` again, the actual output for `1375:32976` contains the title, explanatory text, cancel text, and delete text. This validates the local fixture only; it does not represent completed real API hydration or pixel-level visual QA.

The workflow has been consolidated into a reusable Agent skill:

1. **Skill directory**: `.agents/skills/figma-inspector/`
   * `SKILL.md`: heuristic rules, decision flow, cache conventions, common errors, and usage guidance.
   * `package.json`: native ESM execution support.
   * `scripts/`: pruning, decision, cache, API resilience, and test tools.
2. **figma-free-mcp local resolver**: `packages/core` preserves `symbolData`, resolves same-file component definitions, and expands instances through `resolvedChildIds`; `inspectNode` and `buildNodeContext` read the expanded subtree.
3. **Principles for future Agents**:
   * **Use shallow inspection for macro location**: start with `figma-free` to understand the overall canvas.
   * **Prioritize local expansion for micro implementation**: when an instance is empty, resolve `symbolData` and the same-file component definition first; only if the local resolver cannot resolve it should the cache be checked and a targeted API call considered.
   * **Prune before entering the prompt**: always call `pruneFigmaNode` and write to cache, retaining supported fidelity fields. Visual parity still requires separate manual/visual QA.

---

## 8. Best Practices for User Prompts (Optimal Input Parameters)

To enable `figma-inspector` to locate UI components or image assets with maximum speed, minimal guessing, and high accuracy, provide the following parameters in your prompt:

### 1. The Core "Golden Trio" (Fastest & Most Accurate)

| Parameter | Example Format | Why It Matters |
| :--- | :--- | :--- |
| **1. Figma Web URL** (with `node-id`) | `https://www.figma.com/design/:fileKey/...?...node-id=1437-42481` | Skips fuzzy text searches across the entire document and drills straight down to the exact node (`1437:42481`). Also provides the real `fileKey` for official cloud API fallback if needed. |
| **2. Local primary bundle path** | `/Users/DavidTai/Documents/GitHub/.figctx/mail-template-expanded-v6` | Enables offline-first extraction via `figma-free` (0 API calls, 0 wait time, 0 risk of HTTP 429 rate limits). |
| **3. External Design System path** | `/Users/DavidTai/Documents/GitHub/.figctx/design-system-full` | When the target component is an external Team Library "shell component", the agent uses `componentKey` to retrieve the original vectors/images cross-bundle without timing out or matching wrong local images. |

### 2. Supplementary Clarifications (Preventing Pitfalls)

* **Specify target asset type and level**:
  * **Vector Icon (SVG)**: Describe the position or semantic context (e.g. "the clear 'x' icon inside the search bar").
  * **Raster Image (PNG/JPG)**: Describe container role or purpose (e.g. "user avatar placeholder").
  * **Layout implementation**: Specify target framework (e.g. SwiftUI or React).
* **Specify variant state and overrides**:
  * If the component has interaction states (e.g. `State=Disabled`, `Size=24px`) or text overrides, explicitly instruct the agent to follow the active instance state rather than falling back to base template defaults.

### 3. Recommended Prompt Template

```text
Please use figma-inspector to extract this UI component:

1. Figma node URL: https://www.figma.com/design/D1YdPEP1ny5AiqROSWGpSj/即時通信件合併?node-id=1437-42481
2. Local primary bundle: /Users/DavidTai/Documents/GitHub/.figctx/mail-template-expanded-v6
3. External Design System: /Users/DavidTai/Documents/GitHub/.figctx/design-system-full
4. Task objective: Extract the SVG vector data for the funnel filter icon located next to the top search bar, and verify its dimensions and color.
```

---

## 9. Safety Rules: Rate-Limit Protection & Fail-Loud Alerting

When executing `figma-inspector`, AI Agents must strictly adhere to the following two hard rules:

### 1. Fail Loud: Explicitly Alert the User on Any Failure
* **Zero Silent Degradation**: If any step in the process encounters an issue (e.g. node not found locally, shell component missing matching peer bundle, empty SVG vector extraction, unresolvable component swaps), the Agent **must never silently skip, guess SF Symbols, invent ad-hoc SVG paths, or substitute incorrect local images**.
* **High-Visibility Alerting**: Output a clear warning block (`> [!WARNING]`) detailing the exact node ID, component name, failure root cause, and remediation steps (e.g. prompting user to export missing Team Library `.fig`).

### 2. Mandatory User Confirmation Before Calling Official Figma API (Free Tier Protection)
* **Strict Free Tier API Limits**: The official Figma REST API and Figma MCP (`get_figma_data`, `download_figma_images`) have very low rate-limit quotas on free plans and trigger HTTP 429 easily.
* **Mandatory Confirmation Gate**: The Agent **must pause and request explicit user confirmation** before making any call to the official Figma API.
* **Confirmation Request Must Include**:
  1. Why offline resolution and peer bundle searches were insufficient.
  2. The exact `nodeId` and cloud `fileKey` to be fetched.
  3. A reminder that the operation consumes cloud API quota.
  4. Execution proceeds only after the user grants explicit permission.
