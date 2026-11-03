# claude-bridge — Claude Code → MyCoder 零複製橋接

一個檔案搞定遷移。把 `claude-bridge.ts` 放進 `~\.mycoder\plugin\`,重啟後 MyCoder 會自動沿用你現有的 Claude Code 設定,**不複製、不改寫任何設定檔**。

## 它做什麼

Plugin 在 MyCoder 啟動時自動執行,涵蓋四個部分:

| 項目 | 來源(Claude Code) | 處理方式 |
|---|---|---|
| MCP | `~\.claude.json`(user / local)+ 專案 `.mcp.json` | 啟動時注入,Settings / `/mcps` 直接可見 |
| Rules | 全域與專案 `.claude\rules\**\*.md`(含子目錄) | 注入讀取路徑,每次啟動讀原始檔(path-scoped 限制見「已知限制」) |
| Commands | 專案與全域 `.claude\commands\` | 建立實體 `.mycoder\commands` 目錄,逐檔 hardlink(Windows `mklink /H`);每次啟動重跑,只補缺漏檔案 |
| Skills / CLAUDE.md | `~\.claude\skills\`、CLAUDE.md | MyCoder 原生支援,不需處理(見下方開關說明) |

設計原則:

- **零複製**:不寫 `mycoder.json`、不生成 `AGENTS.md`,真相源永遠是 Claude 側原始檔,不會有副本漂移
- **冪等**:重啟幾次都安全,已存在的東西不會被覆蓋或重複建立
- **單向**:在 MyCoder 側新增/刪除 command 不會影響 Claude 側;hardlink 共用同一份內容,任何一側編輯檔案內容兩邊同步(但 Claude 側刪除檔案時,MyCoder 側的連結檔會保留,需自行清理)
- **不破壞既有設定**:`mycoder.json` 已有的 MCP 同名設定以你的為準;commands 同名檔以 MyCoder 側既有檔案為準,只 hardlink 缺少的;舊版 plugin 留下的 commands junction 會自動轉換為實體目錄,非本 plugin 建立的外部連結則不碰

## Mycoder Extension 指南(VS Code)

### 安裝

1. **確認 Extension 版本**:需要新版 MyCoder extension(`twsc.afs-mycoder` 3.1.6 以上)。
2. 複製 `claude-bridge.ts` 到 `~\.mycoder\plugin\`(目錄不存在請自行建立)。
3. 在 MyCoder Settings → **Agent Behaviour** → Rules → **「載入 Claude Code 檔案」**(Claude Code Compatibility)開啟——這個開關只負責 CLAUDE.md 和 Claude skills,與 MCP / Rules / Commands 無關。
4. **完全關閉 VS Code 後重新開啟**(確保 plugin 的 TS 檔被載入;單按 Reload 不會重新載入 plugin 程式碼)。
5. 開啟後檢查 `/` 選單:若新 command **沒出現,再按一次 Settings 右上角的 Reload** 比較快(開新 session 也會生效,但要等一陣子)——commands 清單在啟動早期載入,plugin 建 hardlink 在其之後,首次安裝/新增檔案時清單需重掃一次(見「注意事項 → Commands 延遲生效」)。

> 沒開第 3 步的開關:MCP / Rules / Commands 仍會運作,但 CLAUDE.md 與 Claude skills 不會載入。
> (CLI / TUI 沒有這個問題——終端機啟動時原生 Claude Code 支援預設是開的。)

### 驗證

1. Settings → Agent Behaviour 分別切 **MCP Servers / Rules / Workflows / Skills** 分頁,確認 Claude 側資源已出現。
2. 開新 session 在 chat 裡確認:
   - 問 AI:「列出你 context 中的 instructions」——應看到 `.claude\rules\` 的檔案
   - MCP Servers 分頁:應看到 Claude 側設定的 MCP servers,狀態 connected
   - `/` 選單:應看到 `.claude\commands\` 的 commands(見下方「Commands 延遲生效」)

### 注意事項

- **Commands 延遲生效**:commands 清單在啟動流程的早期就載入完畢,而 plugin 的逐檔 hardlink merge 執行在較晚的階段。所以**第一次 Reload 後新 command 還不會出現,再按一次 Reload(或開新 session)才會生效**。尤其**完全重開 VS Code 的第一次啟動也一樣**:plugin 雖已在啟動時把 hardlink 建好,但 `/` 清單載入在其之前,仍需再按一次 Reload 才會出現(僅「檔案在啟動前就已存在於 `.mycoder\commands\`」時可免)。另注意 Reload 不會重新載入 plugin 的 TS 檔本身——修改 `claude-bridge.ts` 後必須完全重開 VS Code 才會執行新版程式碼。
- **Settings 清單裡的幽靈條目**:plugin 注入的 MCP / rules 會出現在 Settings 的 MCP Servers / Rules 清單中,看起來像一般條目但**不是存在 mycoder.json 裡的設定**——刪掉它,下次啟動又會回來。這些條目請勿編輯;真正的設定以 Claude 側檔案為準。
- **console 快閃(Windows)**:hardlink / junction 操作已以隱藏視窗模式執行(`windowsHide`),不會再出現黑色 cmd 視窗。
- **刪除不反向同步**:Claude 側刪除 command 後,MyCoder 側已 hardlink 的檔案會留下(孤兒檔),請自行刪除;此外 Windows 部分編輯器以「先寫暫存檔再取代」方式存檔,可能切斷 hardlink 共用關係,屆時兩側內容各自獨立。

## Mycoder CLI 指南(TUI)

### 安裝

1. 複製 `claude-bridge.ts` 到 `~\.mycoder\plugin\`(目錄不存在請自行建立)。
2. 重啟 `mycoder`(或 TUI)。CLI 原生支援 CLAUDE.md 與 skills 預設開啟,沒有額外開關。

### 驗證

| 方式 | 指令 / 操作 | 應看到 |
|---|---|---|
| MCP 清單 | `mycoder mcp` | Claude 側設定的 MCP servers |
| MCP 對話框 | TUI 內輸入 `/mcps` | 同上,可按 space toggle 啟停 |
| Rules | 問 agent「列出你 context 中的 instructions」 | `.claude\rules\` 檔案 |
| Commands | TUI 輸入 `/` | `.claude\commands\` 的 commands(首次需再重啟一次,同 Extension 注意事項) |
| 設定來源 | `mycoder debug config` | `mcp`、`instructions` 欄位含橋接項目(僅顯示宣告,不展開 glob) |

### 注意事項

- Claude 側設定有變更時,重啟 `mycoder` 才會同步(bridge 只在啟動時執行)。

## 一次性遷移腳本(選用)

除了常駐橋接,同一個檔案也能當獨立遷移腳本,把設定**實際寫入** mycoder 設定檔(適合想一次性切斷、不想常駐 plugin 的使用者):

```powershell
bun claude-bridge.ts                # 遷移目前目錄的專案
bun claude-bridge.ts <projectPath>  # 遷移指定專案
```

行為:MCP 寫入 `~\.mycoder\mycoder.json` 與專案 `.mycoder\mycoder.json`、CLAUDE.md 的 `@import` 與 `.claude\rules\` 併入 `AGENTS.md`、commands 複製到 `.mycoder\commands\`(保留 description/model)、skills 僅檢查格式。會輸出逐項報表,重跑一次全部顯示「跳過(已存在)」。**此模式會寫檔,請先用測試專案演練**;與 plugin 模式擇一即可。

## 常見問題

**Q:Claude 側新增了 command / MCP server,MyCoder 沒出現?**
MyCoder 不會監看 Claude 的設定檔。按 MyCoder Settings 右上角的 **Reload**(Extension)或重啟 `mycoder`(CLI)即可,橋接會重新執行並補上新的項目。Commands 另需再下一次啟動才生效。

**Q:`/` 選單看不到新 command,但 Reload 過了?**
選單有快取。再按一次 **Reload** 或開新的 session。

**Q:Settings 裡刪不掉 plugin 注入的 MCP / rules 條目?**
那是注入的即時項目,不是 mycoder.json 的內容。要調整請改 Claude 側的來源檔,或停用 plugin。

**Q:專案裡出現了 `AGENTS.md`?**
那不是這個 plugin 產生的(它從不生成 AGENTS.md;一次性腳本模式才會)。請確認是否跑過腳本模式,或自行刪除——MyCoder 讀取順序是 AGENTS.md > CLAUDE.md,留著會蓋掉 CLAUDE.md 的即時更新。

**Q:如何停用?**
刪除 `~\.mycoder\plugin\claude-bridge.ts` 即可。已 hardlink 進 `~\.mycoder\commands\` 的檔案不會自動移除(它們是實體目錄中的連結檔,刪除不影響 Claude 側),不需要的話可整個目錄刪掉: `Remove-Item -Recurse "$env:USERPROFILE\.mycoder\commands"`。

## 已知限制

Rules 相關(對照 Claude Code 官方文件,code.claude.com/docs/en/memory):

- ~~全域 rules 未橋接~~ / ~~rules 不遞迴~~:**已修復**——專案側注入 `.claude\rules\**\*.md` 遞迴 glob;全域側因 mycoder 的 instruction loader 會把絕對路徑拆成「檔名 + 目錄」再 glob(遞迴萬用字元在絕對路徑中無效),改為 plugin 啟動時遞迴走訪 `~\.claude\rules\`、逐檔注入具體 `~/` 路徑,與專案規則一併載入。
- **path-scoped rules 語意變更**:Claude Code 對沒有 `paths:` frontmatter 的規則是每次 session 啟動載入(與本 plugin 行為一致,**無落差**);但有 `paths:` frontmatter 的規則在 Claude Code 是「Claude 讀寫到匹配檔案時才載入」的按需載入,橋接後會變成**每次 session 無條件常駐載入**。後果:(1) 這類規則平白多佔每次對話的 context;(2) 生效範圍從「特定檔案」擴大到「所有任務」。本 plugin 無法重現按需語意(mycoder 的 instructions 機制不支援按檔案條件載入),使用 `paths:` 規則的人請知悉此差異。

其他:

- **專案層級 settings 檔的角色**:Claude Code 的專案設定分兩層——`.claude\settings.json` 給團隊共用(提交到 git)、`.claude\settings.local.json` 是個人設定(不提交,Claude Code 會自動加入 .gitignore),衝突時後者覆蓋前者。本 plugin 只從這兩個檔讀取 `disabledMcpjsonServers`(MCP 停用清單);其中的 permissions / hooks / env 等其他設定一律不遷移。
- **停用清單會被尊重**:`disabledMcpServers`(`~\.claude.json` 的專案 entry;在 Claude Code 用 `/mcp` 停用 server 時就寫在這裡)命中的 server **不分 scope 都不會被橋接**(user / local / project 一體適用,與 Claude Code 的停用語義一致);`disabledMcpjsonServers`(`.claude\settings.json` / `.claude\settings.local.json`)則只 gate `.mcp.json` 內定義的 server。企業政策 / 組織層級封鎖未檢查。

  ```
  Claude 側 MCP 來源                 檢查的停用清單                      結果
  ───────────────────────────────  ────────────────────────────────  ──────────────
  user    ~/.claude.json 頂層   ──→ disabledMcpServers            ──→ 命中 → 跳過
  local   ~/.claude.json        ──→   (~\.claude.json 專案 entry,     │
          projects[<路徑>]           /mcp 停用時寫入)                 └→ 通過 → 橋接 ✅
  project .mcp.json            ──→ disabledMcpServers            ──→ 命中 → 跳過
                               ──→ + disabledMcpjsonServers          │
                                   (settings.json /                  └→ 通過 → 橋接 ✅
                                    settings.local.json)
  ```

  專案層級 settings 檔的角色:

  | 檔案 | 用途 | 版控 | 優先序 |
  |---|---|---|---|
  | `.claude\settings.json` | 團隊共用的專案設定 | 提交到 git | 較低 |
  | `.claude\settings.local.json` | 個人設定(自動加進 .gitignore)| 不提交 | 較高,衝突時覆蓋上面 |

  > bridge 只從這兩個檔讀 `disabledMcpjsonServers`;裡面的 permissions / hooks / env 一律不遷移。
- **`.claude\agents\`(subagents)未涵蓋**:原生與 plugin 皆未支援。
