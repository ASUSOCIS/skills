# claude-bridge — Claude Code → MyCoder 零複製橋接

一個檔案搞定遷移。把 `claude-bridge.ts` 放進 `~\.mycoder\plugin\`,重啟後 MyCoder 會自動沿用你現有的 Claude Code 設定,**不複製、不改寫任何設定檔**。

## 它做什麼

Plugin 在 MyCoder 啟動時自動執行,涵蓋四個部分:

| 項目 | 來源(Claude Code) | 處理方式 |
|---|---|---|
| MCP | `~\.claude.json`(user / local)+ 專案 `.mcp.json` | 啟動時注入記憶體,`/mcps` 直接可見 |
| Rules | 專案 `.claude\rules\*.md` | 注入讀取路徑,每次啟動讀原始檔 |
| Commands | 專案與全域 `.claude\commands\` | 逐檔 hardlink 到 `.mycoder\commands\` |
| Skills / CLAUDE.md | `~\.claude\skills\`、CLAUDE.md | MyCoder 原生支援,不需處理(見下方設定) |

設計原則:

- **零複製**:不寫 `mycoder.json`、不生成 `AGENTS.md`,真相源永遠是 Claude 側原始檔,不會有副本漂移
- **冪等**:重啟幾次都安全,已存在的東西不會被覆蓋或重複建立
- **單向**:在 MyCoder 側新增/刪除 command 不會影響 Claude 側;被橋接的檔案內容編輯則兩邊同步
- **不破壞既有設定**:`.mycoder\commands` 若已有你自己的 commands,只補缺、同名時以你的為準

## 安裝步驟

1. **確認 Extension 版本**:需要新版 MyCoder extension(`twsc.afs-mycoder` 3.1.6 以上)。
2. 複製 `claude-bridge.ts` 到 `~\.mycoder\plugin\`(目錄不存在請自行建立)
3. 在 MyCoder Settings → **Agent Behaviour** → Rules → **「載入 Claude Code 檔案」**(Claude Code Compatibility)開啟——這個才會載入 CLAUDE.md 和 Claude skills
4. 按 Settings 右上角的 **Reload** 按鈕(不用重開 VS Code)

> 沒開第 3 步的開關:MCP / Rules / Commands 仍會運作,但 CLAUDE.md 與 Claude skills 不會載入。

## 安裝後怎麼驗證

驗證 1. MyCoder Settings -> Agent Behaviour 可選MCPS Servers/Rules/Workflows/Skills 確認Claude資源已經Migrate
驗證 2. 開新的Session可以在agent chat裡面去確認
- 開新 session,問 AI:「列出你 context 中的 instructions」——應看到 `.claude\rules\` 的檔案
- `/mcps`:應看到 Claude 側設定的 MCP servers
- `/` 選單:應看到 `.claude\commands\` 的 commands

## 常見問題

**Q:Claude 側新增了 command / MCP server,MyCoder 沒出現?**
MyCoder 不會監看 Claude 的設定檔。按 MyCoder Settings 右上角的 **Reload** 按鈕即可,橋接會重新執行並補上新的項目(已實測,不需重開 VS Code)。

**Q:`/` 選單看不到新 command,但 Reload 過了?**
選單有快取。再按一次 Settings 右上角的 **Reload**,或開新的 session。

**Q:專案裡出現了 `AGENTS.md`?**
那不是這個 plugin 產生的(它從不生成 AGENTS.md)。請刪除——MyCoder 讀取順序是 AGENTS.md > CLAUDE.md,留著會蓋掉 CLAUDE.md 的即時更新。

**Q:如何停用?**
刪除 `~\.mycoder\plugin\claude-bridge.ts` 即可,不會留下任何設定殘留(hardlink 檔案可自行刪除,不影響 Claude 側)。
