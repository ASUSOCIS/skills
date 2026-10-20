---
name: migrate-claude-to-mycoder
description: Migrate MCP servers, verify skills, generate AGENTS.md (rules + @import), and migrate commands from Claude Code to mycoder. Use when the user asks to migrate, copy, move, or sync anything (skills, MCP, rules, commands, config) from Claude Code to mycoder, mentions "搬移 skill", "遷移 skill", "claude skills 不見", or reports a Claude skill or MCP server not appearing in mycoder. Converts Claude Code MCP config (mcpServers to mcp, env to environment) and writes to the matching mycoder config; skills auto-load so only cloud-sync and format checks are needed; generates a mycoder-ready AGENTS.md from CLAUDE.md + .claude/rules/ (strips @imports, filters stale rules) without touching original files.
---

# Migrate Claude Code to mycoder (MCP + skills + rules + commands)

Four parts, very different effort:

1. **MCP servers — the actual migration work.** Convert Claude Code MCP config
   format and write it into the matching mycoder.json. Always run this.
2. **Skills — verification only, no migration.** mycoder auto-scans
   `~/.claude/skills` and project `.claude/skills/` (same SKILL.md format),
   so skills need no copying. Only check cloud-sync status and format. Keep
   this part brief — do not produce a long inventory report.
3. **Rules + @import — generate AGENTS.md.** mycoder does not support
   `.claude/rules/` or the `@import` syntax. Generate a mycoder-ready
   `AGENTS.md` (CLAUDE.md content minus @imports, plus rules content,
   filtered) without touching the original Claude Code files.
4. **Commands — copy + strip frontmatter.** mycoder supports commands
   (`.mycoder/command(s)/` project + global, same `` format).
   Copy files and strip Claude-specific frontmatter (`allowed-tools` etc.)
   — those fields break mycoder startup if left in.

## Part A — MCP servers (do this first)

### A1. Read Claude Code MCP config sources

- `~/.claude.json` top-level `mcpServers` (user scope)
- `~/.claude.json` `projects[path].mcpServers` (local scope, per project)
- `<project>/.mcp.json` (project scope)

### A2. Filter

- Skip entries whose name starts with `plugin:` or `claude.ai` (cloud
  connectors / plugin-delivered — not in these files anyway). Report them as
  not migratable; they must be re-set up in mycoder directly.
- **local scope needs no separate migration**: mycoder's project config lives
  in the project directory, same effect as Claude's project scope. local and
  project would collide on the same name in the same file — migrate only one
  (prefer the project-scope copy; it is committable to the team). Report local
  entries as skipped for this reason.

### A3. Convert each entry

- `mcpServers` key becomes `mcp` key
- stdio `command: "npx"` + `args: [...]` becomes merged array
  `command: ["npx", ...args]` with `type: "local"`
- `env: {...}` becomes `environment: {...}`
- `type: "http"` or `"sse"` + `url` becomes `type: "remote"` + `url`
- `headers` stays `headers` (supports `{env:VAR}` interpolation)

### A4. Write to the mycoder config

- user scope goes to `~/.mycoder/mycoder.json` under `mcp`
- project scope goes to `<project>/.mycoder/mycoder.json` under `mcp`
- Preserve existing `mcp` entries; merge by server name, ask on conflict.
- mycoder validates config strictly — keep `` and all existing fields
  intact; a wrong shape breaks startup. Write clean JSON (2-space indent).

### A5. Verify

- Run `mycoder debug config` and confirm the migrated servers appear in the
  resolved `mcp` section.
- Tell the user to restart mycoder, then check `/mcps` shows the servers
  connected and a tool call works.

## Part B — Skills (brief verification only)

Skills auto-load in mycoder (external scan of `~/.claude/skills` and project
`.claude/skills/`; same format). No copying. Only:

1. **Cloud-sync check** (the one real failure mode): read every
   `~/.claude/skills/synced/*/manifest.json`. If `skills: []` with entries
   in `pendingClaims`, those cloud skills are NOT downloaded — mycoder cannot
   see them. Fix: download from `https://claude.ai/customize/skills` (web UI),
   unzip, place each skill folder into `~/.mycoder/skills/<name>/`; or open
   Claude Code and let it finish syncing.
2. **Quick format check**: every SKILL.md needs `name` (lowercase-hyphen,
   matches folder) and `description` (missing = silently filtered). Only
   report violations; do not dump a full inventory.
3. **Copy only when the external scan is disabled**: if
   `MYCODER_DISABLE_CLAUDE_CODE_SKILLS=1` or
   `MYCODER_DISABLE_EXTERNAL_SKILLS=1` is set, copy the entire skill folder
   (scripts/assets included) to the matching mycoder location. Otherwise skip.



## Part C — Rules (.claude/rules/) + @import — generate AGENTS.md

Claude Code supports modular instruction files in ``.claude/rules/*.md``
(recursive, subdirs included). They STACK with CLAUDE.md: rules without
``paths`` frontmatter load every session; rules with ``paths`` frontmatter
load only when Claude touches matching files. CLAUDE.md can also reference
files with ``@path`` import syntax (expanded at launch).

**mycoder does NOT support** the rules/ directory auto-scan or the @import
syntax — instruction loading only reads AGENTS.md / CLAUDE.md / CONTEXT.md
+ ``instructions`` config.

**Migration strategy: generate a mycoder-ready AGENTS.md.**

Do NOT modify the original CLAUDE.md or the rule files — leave all Claude
Code files untouched. Instead, GENERATE a new ``AGENTS.md`` in the project
root that mycoder can consume directly:

1. **Read** the project's CLAUDE.md (and CLAUDE.local.md if present).
2. **Strip @import lines** — remove every line that is an ``@path`` import
   (the referenced file contents are handled in step 3 instead). Do not
   delete the referenced files themselves and do not edit the original
   CLAUDE.md — the generated AGENTS.md is a separate new file.
3. **Append rules content** — read every ``.claude/rules/**/*.md`` and append
   each rule's content under a heading (``# Rules: <filename>``).
4. **Filter while appending**:
   - If a rule's ``paths`` frontmatter points to directories/files that no
     longer exist → skip it (dormant in Claude Code, orphan context in mycoder).
   - If the content is outdated → skip it.
   - Strip the ``paths`` frontmatter itself (meaningless in mycoder).
5. **Write** the result as ``AGENTS.md`` in the project root. If an AGENTS.md
   already exists, ask the user before overwriting (offer to merge instead).
6. **Report** to the user: "已幫你生成 AGENTS.md(包含 CLAUDE.md 內容,已移除
   @import 並併入 rules)——不需要再跑 /init。原始 CLAUDE.md 和 rules/ 檔案
   都沒有動。"

If the CLAUDE.md has no @import lines and there is no rules/ directory,
generating AGENTS.md is still the preferred output (a clean copy mycoder
reads natively). If an AGENTS.md already exists AND a CLAUDE.md also exists,
mycoder reads the AGENTS.md — ask the user whether to merge or keep as-is.

### C1. Inventory

Recursively list ``.claude/rules/**/*.md`` (project and ``~/.claude/rules/``),
and check the CLAUDE.md for ``@path`` import lines.

### C2. Filter before appending

Rules become ALWAYS-LOADED in mycoder (no paths conditional). For each rule:

- If the ``paths`` frontmatter points to directories/files that no longer
  exist → **skip** (dormant in Claude Code, would be orphan context in mycoder).
- If the content is outdated → **skip** (always-loaded stale instructions
  mislead every session).
- Otherwise → append to the generated AGENTS.md (strip the ``paths``
  frontmatter itself).

### C3. Report

Summarize: rules found, appended, skipped (and why); @import lines removed
(count); the generated AGENTS.md path.

## Part D — Commands (.claude/commands/) — copy + strip frontmatter

Claude Code supports custom slash commands in ``.claude/commands/*.md``
(project) and ``~/.claude/commands/*.md`` (global). **mycoder supports
commands too** — scans ``{command,commands}/**/*.md`` in both the project
``.mycoder/`` and global ``~/.mycoder/``. Format is nearly identical
(frontmatter + body, ``$ARGUMENTS`` / ``$1`` placeholder expansion).

**CRITICAL**: mycoder's command schema only accepts
template/description/agent/model/variant/subtask. Claude-specific
frontmatter fields (``allowed-tools``, ``argument-hint``,
``disable-model-invocation``) will make mycoder FAIL TO START (InvalidError)
— they must be stripped, not just ignored.

### D1. Inventory

List ``.claude/commands/**/*.md`` (project and ``~/.claude/commands/``).

### D2. Migrate

For each command file:

1. Copy to the matching mycoder location: project commands to
   ``<project>/.mycoder/commands/<name>.md``, global commands to
   ``~/.mycoder/commands/<name>.md``.
2. Strip Claude-specific frontmatter fields: ``allowed-tools``,
   ``argument-hint``, ``disable-model-invocation``. Keep ``description``
   (and ``model`` if present).
3. Keep the body unchanged (``$ARGUMENTS`` / ``$1`` placeholders work the same).
4. If ``allowed-tools`` carried a real tool restriction, note it to the user —
   the mycoder equivalent is the ``permission`` config, or write the
   restriction into the command body text.

### D3. Report

Summarize: commands found, migrated (project/global), frontmatter fields
stripped, any ``allowed-tools`` restrictions that need a permission-config
equivalent.
## Not migratable — hooks / plugins

Claude Code hooks (`hooks.json`, PreToolUse etc.) and plugins are Claude
Code-specific mechanisms — mycoder cannot read them. If the user asks to
migrate hooks or plugins, explain: they need reimplementation via the
mycoder plugin API (`@opencode-ai/plugin`, hook events like
`tool.execute.before` / `permission.ask`). Do not attempt to copy them.

## Final report — change summary table

After all parts complete, show the user ONE summary table of every change
made (or skipped), then ask for confirmation before anything is written if
writes have not happened yet.

**The rows are dynamic** — fill them from what the inventory actually found
(the real MCP servers, skills, rules, commands on this machine). The table
below is a FORMAT example only; do not copy its rows verbatim. Format:

| 項目 | 來源(Claude Code) | 動作 | 目的地(mycoder) | 狀態 |
|---|---|---|---|---|
| MCP server | everything-global(user scope) | 轉換寫入 | ~/.mycoder/mycoder.json | ✅ 完成 |
| MCP server | everything-project(.mcp.json) | 轉換寫入 | <專案>/.mycoder/mycoder.json | ✅ 完成 |
| MCP server | everything(local scope) | 跳過 | —(local 不需轉移) | ⏭️ 略過 |
| Skill | webapp-testing(.claude/skills) | 無需遷移 | 自動載入 | ✅ 確認可用 |
| Skill | financial-news-brief(雲端) | 待同步 | —(pendingClaims 未下載) | ⚠️ 需處理 |
| Rule | code-style(.claude/rules) | 併入 AGENTS.md | AGENTS.md | ✅ 完成 |
| Rule | legacy-api(.claude/rules) | 丟棄 | —(目標目錄已不存在) | ⏭️ 略過 |
| Command | commit-draft(專案 .claude/commands) | 複製+剝 frontmatter | <專案>/.mycoder/commands/ | ✅ 完成 |
| Command | commit-draft(global ~/.claude/commands) | 複製+剝 frontmatter | ~/.mycoder/commands/ | ✅ 完成 |

Rules for the table:

- One row per item, grouped by category (MCP / Skill / Rule / Command).
- Only categories with actual findings get rows. If a category has nothing
  (e.g. no rules/ dir, no commands dir), do NOT add empty rows — instead add
  ONE brief line after the table, e.g. `Rules: none found` / `Commands: none found`,
- Status column: ✅ 完成 / ⏭️ 略過(含原因)/ ⚠️ 需處理(含下一步)/ ❌ 失敗(含錯誤)。
- Rows for items that need NO action (auto-loaded skills) still appear — the
  user should see the full picture, including "nothing needed" confirmations.
- End with the restart reminder (see below).

## Restart reminder

MCP config and skills load at startup only. End by telling the user to quit
and restart mycoder, then verify `/mcps` shows the servers connected.
