// ocis_change - claude bridge (dual-purpose: mycoder plugin + standalone migration script)
//
// As a PLUGIN (loaded by mycoder at startup):
//   Zero-copy bridge covering all four parts - MCP injection + rules glob
//   (instructions) + commands hardlink merge. Skills need nothing
//   (auto-scanned), AGENTS.md needs nothing (rules load via instructions,
//   CLAUDE.md natively). Always bridges while this file exists; disable =
//   delete this file.
//
// As a SCRIPT (run directly: `bun claude-bridge.ts [projectPath]`):
//   Performs the full one-time migration (MCP + skills check + rules/@import
//   -> AGENTS.md + commands) and prints a summary table. Zero LLM tokens.
//
// Install: copy to ~/.mycoder/plugin/ (global)
//
// Usage (script mode):
//   bun claude-bridge.ts                    # migrate for current directory
//   bun claude-bridge.ts <projectPath>      # migrate for a specific project

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { execSync } from "child_process"
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, realpathSync, lstatSync, rmSync } from "fs"
import os from "os"
import path from "path"

// ─── shared helpers ─────────────────────────────────────────────────────────

type ClaudeMcpServer = {
  type?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
}

type ClaudeConfig = {
  mcpServers?: Record<string, ClaudeMcpServer>
  projects?: Record<string, { mcpServers?: Record<string, ClaudeMcpServer> }>
}

function claudeJsonPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR ?? os.homedir()
  return path.join(dir, ".claude.json")
}

function normalizePath(p: string): string {
  return p.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase()
}

function convertServer(srv: ClaudeMcpServer): Record<string, unknown> | undefined {
  if (srv.enabled === false) return undefined
  if (srv.type === "http" || srv.type === "sse") {
    if (!srv.url) return undefined
    const out: Record<string, unknown> = { type: "remote", url: srv.url }
    if (srv.headers && Object.keys(srv.headers).length > 0) out.headers = srv.headers
    return out
  }
  if (!srv.command) return undefined
  const out: Record<string, unknown> = {
    type: "local",
    command: [srv.command, ...(srv.args ?? [])],
  }
  if (srv.env && Object.keys(srv.env).length > 0) out.environment = srv.env
  return out
}

function readClaudeConfig(): ClaudeConfig | undefined {
  const p = claudeJsonPath()
  if (!existsSync(p)) return undefined
  try {
    // strip BOM if present (PowerShell utf8 writes include it)
    return JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""))
  } catch {
    return undefined
  }
}

function readProjectMcpJson(directory: string): Record<string, ClaudeMcpServer> | undefined {
  const p = path.join(directory, ".mcp.json")
  if (!existsSync(p)) return undefined
  try {
    // strip BOM if present (PowerShell utf8 writes include it)
    return (JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, "") as string) as any).mcpServers
  } catch {
    return undefined
  }
}

function readJsonSafe(p: string): any | undefined {
  if (!existsSync(p)) return undefined
  try {
    return JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""))
  } catch {
    return undefined
  }
}

function writeJsonSafe(p: string, data: any) {
  writeFileSync(p, JSON.stringify(data, null, 2), "utf8")
}

function stripClaudeFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { frontmatter: {}, body: content }
  const frontmatter: Record<string, string> = {}
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (kv) frontmatter[kv[1]] = kv[2]
  }
  return { frontmatter, body: m[2] }
}

// ─── plugin mode: zero-copy bridge (MCP + rules + commands) ─────────────────

export default async function ClaudeBridgePlugin({ directory }: { directory: string }) {
  return {
    config: async (cfg: Record<string, any>) => {
      // Part 3: Rules — zero-copy via instructions glob (no AGENTS.md generation)
      try {
        const rulesDir = path.join(directory, ".claude", "rules")
        if (existsSync(rulesDir)) {
          cfg.instructions ??= []
          const glob = ".claude/rules/*.md"
          if (!cfg.instructions.includes(glob)) {
            cfg.instructions.push(glob)
            console.log("[claude-bridge] rules glob added to instructions (zero-copy)")
          }
        }
      } catch (error) {
        console.log("[claude-bridge] rules bridge failed:", error instanceof Error ? error.message : String(error))
      }

      // Part 4: Commands — bridge (zero-copy, project + global)
      // Always a real .mycoder/commands dir + per-file hardlink merge;
      // mycoder-native files win on name collision. A junction left by an
      // older plugin version is converted to the real-dir layout on the fly.
      try {
        const pairs = [
          [path.join(directory, ".claude", "commands"), path.join(directory, ".mycoder", "commands")],
          [path.join(os.homedir(), ".claude", "commands"), path.join(os.homedir(), ".mycoder", "commands")],
        ] as const
        for (const [src, dst] of pairs) {
          if (!existsSync(src)) continue
          if (existsSync(dst)) {
            if (lstatSync(dst).isSymbolicLink()) {
              // junction/symlink: only touch it when it points at src (our own
              // previous layout); a foreign link is left alone
              try {
                if (normalizePath(realpathSync(dst)) !== normalizePath(realpathSync(src))) continue
              } catch {
                continue
              }
              if (process.platform === "win32") {
                execSync(`cmd /c rmdir "${dst}"`, { stdio: "ignore" })
              } else {
                rmSync(dst)
              }
            } else if (!statSync(dst).isDirectory()) {
              continue
            }
          }
          mkdirSync(dst, { recursive: true })
          let linked = 0
          for (const name of readdirSync(src)) {
            if (!name.endsWith(".md")) continue
            const dstFile = path.join(dst, name)
            if (existsSync(dstFile)) continue
            try {
              if (process.platform === "win32") {
                execSync(`cmd /c mklink /H "${dstFile}" "${path.join(src, name)}"`, { stdio: "ignore" })
              } else {
                execSync(`ln -s "${path.join(src, name)}" "${dstFile}"`, { stdio: "ignore" })
              }
              linked++
            } catch {}
          }
          if (linked > 0) {
            console.log(`[claude-bridge] commands: linked ${linked} file(s) into ${dst}`)
          }
        }
      } catch (error) {
        console.log("[claude-bridge] commands bridge failed:", error instanceof Error ? error.message : String(error))
      }

      // Part 1: MCP — zero-copy injection (user < local < project)
      try {
        const claude = readClaudeConfig()
        if (!claude) return
        cfg.mcp ??= {}

        // Collect sources in precedence order: user < local < project.
        const sources: Record<string, ClaudeMcpServer>[] = []
        if (claude.mcpServers) sources.push(claude.mcpServers)

        const claudeProjects = claude.projects ?? {}
        const workspaceKey = Object.keys(claudeProjects).find(
          (k) => normalizePath(k) === normalizePath(directory),
        )
        if (workspaceKey) {
          const local = claudeProjects[workspaceKey]?.mcpServers
          if (local) sources.push(local)
        }

        const projectServers = readProjectMcpJson(directory)
        if (projectServers) sources.push(projectServers)

        let injected = 0
        for (const source of sources) {
          for (const [name, srv] of Object.entries(source)) {
            // mycoder.json explicit config wins over bridge-injected servers
            if (cfg.mcp[name]) continue
            const converted = convertServer(srv)
            if (!converted) continue
            cfg.mcp[name] = converted
            injected++
          }
        }

        if (injected > 0) {
          console.log(`[claude-bridge] injected ${injected} MCP server(s) from Claude Code config`)
        }
      } catch (error) {
        // best-effort: bridge failure must not break startup
        console.log("[claude-bridge] failed:", error instanceof Error ? error.message : String(error))
      }
    },
  }
}

// ─── script mode: full one-time migration ───────────────────────────────────

type ReportRow = { category: string; source: string; action: string; target: string; status: string }

function migrateMcp(projectDir: string, rows: ReportRow[]) {
  const claude = readClaudeConfig()
  if (!claude) {
    rows.push({ category: "MCP", source: "~/.claude.json", action: "找不到", target: "—", status: "⏭️ 略過" })
    return
  }

  // user scope -> global mycoder.json
  const globalCfgPath = path.join(os.homedir(), ".mycoder", "mycoder.json")
  const globalCfg = readJsonSafe(globalCfgPath) ?? {}
  globalCfg.mcp ??= {}
  for (const [name, srv] of Object.entries(claude.mcpServers ?? {})) {
    if (globalCfg.mcp[name]) {
      rows.push({ category: "MCP", source: name + "(user)", action: "跳過", target: "—(已存在)", status: "⏭️ 略過" })
      continue
    }
    const converted = convertServer(srv)
    if (!converted) continue
    globalCfg.mcp[name] = converted
    rows.push({ category: "MCP", source: name + "(user scope)", action: "轉換寫入", target: "~/.mycoder/mycoder.json", status: "✅ 完成" })
  }
  writeJsonSafe(globalCfgPath, globalCfg)

  // local scope (workspace-matched) -> project mycoder.json
  const claudeProjects = claude.projects ?? {}
  const workspaceKey = Object.keys(claudeProjects).find(
    (k) => normalizePath(k) === normalizePath(projectDir),
  )
  if (workspaceKey) {
    const projectCfgPath = path.join(projectDir, ".mycoder", "mycoder.json")
    const projectCfg = readJsonSafe(projectCfgPath) ?? {}
    projectCfg.mcp ??= {}
    for (const [name, srv] of Object.entries(claudeProjects[workspaceKey]?.mcpServers ?? {})) {
      if (projectCfg.mcp[name]) {
        rows.push({ category: "MCP", source: name + "(local)", action: "跳過", target: "—(已存在)", status: "⏭️ 略過" })
        continue
      }
      const converted = convertServer(srv)
      if (!converted) continue
      projectCfg.mcp[name] = converted
      rows.push({ category: "MCP", source: name + "(local scope)", action: "轉換寫入", target: ".mycoder/mycoder.json", status: "✅ 完成" })
    }
    writeJsonSafe(projectCfgPath, projectCfg)
  }

  // project scope (.mcp.json) -> project mycoder.json
  const mcpJsonPath = path.join(projectDir, ".mcp.json")
  const projectServers = readProjectMcpJson(projectDir)
  if (projectServers) {
    const projectCfgPath = path.join(projectDir, ".mycoder", "mycoder.json")
    const projectCfg = readJsonSafe(projectCfgPath) ?? {}
    projectCfg.mcp ??= {}
    for (const [name, srv] of Object.entries(projectServers)) {
      if (projectCfg.mcp[name]) {
        rows.push({ category: "MCP", source: name + "(project)", action: "跳過", target: "—(已存在)", status: "⏭️ 略過" })
        continue
      }
      const converted = convertServer(srv)
      if (!converted) continue
      projectCfg.mcp[name] = converted
      rows.push({ category: "MCP", source: name + "(project scope)", action: "轉換寫入", target: ".mycoder/mycoder.json", status: "✅ 完成" })
    }
    writeJsonSafe(projectCfgPath, projectCfg)
  }
}

function checkSkills(projectDir: string, rows: ReportRow[]) {
  const skillsDirs = [
    path.join(os.homedir(), ".claude", "skills"),
    path.join(projectDir, ".claude", "skills"),
  ]
  for (const dir of skillsDirs) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const skillMd = path.join(dir, name, "SKILL.md")
      if (!existsSync(skillMd)) continue
      const { frontmatter } = stripClaudeFrontmatter(readFileSync(skillMd, "utf8"))
      if (!frontmatter.description) {
        rows.push({ category: "Skill", source: name, action: "格式問題", target: "—(缺 description)", status: "⚠️ 需處理" })
      } else {
        rows.push({ category: "Skill", source: name, action: "無需遷移", target: "自動載入", status: "✅ 確認可用" })
      }
    }
  }

  // cloud-sync check
  const syncedDir = path.join(os.homedir(), ".claude", "skills", "synced")
  if (existsSync(syncedDir)) {
    for (const bucket of readdirSync(syncedDir)) {
      const manifest = path.join(syncedDir, bucket, "manifest.json")
      if (!existsSync(manifest)) continue
      try {
        const m = JSON.parse(readFileSync(manifest, "utf8"))
        const pending = (m.pendingClaims ?? []).map((c: string) => c.split("/").pop())
        for (const name of pending) {
          rows.push({ category: "Skill", source: name + "(雲端)", action: "待同步", target: "—(pendingClaims 未下載)", status: "⚠️ 需處理" })
        }
      } catch {}
    }
  }
}

function migrateRulesAndImports(projectDir: string, rows: ReportRow[]) {
  const claudeMdPath = path.join(projectDir, "CLAUDE.md")
  const agentsMdPath = path.join(projectDir, "AGENTS.md")
  const rulesDir = path.join(projectDir, ".claude", "rules")

  if (!existsSync(claudeMdPath) && !existsSync(rulesDir)) {
    rows.push({ category: "Rules/@import", source: "—", action: "無", target: "—(無 CLAUDE.md 和 rules)", status: "⏭️ 略過" })
    return
  }

  let content = ""
  let importCount = 0

  if (existsSync(claudeMdPath)) {
    const raw = readFileSync(claudeMdPath, "utf8")
    const lines = raw.split("\n")
    const kept = lines.filter((line) => {
      if (line.trimStart().startsWith("@")) {
        importCount++
        return false
      }
      return true
    })
    content = kept.join("\n")
    if (importCount > 0) {
      rows.push({ category: "@import", source: "CLAUDE.md 內 " + importCount + " 行", action: "移除", target: "AGENTS.md(不含 @import)", status: "✅ 完成" })
    }
  }

  let rulesAppended = 0
  let rulesSkipped = 0
  if (existsSync(rulesDir)) {
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const full = path.join(d, name)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!name.endsWith(".md")) continue
        const { frontmatter, body } = stripClaudeFrontmatter(readFileSync(full, "utf8"))
        // deterministic filter: paths targets must exist
        if (frontmatter.paths) {
          const globs = frontmatter.paths.split("\n").map((l: string) => l.trim()).filter(Boolean)
          const anyExists = globs.some((g: string) => {
            const clean = g.replace(/^["']|["']$/g, "")
            const base = clean.replace(/\*\*.*$/, "").replace(/\*.*$/, "")
            return base === "" || existsSync(path.join(projectDir, base))
          })
          if (!anyExists) {
            rulesSkipped++
            rows.push({ category: "Rule", source: name, action: "丟棄", target: "—(目標路徑不存在)", status: "⏭️ 略過" })
            return
          }
        }
        content += `\n\n# Rules: ${name}\n\n${body}`
        rulesAppended++
        rows.push({ category: "Rule", source: name, action: "併入 AGENTS.md", target: "AGENTS.md", status: "✅ 完成" })
      }
    }
    walk(rulesDir)
  }

  if (existsSync(agentsMdPath)) {
    writeFileSync(agentsMdPath + ".generated", content, "utf8")
    rows.push({ category: "AGENTS.md", source: "已存在", action: "寫入 .generated 檔(確認後覆蓋)", target: agentsMdPath + ".generated", status: "⚠️ 需確認" })
  } else {
    writeFileSync(agentsMdPath, content, "utf8")
    rows.push({ category: "AGENTS.md", source: "CLAUDE.md + rules", action: "生成", target: agentsMdPath, status: "✅ 完成" })
  }
}

function migrateCommands(projectDir: string, rows: ReportRow[]) {
  const mycoderCmdDir = path.join(projectDir, ".mycoder", "commands")
  mkdirSync(mycoderCmdDir, { recursive: true })

  const sources = [
    ["專案", path.join(projectDir, ".claude", "commands"), mycoderCmdDir],
    ["全域", path.join(os.homedir(), ".claude", "commands"), path.join(os.homedir(), ".mycoder", "commands")],
  ] as const

  for (const [source, cmdDir, targetDir] of sources) {
    if (!existsSync(cmdDir)) continue
    mkdirSync(targetDir, { recursive: true })
    for (const name of readdirSync(cmdDir)) {
      if (!name.endsWith(".md")) continue
      const { frontmatter, body } = stripClaudeFrontmatter(readFileSync(path.join(cmdDir, name), "utf8"))
      const kept = Object.entries(frontmatter)
        .filter(([k]) => ["description", "model"].includes(k))
        .map(([k, v]) => `${k}: ${v}`)
      const out = ["---", ...kept, "---", "", body].join("\n")
      writeFileSync(path.join(targetDir, name), out, "utf8")
      rows.push({ category: "Command", source: name + `(${source})`, action: "複製+剝 frontmatter", target: targetDir, status: "✅ 完成" })
    }
  }
}

function runMigration(projectDir: string) {
  const rows: ReportRow[] = []

  migrateMcp(projectDir, rows)
  checkSkills(projectDir, rows)
  migrateRulesAndImports(projectDir, rows)
  migrateCommands(projectDir, rows)

  console.log("\n═══ Migration Summary ═══\n")
  console.log("| 項目 | 來源 | 動作 | 目的地 | 狀態 |")
  console.log("|---|---|---|---|---|")
  for (const row of rows) {
    console.log(`| ${row.category} | ${row.source} | ${row.action} | ${row.target} | ${row.status} |`)
  }
  console.log("\n完成。重啟 mycoder 後生效。")
}

// ─── entry point ────────────────────────────────────────────────────────────

function isMain(): boolean {
  return (import.meta as any).main === true
}

if (isMain()) {
  const projectDir = path.resolve(process.argv[2] ?? process.cwd())
  console.log(`[claude-bridge] migrating Claude Code -> mycoder (project: ${projectDir})`)
  runMigration(projectDir)
}