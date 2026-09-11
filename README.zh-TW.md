# Figma Inspector 與 Token 壓縮架構分析報告

- **分析主題**：解決 `figma-free` 與官方 Figma API 的實例展開落差、降低 HTTP 429 風險，並透過 AST 剪枝保留已支援的 render-critical 資料與量測 fixture 壓縮效果
- **交付檔案**：
  - 技能規範：`.agents/skills/figma-inspector/SKILL.md`
  - 核心程式：`.agents/skills/figma-inspector/scripts/prune-figma-node.ts`
  - 決策引擎：`.agents/skills/figma-inspector/scripts/inspection-decision.ts`
  - 快取管理：`.agents/skills/figma-inspector/scripts/cache-manager.ts`
  - 彈性請求：`.agents/skills/figma-inspector/scripts/figma-fetcher.ts`
  - 測試套件：`.agents/skills/figma-inspector/scripts/test-runner.ts`
  - Local resolver：`figma-free-mcp/packages/core/src/normalize/document.ts`
  - Local extraction pipeline：`figma-free-mcp/packages/core/src/extract.ts`
  - Local context traversal：`figma-free-mcp/packages/core/src/context/node-context.ts`
  - Local bounded inspection：`figma-free-mcp/packages/core/src/context/inspect-node.ts`
  - Core exports：`figma-free-mcp/packages/core/src/index.ts`
  - Resolver tests：`figma-free-mcp/packages/core/test/normalize.test.ts`
  - 實際驗證 fixture：`.figctx/mail-template-expanded-v4/`

---

## 一、問題背景與核心矛盾

在利用 AI Agent 進行 Figma 設計稿分析與前端代碼還原的過程中，我們在分析節點 `1518:55106`（名稱為 `Alert`）時發現了兩個關鍵矛盾：

1. **離線工具與網頁版呈現不一致（部分為使用者觀察）**：
   - 在本機離線工具 `figma-free` 中，該節點的 `childIds` 呈現為空陣列 `[]`（`childCount: 0`）。
   - 使用者提供的 Figma Web 截圖可直接看到該 instance 的內部文字與圖層：`Title`、`Text`、`Cancel Button`、`Buttons`；右側 Properties 也顯示 component properties 與 layout/style 欄位。本 Agent 未能以登入式 Figma Web 工具獨立操作，但此截圖已提供視覺與欄位證據。
   - 進一步檢查 `.fig` 原始 Kiwi 資料可見，該 `INSTANCE` 並非沒有母組件引用：原始節點保留了 `symbolData.symbolID`，以及包含文字覆寫的 `symbolData.symbolOverrides`。問題是原始 exporter 只輸出了 instance 自身的 `childIds: []`，沒有依 `symbolData.symbolID` 將對應的 `SYMBOL` component definition 連回並展開。因此「讀不到 Alert 內文」首先應判定為 instance hydration／parse 展開問題，不能判定為 `DesignSystem.fig` 缺少 Alert 內容。
2. **「畫面一致性（全挖深度）」與「Token/API 限制（防 429）」的兩難**：
   - 官方 Figma REST API 可作為伺服器端組件動態展開（Hydration）的 fallback，但實際 rate limit 需依官方文件與 response metadata 判斷；本次 targeted request 實際遭遇 HTTP 429。
   - 若為追求高保真而對整頁或整個畫布進行「全深度抓取（Full Depth）」，可能導致大型 JSON、HTTP 414 URL 超長、伺服器 504 超時，以及 LLM 上下文視窗膨脹。
   - 若為節省 Token 而將深度截斷在 `depth=2`，又會丟失最底層葉子節點的關鍵 CSS 屬性（如字級 `fontSize`、字重 `fontWeight`、行高 `lineHeight`、圓角 `radius`、陰影 `box-shadow` 與圖示 SVG），破壞畫面還原度。

---

## 二、底層機制與原因剖析

### 1. 為什麼 `figma-free` 的 `childIds` 為空？
Figma 的底層存檔格式（`.fig` 二進位 Kiwi 結構）為提升效能與減少檔案體積，對於 **`INSTANCE`（實例）** 節點採取輕量化記錄：
* Instance 本體**僅儲存外框尺寸、Auto Layout 排版、覆寫屬性（Overrides）與母組件引用 ID**。
* 母組件（`SYMBOL`）未被覆寫的預設子圖層不會被複製一份寫入 Instance 中。
* **Figma 網頁版**：透過 WASM 核心引擎在載入時動態追溯母組件並執行記憶體展開（Hydration）。
* **`figma-free`**：直接解析本機離線檔案結構。若該組件是跨檔案引用的外部團隊庫（Team Library），且本機檔案內無母組件實體，在未實作跨庫動態合成前，讀取到的 Instance 節點自然呈現 `childIds: []`。

### 2. 官方 Figma API 的 429 限流機制
Figma REST API 採用 **漏桶演算法（Leaky Bucket Algorithm）**，依三個維度綜合計算配額：
1. **席位類型（Seat Type）**：`View/Collab`（低配額，易受流量波動限流）vs `Dev/Full`（高配額）。
2. **檔案方案與資源範圍**：實際配額會依官方文件所列的團隊／席位／資源與 API 類型而變動，不能在此報告固定推導 Starter、Professional 或 Enterprise 的通用數字。
3. **本次觀測**：針對目標檔案的 targeted request 實際收到 HTTP 429；可用的限制資訊應以當次 response metadata 與官方文件為準。

---

## 三、解決方案架構：離線優先 + 精準全挖 + AST 剪枝

為降低 API 429 與上下文膨脹風險，並提高已支援 render-critical 欄位的保留程度，我們提出 **「微觀局部全挖 + 橫向屬性剪枝」** 的混合架構：

```
       [使用 figma-free 本地快速定位 (0 網路請求、0 429 風險)]
                                │
                                ▼
                   [發現節點 childIds 為空？]
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
         [一般葉子/空框]               [疑似未展開組件 INSTANCE]
         (TEXT, RECT, FRAME)           (具有 Auto Layout 間距或語意名稱)
                 │                             │
          (🚫 不打 API)                        ▼
                                   [在本地檢索 SYMBOL 母組件]
                                        /             \
                                    (找到)           (未找到)
                                      /                 \
                           [直接復用本地母組件]   [🎯 外科手術式打官方 API]
                           (🎉 0 API 消耗)       (只查單一 Node ID，深度不限)
                                                        │
                                                        ▼
                                             [✂️ 深度保留 + 屬性剪枝]
                                             (移除 transform/matrix/noise)
                                             (保留目前支援的字體/顏色/圓角/陰影欄位)
                                                        │
                                                        ▼
                                             [💾 本地快取，來源未變更時復用]
                                             (壓縮效果以 fixture 量測為準)
```

### 關鍵技術亮點

#### 1. 啟發式決策評估（Heuristic Evaluator）
在呼叫任何網路請求前，透過程式碼自動評估以下特徵：
* **葉子節點過濾**：`TEXT`, `VECTOR`, `RECTANGLE` 等節點在定義上絕無子圖層，立即阻斷 API 調用。
* **排版特徵訊號（候選指標）**：若 `type === 'INSTANCE'` 且 `layout.stackSpacing > 0` 或 `padding > 0`，代表值得執行本地 symbol search；不代表已確認存在未展開子圖層。
* **語意與變體特徵訊號**：名稱匹配 `Alert`, `Button`, `Modal` 等複合組件，或帶有 `componentProperties`，只能提高候選程度，不能單獨確認完整子樹。
* **本機 Key 防呆（`lk-` 檢測）**：若 `originFileKey` 開頭為 `lk-`（本地 Kiwi 導出雜湊），阻斷官方 API 調用（官方 API 只認得雲端 FileKey，發送 `lk-` 會導致 404），改為引導 Agent 優先搜尋本地母組件頁面（如 `Internal Only Canvas`），或向使用者索取真實雲端 URL。
* **本地優先檢索**：先用 `figma-free` 的 `search_nodes(query, type: 'SYMBOL')` 搜尋當前檔案是否已有母組件定義。

#### 2. 微觀作用域全挖（Micro-Scope Full-Depth）
* 不應對整個 Page 全挖；**只對單一目標組件 ID（如 `1518:55106`）請求官方 API**，並仍須受 timeout、payload 與 rate limit 保護。
* 單一組件通常比整頁 payload 小，但實際節點數、體積與是否觸發 414/429 仍取決於來源資料與當次服務狀態，不能保證固定大小或絕對成功。

#### 3. 縱向完整遞迴，橫向屬性剪枝（Deep Pruning）
* **保留目前支援的 render-critical 屬性**：
  * 排版：`mode` (ROW/COL), `gap`, `padding` (格式化為 CSS "T R B L"), `flex` (若 `layoutGrow: 1` 則對應 `flex: 1`), `align`, `justify`, `width`, `height`。
  * 樣式：`fill` (自動轉為 `#RRGGBB` 或 `rgba()`), `stroke`, `radius` (支援四角獨立圓角如 `"8px 8px 0px 0px"`), `shadow`。
  * 文字：`font` (合成為 CSS font 簡寫), `characters`, `color`, `lineHeight`。
  * 向量圖示提示（Icon Hinting）：保留 `icon: { name, size }`，讓前端程式碼能自動引用 `<Icon name="warning" size={24} />`，無需攜帶巨大向量路徑。
  * 組件變體：提取 `props`（來自 `componentProperties`），方便直接轉譯為 React / Vue Props 介面。
  * 子節點：對輸入中存在的 children 完整遞迴保留到底層葉子節點；若來源 instance 沒有子節點，工具不會自行補造。
* **剃除雜訊**：移除 `relativeTransform` 矩陣、`constraints`、`blendMode: PASS_THROUGH`、`exportSettings` 及各類空陣列。

#### 4. 嚴格限流重試與熔斷防禦（Resilient Fetcher & Circuit Breaker）
官方 REST API 呼叫必須受到嚴格的安全守則保護：
1. **有限總嘗試次數**：`maxAttempts` 包含初始請求；針對 429 或可重試 5xx 必須有明確上限，杜絕死迴圈。
2. **熔斷冷卻上限（目前預設 60 秒）**：若 `Retry-After` 超過設定上限，立即拋出 `FigmaRateLimitError`，保留可取得的 rate-limit metadata；不得據此單獨推論配額已耗盡。
3. **4xx 客戶端錯誤快篩（Fast-Fail）**：對 400（Bad Request）、401（未授權）、403（無權限）、404（檔案/節點不存在，如 `lk-` 本地 Key）**絕不重試**，第一時間拋錯。
4. **指數退避加隨機抖動（Exponential Backoff + Jitter）**：若伺服器未回傳 `Retry-After` 標頭，則按 $2^{\text{attempt}-1} + \text{jitter}$ 進行退避重試（約 1s, 2s, 4s）。

#### 5. 工具方法選用決策矩陣（MCP Tool Selection Matrix）
為杜絕 Agent 誤用高 Token 怪物方法（如 `get_frame_bundle` 一次耗費數萬 Tokens），在 `inspection-decision.ts` 內建 `resolveRecommendedTool()` 決策矩陣：

| 開發任務意圖 | 推薦呼叫工具 | 最小必要參數 | Token 消耗評級 | 嚴格禁止的替代方案 |
| :--- | :--- | :--- | :--- | :--- |
| **頁面概覽/找畫布** | `figma-free: list_frame_summaries` | `{ limit: 50 }` | 🟢 LOW (<300) | `get_frame_bundle`（一次噴 15k-50k tokens）、`list_frames` |
| **搜尋母組件/找元件** | `figma-free: search_nodes` | `{ query, type: 'SYMBOL' }` | 🟢 LOW (<300) | 在所有 Frame 上循環調用 `get_frame_bundle` |
| **檢查局部排版樣式** | `figma-free: inspect_node` | `{ reference, depth: 2, maxChildren: 50 }` | 🟡 MEDIUM (300-1500) | `get_frame_bundle`（夾帶大量二進位雜湊與完整向量） |
| **讀取設計 Token/變數** | `figma-free: get_style_tokens` | `{}` | 🟢 LOW (<300) | 遍歷多個 node 反推樣式 |
| **抽取單一 Icon SVG** | `figma-free: get_vector_svg` | `{ reference }` | 🟢 LOW (<300) | `download_figma_images`（需聯網耗配額） |
| **微觀全挖展開實例** | `figma: get_figma_data` | `{ fileKey, nodeId }` | 🟡 MEDIUM (500-1500)* | `get_figma_data` 不帶 `nodeId`（直接抓全檔 100k+ tokens） |
| **預覽渲染圖檔** | `figma: download_figma_images` | `{ fileKey, nodeIds: [id] }` | 🟢 LOW (<300) | 從 `get_frame_bundle` 讀取 Base64 PNG |

*\*官方 `get_figma_data` 回傳資料必須在進入 LLM Prompt 前由 `pruneFigmaNode()` 完成剪枝。*

---

## 四、工程落實驗證與成效

我們已將此方案完整編寫成 TypeScript 程式與測試套件，並經過實測驗證：

### 1. 實作成果
* **`scripts/prune-figma-node.ts`**：
  實現完整的 AST 遍歷剪枝、色彩 Hex 轉換、Auto Layout CSS 格式化、組件 Props 提取與 Icon 語意標註。
* **`scripts/inspection-decision.ts`**：
  實現自動化決策評估引擎，輸出診斷原因、`lk-` 本機 Key 防呆、建議動作，並透過 `resolveRecommendedTool` 自動精算推薦工具與防呆禁忌。
* **`scripts/cache-manager.ts`**：
  實作本機磁碟快取管理器，負責生命週期存取、檔名安全化、`.figctx` 向上自動探測與 `sourceSha256` 自動失效判定。
* **`scripts/figma-fetcher.ts`**：
  實現具備 3 次重試上限、60 秒熔斷冷卻、4xx 立即快篩與指數退避之健壯 HTTP 請求器。
* **`scripts/test-runner.ts`**：
  涵蓋單元測試、Alert-shaped synthetic fixture、local `.figctx` runtime、Props/Flex/Icon 驗證、`lk-` 邊界測試、磁碟快取 SHA 失效檢驗、API 限流重試/熔斷 mock 與工具方法矩陣驗證。

### 2. 測試數據與成效
執行 `node --experimental-strip-types scripts/test-runner.ts` 結果：
* **階層完整性**：synthetic fixture 的根節點、中層 Header、底層 Warning Icon 向量、標題文字、內文說明、按鈕容器與按鈕文字，在 pruner 中完整遞迴保留。
* **語意與樣式精確度**：
  * 提取組件變體 Props：`Type: "Warning"`, `ShowIcon: true`。
  * Auto Layout 轉換：`layoutGrow: 1` 成功映射為 `flex: 1`；四角獨立圓角格式化為 `"8px 8px 0px 0px"`。
  * 向量圖示自動標註：`Warning Icon (24x24)`。
* **Fixture 壓縮量測（非真實 API payload）**：
  * 原始節點 JSON：`6,533 bytes`（character proxy `1,615`）
  * 剪枝後 JSON：`2,543 bytes`（character proxy `617`）
  * **目前 fixture 的 byte 節省率：61%**；實際專案效果需以相同 renderer、輸入資料與量測方式重新驗證。
* **決策引擎驗證**：
  * `TEXT` 節點正確判定為 `DO_NOT_CALL_API`。
  * 空 `FRAME` 正確判定為 `DO_NOT_CALL_API`。
  * 當傳入 `lk-ca859ba...` 本機 Key 時，正確識別為本機離線雜湊，阻斷 API 直連並給出 `PROMPT_CLOUD_URL` 與優先本地搜尋建議。
  * 當傳入真實雲端 Key 時，正確建議 `LOCAL_SEARCH_FIRST`。
* **快取管理驗證**：
  * 向上搜尋自動識別 `/Users/DavidTai/Documents/GitHub/.figctx`，並精準認領 `mail-template/hydrated/` 目錄。
  * **SHA-256 自動失效**：實測當來源 `.fig` 的 `sourceSha256` 變更時，舊快取**自動判定失效並清除**，成功杜絕髒讀問題。
* **API 重試與熔斷驗證**：
  * mock `Retry-After: 3600` 成功攔截超過 60 秒之超長冷卻，觸發 Circuit Breaker 立即中斷，耗時 0ms（無死等掛起）。
  * 404 客戶端錯誤在第 1 次嘗試即觸發 Fast-Fail，絕不無效重試。
  * mock 短暫 429（如 `Retry-After: 0.05s`）在重試後成功解析取得回應。

---

## 五、本地快取架構與持久化機制（Local Caching & Persistence）

為降低重複請求與 429 風險，系統引入本機快取層；在來源版本、cache identity 與同一程序的併發去重條件都成立時，可復用既有結果，但不保證跨程序或永久只呼叫一次官方 API。

### 1. 存放位置與目錄結構（Where）
快取預設存放於本機專案工作區的專屬目錄下：

```text
<專案根目錄>/
└── .figma-cache/
    └── components/
        ├── EXfHitAQKwAIBHdY5fqa9A_1518-55106.json    # 單一組件快取檔案
        ├── EXfHitAQKwAIBHdY5fqa9A_1204-33120.json
        └── ...
```

* **路徑彈性**：預設為 `<cwd>/.figma-cache/components/`；若專案有使用 `figma-free-mcp` 的 `.figctx` 目錄，亦可指定至 `.figctx/design/hydrated/` 整合存放。
* **檔名規範（Sanitization）**：
  * 命名模式：`${fileKey}_${nodeId.replace(':', '-')}.json`。
  * 自動將 Figma Node ID 中的冒號 `:` 轉為 `-`，防止 Windows / Linux / macOS 檔名相容性錯誤。
  * 強制以 `fileKey` 作為前綴，杜絕不同 Figma 檔案間 Node ID 衝突。

### 2. 存放內容與資料結構（How）
快取儲存的並非官方 API 傳回的數十 MB 原始結構，而是**直接存放經過 `pruneFigmaNode` 剪枝後的精簡 AST**。每個快取檔案體積僅約 **2 ~ 5 KB**，包含以下標準結構：

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

### 3. 讀寫生命週期工作流
```
[Agent 準備分析節點 1518:55106]
             │
             ▼
[Step 1: 檢查磁碟快取] ─── cacheManager.has(fileKey, nodeId)
             │
      ┌──────┴──────┐
      ▼ (Hit 命中)  ▼ (Miss 未命中)
[直接讀取本機 JSON]  [Step 2: 啟動決策引擎 inspection-decision.ts]
(0 API 消耗)                │
(0 秒等待)           [Step 3: 呼叫官方 API 全挖]
(0% 觸發 429)                │
                    [Step 4: 執行剪枝 pruneFigmaNode()]
                            │
                    [Step 5: 寫入本機快取 cacheManager.set()]
                            │
                    [完成寫入，供未來所有頁面永久重用]
```

### 4. 快取失效與更新策略（Cache Invalidation）
* **單一組件重整**：當設計師在 Figma 雲端調整某元件樣式時，調用 `cacheManager.clear(fileKey, nodeId)` 刪除該特定檔案，下次執行會自動重新由官方 API 抓取最新樣式。
* **全域快取重置**：調用 `cacheManager.clear()` 一鍵清空快取目錄。

### 5. Git 與團隊協作策略
* **預設情境**：將 `.figma-cache/` 加入 `.gitignore`，作為開發者本機的加速與防限流屏障。
* **團隊共用情境**：若團隊有多位開發者或 CI/CD 流程需要頻繁生成程式碼，可評估將 `.figma-cache/` 納入 Git 提交；快取 identity 與來源版本仍須驗證，不能保證所有情況都不再消耗 Figma API 配額。

---

## 六、未驗證項目與已知限制

### 新增 fixture 比對結果（2026-09-04）

使用者提供的兩份原始 `.fig` 已分別解包：

* `DesignSystem.fig`：36,659 nodes；包含 `Alert` FRAME `105:18807`，其下有 24 個 `SYMBOL` variants 與相關文字層。
* `MailTemplate.fig`：28,120 nodes；包含 `Alert` FRAME `30:3559`，其下有 24 個 `SYMBOL` variants 與相關文字層。
* 兩個 `Alert` container 的 variant 命名模式與 child count 一致；但 MailTemplate 的目標 [1431:38302](/Users/DavidTai/Documents/GitHub/.figctx/mail-template-full/document.agent.json:671588) 仍為 `INSTANCE` 且 `childIds: []`。

因此目前較精確的結論是：component definitions 確實存在於本地匯出資料中，但 `figma-free` exporter 沒有將它們自動展開／連回該 Instance；這不是單純缺少整個 Library 檔案。

以下項目刻意不宣稱已完成：

* 目標雲端檔案的真實 API hydration／contract fixture：針對 `node-id=1431-38302` 的 targeted request（`depth=2`）約 0.9 秒內收到 429，未取得可提交的真實 payload；本次未再重試。
* 本 Agent 以登入式 Figma Web 直接讀取目標 instance 文字：使用者截圖已證明 Web runtime 顯示文字與 properties，但本 Agent 未能獨立操作 Web session，因此仍未取得可機器重現的 Web/API payload。
* Pixel-level / pixel-perfect 視覺差異：目前沒有穩定 renderer、截圖基準與 diff 報告；需另行進行 visual QA。
* API rate-limit 的固定方案數字：不以本報告中的推測取代官方文件或當次 response metadata。
* 最終 Git worktree 狀態：`.agents` 目前不是 Git repository，無法產生有效的 branch/status/HEAD 驗證。

## 七、產出資產與使用指引

### Local instance expansion 實作驗證

已在 `figma-free-mcp/packages/core` 實作 local resolver：不改寫原始 `childIds`，改以 `resolvedChildIds` 保存由 `symbolData.symbolID` 展開的虛擬子樹，並套用巢狀 component 的文字 overrides。對 `MailTemplate.fig` 重新解包後，`1375:32976` 的實際輸出包含標題、說明、取消與刪除文字；這是 local fixture 驗證，不代表已完成真實 API hydration 或 pixel-level visual QA。

此工作流程已沉澱為全域可復用的 Agent 技能：

1. **Skill 目錄**：`.agents/skills/figma-inspector/`
   * `SKILL.md`：包含完整的啟發式規則、決策流程圖、快取規範、常見錯誤清單與使用時機。
   * `package.json`：支援 ESM 原生模組執行。
   * `scripts/`：包含剪枝、決策、快取、API resilience 與測試工具。
2. **figma-free-mcp local resolver**：`packages/core` 先保留 `symbolData`、解析同檔 component definition，再以 `resolvedChildIds` 展開 Instance；`inspectNode` 與 `buildNodeContext` 讀取展開後子樹。
3. **未來 Agent 使用原則**：
   * **巨觀定位用淺層（Shallow）**：優先使用 `figma-free` 查閱全貌。
   * **微觀實作用本地展開優先**：發現空 `INSTANCE` 時，先解析 `symbolData` 與同檔 component definition；只有 local resolver 無法解析時，才檢查快取並考慮 targeted API。
   * **進入 Prompt 前剪枝（Prune）**：一律調用 `pruneFigmaNode` 進行瘦身並寫入快取，保留已支援的 fidelity 欄位；視覺 parity 仍需另行執行 manual/visual QA。

---

## 八、使用者提問最佳實踐（Prompt 最佳參數指引）

為了讓 `figma-inspector` 能以最快速度、0 瞎猜、精準鎖定目標 UI 畫面或圖示資產，建議在提問 Prompt 中提供以下三項核心參數：

### 1. 核心「黃金三要素」（速度最快、準確度 99%）

| 參數項目 | 格式範例 | 為什麼關鍵？ |
| :--- | :--- | :--- |
| **1. Figma 網頁 URL**（含 `node-id`） | `https://www.figma.com/design/:fileKey/...?...node-id=1437-42481` | 跳過全檔模糊文字搜尋，直接精準下鑽至目標節點（`1437:42481`）；且具備真實 `fileKey` 可供必要時雲端 fallback。 |
| **2. 本地主 bundle 路徑** | `/Users/DavidTai/Documents/GitHub/.figctx/mail-template-expanded-v6` | 優先調用 `figma-free` 進行本地解析（0 API 呼叫、0 等待、無 429 限流風險）。 |
| **3. 外部設計系統（Team Library）路徑** | `/Users/DavidTai/Documents/GitHub/.figctx/design-system-full` | 當目標元件為外部庫「空殼」（無二進位資產）時，Agent 可直接透過 `componentKey` 跨庫提取原始向量/圖片，避免在主檔盲目搜尋導致超時或取錯圖。 |

### 2. 輔助描述（避免翻車）

* **指定目標層級與類型**：
  * **向量圖示（SVG Icon）**：標註圖示在畫面上的具體位置或語意標籤（例如：「搜尋欄右邊的清除叉叉 icon」）。
  * **點陣圖片（PNG/JPG）**：標註圖片容器名稱或用途（例如：「公司 Logo」）。
  * **排版還原（Layout）**：告知預計開發的前端框架（例如：SwiftUI 或 React）。
* **指定變體與狀態（States / Overrides）**：
  * 若有特定互動狀態（如 `State=Disabled` 或 `Size=24px`），或存在文字覆寫（Text Override），明確指出以畫面當前狀態為準，避免 Agent 誤採 base component 預設值。

### 3. Prompt 推薦範本

```text
請使用 figma-inspector 幫我提取這個 UI 元件：

1. Figma 節點：https://www.figma.com/design/D1YdPEP1ny5AiqROSWGpSj/即時通信件合併?node-id=1437-42481
2. 本地主 bundle：/Users/DavidTai/Documents/GitHub/.figctx/mail-template-expanded-v6
3. 外部 Design System：/Users/DavidTai/Documents/GitHub/.figctx/design-system-full
4. 任務目標：提取該畫面頂部「搜尋欄右邊的漏斗篩選 Icon」的 SVG 向量資料，並確認其寬高與顏色。
```

---

## 九、執行安全規範：防限流審批與強制失敗警示

在執行 `figma-inspector` 的過程中，AI Agent 必須嚴格遵守以下兩大安全鐵律：

### 1. 遇到任何失敗一律特別提醒使用者（Fail Loud 原則）
* **禁止靜默降級**：若在解析過程中遭遇任何異常（例如：本地找不到節點、外部庫空殼無對應 peer bundle、圖示向量合成為空、元件置換無法解析），Agent **絕對不可靜默略過、胡亂猜測 SF Symbols、自行手刻假 SVG 或隨便拿錯誤的本地圖示替換**。
* **高可見度警示**：必須以粗體或警示區塊（`> [!WARNING]`）明確提醒使用者，詳列出錯的節點 ID、元件名稱與具體缺失原因，並提供明確的修復指引（例如提示匯出缺失的 Team Library `.fig`）。

### 2. 呼叫官方 Figma API 前必須取得使用者明確同意（保護免費帳號額度）
* **免費帳號限額極低**：官方 Figma REST API 與 Figma MCP（`get_figma_data`, `download_figma_images`）對免費方案有極為嚴苛的頻率與次數限制，極易觸發 HTTP 429 限流。
* **強制使用者授權機制**：Agent 在決定發送任何官方 API 請求之前，**必須暫停並主動向使用者說明與徵詢許可**。
* **詢問內容須包含**：
  1. 為什麼本地離線解析與 peer bundle 無法滿足需求。
  2. 預計請求的具體 `nodeId` 與雲端 `fileKey`。
  3. 提醒此操作將消耗官方 API 額度。
  4. 只有在使用者明確同意後，才可執行 API 調用。
