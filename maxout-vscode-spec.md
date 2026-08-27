# Maxout for VS Code — Technical Specification

**Status:** Draft v0.1
**Owner:** miiidev
**Repo under spec:** [github.com/miiidev/maxout](https://github.com/miiidev/maxout)

---

## 1. Overview

Maxout is a local, OpenAI-compatible proxy (`maxout serve`, Fastify, Node ≥20)
that pools free-tier LLMs across OpenRouter, Groq, Google AI Studio, Mistral,
and Cerebras behind stable aliases (`auto/coding`, `auto/fast`, `auto/any`),
with automatic rate-limit failover and quota-aware routing. Today it's
operated entirely through a CLI (`maxout serve|status|setup|trace|revive|
export-stats`) and a JSON config file (`~/.maxout/config.json`).

This spec defines a VS Code extension that turns Maxout from "a thing running
in a terminal tab you forget about" into a first-class part of the editor:
visible state, one-click lifecycle control, and a bridge into whichever AI
coding extension (Continue, Cline, Roo Code, etc.) the user actually codes
with.

## 2. Goals

- **G1.** Make Maxout's running/stopped state and *which model just answered*
  visible at a glance, without opening a terminal.
- **G2.** Reduce lifecycle friction — start, stop, restart, run setup —
  to a single command or click.
- **G3.** Surface the operational data Maxout already tracks locally (quota
  spend, cooldowns, reliability scores) as a legible in-editor view, not a
  wall of CLI text.
- **G4.** Make it trivial to point other AI extensions at Maxout's endpoint.
- **G5.** Warn the user *before* a request silently fails over to a worse
  model because their primary is exhausted, where practical.

## 3. Non-Goals

- **NG1.** The extension is not a chat UI. It does not send completions
  itself; it manages and observes the proxy that other tools talk to.
- **NG2.** It does not manage provider API keys beyond what `maxout setup`
  already does — no key entry UI in v1.
- **NG3.** It does not replace `maxout` as a standalone CLI/server; VS Code
  must not be required to run Maxout.
- **NG4.** No telemetry to any third party. Anything the extension reads
  (quota, reliability) stays local, consistent with Maxout's own
  local-first design.

## 4. Users & Core Use Cases

| User | Use case |
|---|---|
| Solo dev using Maxout as their daily driver for an AI coding extension | "Is it running? Which model am I actually talking to right now? Am I about to burn my last Groq requests?" |
| Dev switching between 2–3 AI extensions | "Point whichever extension I'm using today at Maxout without hand-editing JSON each time." |
| Dev debugging a bad completion | "Why did this request route to a weaker model? Was it a skip, a cooldown, or a malformed-tool-call demotion?" |
| First-time user | "Get from `git clone` to a working local endpoint without leaving the editor." |

## 5. Compatibility & Grounding

Everything below is scoped against Maxout `0.1.0` as documented in its
README. Implementers should re-verify against the current README before
building, since CLI flags and file formats may shift.

| Surface | Detail |
|---|---|
| Binary | `maxout` (npm bin), also runnable via `npx github:<owner>/maxout` |
| Server | `maxout serve [--trace]`, Fastify, default `127.0.0.1:8787`, OpenAI-compatible at `/v1` |
| CLI commands | `serve`, `status [--reliability]`, `setup [--provider X --key Y]`, `trace <id>`, `revive <model-id\|provider>`, `export-stats [--out file]` |
| Transparency headers | Every response carries `model` (actual serving model) and `x-maxout-served-by`; every request gets `x-maxout-request-id` |
| Config file | `~/.maxout/config.json` — `aliases`, `harvest`, `modelLimits`, `providerLimits`, `annotateResponses`, `hybrid.enabled` / `dailyCapUSD`, host/port |
| Env/keys | `~/.maxout/.env` — `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `CEREBRAS_API_KEY`, (`GITHUB_TOKEN` accepted but inert) |
| Local state files | `usage.json`, `state.json`, `reliability.json`, `malformed.jsonl` — none contain prompt/response bodies |
| Windows quirk | PowerShell requires `$env:NAME = value`, not `set NAME=value` — worth surfacing in-extension if a Windows user hits an auth error |

## 6. Architecture

### 6.1 Process model

The extension does **not** re-implement any Maxout logic. It is a thin
control/observation layer over the existing CLI and HTTP server.

```mermaid
flowchart LR
    subgraph VSCode["VS Code Extension Host"]
        SB[Status Bar Item]
        CMD[Command Palette Commands]
        DASH[Dashboard Webview]
        PM[Process Manager]
        OC[Output Channel]
    end

    PM -- spawn "maxout serve --trace" --> SRV[(Maxout Server\nprocess)]
    SRV -- stdout/stderr --> PM
    PM --> OC
    PM -- parsed served-by / trace events --> SB
    PM -- parsed events --> DASH

    CMD -- terminal: status/setup/trace/export-stats --> TERM[Integrated Terminal]
    TERM -.-> CLI[(maxout CLI)]

    DASH -- periodic --> HTTP{{HTTP GET /v1\nhealth probe}}
    HTTP --> SRV

    OTHER[Other AI extension\ne.g. Continue / Cline] -- OpenAI-compatible calls --> SRV
```

### 6.2 Module breakdown

| Module | Responsibility |
|---|---|
| `extension.ts` | Activation, command registration, wiring |
| `processManager.ts` | Spawns/kills `maxout serve`, owns the `ChildProcess`, exposes an event emitter for `output`, `exit`, `servedBy` |
| `statusBar.ts` | Renders current state (`unknown` / `running` / `stopped`) + last-served-by tooltip |
| `healthCheck.ts` | Polls `/v1`; treats any HTTP response as "up", connection error as "down" |
| `dashboardProvider.ts` | `WebviewViewProvider` for the quota/reliability view (Phase 1, see §9) |
| `traceView.ts` | Input box + formatted trace result (Phase 1) |
| `configEditor.ts` | Open/scaffold `~/.maxout/config.json` |
| `integrations/*.ts` | Per-target helpers for pointing other extensions at Maxout (Phase 2, see §9) |
| `terminalRunner.ts` | Thin wrapper for one-shot interactive CLI commands |

### 6.3 Why child process for `serve`, terminal for everything else

`serve` is spawned as a detached, piped `ChildProcess` so its stdout can be
parsed programmatically (for the status bar / dashboard). Every other CLI
command (`setup`, `status`, `trace`, `export-stats`) is one-shot and, in the
case of `setup`, interactive (prompts, opens a browser tab) — those run in a
VS Code integrated terminal instead of being piped, since piping stdin to an
interactive CLI from an extension is unreliable.

## 7. State & Settings

### 7.1 In-memory extension state

| Field | Type | Description |
|---|---|---|
| `serverProcess` | `ChildProcess \| undefined` | Set only if *this window* launched the server |
| `serverUp` | `boolean` | Result of the last health check (source of truth for status bar, independent of `serverProcess`) |
| `lastServedBy` | `string \| undefined` | Most recent `x-maxout-served-by` / trace-parsed value |
| `quotaSnapshot` | `ModelQuota[] \| undefined` | Parsed result of last `status --reliability`, cached for the dashboard |

### 7.2 Settings (`contributes.configuration`)

| Key | Type | Default | Scope | Notes |
|---|---|---|---|---|
| `maxout.cliPath` | string | `"maxout"` | User | Override if not on PATH, or for local dev (`node dist/cli.js`) |
| `maxout.host` | string | `"127.0.0.1"` | User | Must match the server's actual bind host |
| `maxout.port` | number | `8787` | User | |
| `maxout.autoStart` | boolean | `false` | User | Start server on VS Code startup |
| `maxout.trace` | boolean | `true` | User | Whether `serve` is launched with `--trace` |
| `maxout.defaultAlias` | string | `"auto/coding"` | **Workspace** | Used by "Copy Endpoint Config" and any future insert-model-header command; workspace-scoped so different repos can prefer different aliases |
| `maxout.dashboardRefreshMs` | number | `5000` | User | Poll interval for the dashboard webview (Phase 1) |
| `maxout.warnOnCooldown` | boolean | `true` | User | Show a notification when a model the user relies on enters cooldown/exhausted (Phase 1) |

## 8. UI Specification

### 8.1 Status bar

Single item, left-aligned, priority 100, `command: maxout.menu`.

| State | Text | Tooltip | Background |
|---|---|---|---|
| Unknown (before first health check) | `$(sync~spin) Maxout` | "Checking..." | default |
| Down | `$(circle-slash) Maxout: stopped` | "Not running. Click to start." | `statusBarItem.warningBackground` |
| Up, no served-by yet | `$(zap) Maxout: running` | "Running. Click for options." | default |
| Up, with last served-by | `$(zap) Maxout: groq::gpt-oss-120b` | "Last served by groq::gpt-oss-120b. Click for options." | default |
| Up, model in cooldown (Phase 1, requires quota data) | `$(warning) Maxout: 2 models cooling down` | Lists which | `statusBarItem.warningBackground` |

### 8.2 Command menu (`maxout.menu`, QuickPick)

Ordered by expected frequency of use:

1. Start / Stop / Restart Server *(label flips based on current state)*
2. Show Dashboard *(Phase 1 — opens the webview instead of a terminal dump)*
3. Trace a Request
4. Run Setup Wizard
5. Copy Endpoint Config
6. Point [Detected Extension] at Maxout *(Phase 2 — only shown if a supported extension is installed)*
7. Open Config File
8. Export Reliability Stats

### 8.3 Dashboard webview (Phase 1)

A `WebviewViewProvider` contributed to a custom Activity Bar container (icon:
a stylized "M" or lightning bolt, matching Maxout's brand mark).

**Layout:**

```
┌─ Maxout ──────────────────────────────── ⟳ refresh ─┐
│ ● Running · 127.0.0.1:8787 · alias: auto/coding      │
├───────────────────────────────────────────────────────┤
│ Model                    State      Req      Tok    Rel │
│ groq::gpt-oss-120b       ok         12/50    84k/1M  98%│
│ openrouter::qwen-2.5-72b cooldown 3m —        —       — │
│ google::gemini-2.5-flash exhausted ↻ 14:02 UTC —      91%│
│ [pool] openrouter        req 31/1000                     │
├───────────────────────────────────────────────────────┤
│ Last routed: groq::gpt-oss-120b (2s ago)   [Trace →]     │
└───────────────────────────────────────────────────────┘
```

- Rows sourced from parsing `maxout status --reliability` output (Phase 1)
  or a future `--json` flag (Phase 2, see Appendix B).
- Clicking a row's "State" cell with a non-`ok` value shows the reason code
  inline (`peak-throttle`, `exhausted (pool)`, `retired since ...`).
- "Trace →" on the last-routed row opens the trace view pre-filled with that
  request's id.
- Empty/first-run state: if no keys are configured, show a single CTA
  "Run Setup Wizard" instead of an empty table.

### 8.4 Notifications

| Trigger | Type | Message |
|---|---|---|
| `maxout serve` exits unexpectedly (non-zero, not user-initiated) | Error | "Maxout stopped unexpectedly (exit code N). [Show Output] [Restart]" |
| Spawn fails with `ENOENT` | Error | "Maxout CLI not found. Install it or set `maxout.cliPath`. [Open Settings] [Install Instructions]" |
| A model in `maxout.defaultAlias`'s tier enters `exhausted` (Phase 1, requires quota parsing) | Warning | "`auto/coding` is running low on options: N of M models exhausted. [Show Dashboard]" |
| First successful `setup` completion | Info | "Maxout is configured and running. [Copy Endpoint Config]" |

## 9. Command Reference

| Command ID | Title | Implementation |
|---|---|---|
| `maxout.menu` | Maxout: Show Menu | QuickPick, see §8.2 |
| `maxout.start` | Maxout: Start Server | Spawn `serve [--trace]`; no-op with info message if already owned by this window |
| `maxout.stop` | Maxout: Stop Server | Kill owned process; info message if not owned (see §11, multi-window caveat) |
| `maxout.restart` | Maxout: Restart Server | Stop then start with a short delay |
| `maxout.status` | Maxout: Show Status | **v1:** run `status --reliability` in terminal. **Phase 1:** open dashboard instead |
| `maxout.setup` | Maxout: Run Setup Wizard | `setup` in integrated terminal (interactive) |
| `maxout.trace` | Maxout: Trace a Request | Input box for request id → `trace <id>` in terminal (v1) / inline panel (Phase 1) |
| `maxout.revive` | Maxout: Revive a Model or Provider | *(Phase 1)* Input box → `revive <id>` |
| `maxout.openConfig` | Maxout: Open Config File | Opens `~/.maxout/config.json`, scaffolds if missing |
| `maxout.copyEndpoint` | Maxout: Copy Endpoint Config | Clipboard: `{ apiBase, apiKey: "anything", model: <defaultAlias> }` |
| `maxout.exportStats` | Maxout: Export Reliability Stats | `export-stats --out maxout-stats.json` in terminal |
| `maxout.pointExtension` | Maxout: Point [X] at Maxout | *(Phase 2)* Per-target integration, see §12 |

## 10. Error Handling & Edge Cases

| Case | Behavior |
|---|---|
| `maxout` not on PATH | Spawn error caught, actionable message with `maxout.cliPath` pointer (§8.4) |
| Port already in use by a non-Maxout process | Health check will show "up" incorrectly if something else answers on that port; document as a known limitation, not silently handled in v1 |
| Server already running (started outside VS Code) | Status bar correctly shows "running" via health check even though `serverProcess` is `undefined`; Start/Stop/Restart commands must check `serverProcess` state, not just `serverUp`, and message accordingly (§6.3, §11) |
| `stop` called with no owned process | Info message, not an error — the user's mental model is "the server," not "the process this window happens to hold a handle to" |
| VS Code window closes while server is running | `deactivate()` kills any owned child process — document this clearly, since a user may expect the server to keep running in the background like a real daemon |
| Malformed/partial stdout line split across two `data` events | Buffer partial lines; only regex-match on complete lines (v1 risk: naive `buf.toString()` per chunk can miss a match split across chunks — implementers should line-buffer) |
| `config.json` doesn't exist yet | `openConfig` scaffolds an untitled document with a save hint rather than erroring |

## 11. Multi-Window & Multi-Instance Behavior

Maxout runs as a single local server; multiple VS Code windows may be open
against the same instance. This needs an explicit decision, not an accident
of implementation:

- **Recommended v1 behavior:** Ownership is per-window (`serverProcess` is
  module-level state in that window's extension host). `Stop`/`Restart` only
  act on a process this window started; if the server is up but unowned,
  offer "Stop" as *find process on `maxout.port` and kill it* only behind an
  explicit confirmation, since killing a process another window (or a
  teammate) started is destructive.
- Status bar state (`serverUp`) is always derived from the health check, not
  from `serverProcess`, so it's correct regardless of which window (if any)
  owns the process.

## 12. Third-Party Integration Helpers (Phase 2)

Goal: reduce "copy JSON, paste into settings" to "click a button." Because
every target extension's config schema can change between versions, this
must be built defensively:

1. Detect installed target extensions via `vscode.extensions.getExtension(id)`.
2. For each supported target, maintain a small adapter that:
   - Locates its config file or settings key.
   - Reads and parses the existing config.
   - Merges in a Maxout provider entry (base URL, dummy key, default
     model/alias) without clobbering other providers.
   - Writes it back, and opens the file with the diff visible before saving
     if the merge touched existing content, so the user can confirm.
3. **Before implementation:** re-verify each target's current schema; do not
   assume the schema documented at spec-writing time is still current.

Candidate v1 targets (subject to confirming current config format at build
time): Continue, Cline, Roo Code. GitHub Copilot Chat is out of scope — its
model selection is not a user-editable custom-endpoint config.

## 13. Security & Privacy

- The extension never reads, stores, or transmits provider API keys. Key
  entry stays inside `maxout setup`, run in a real terminal.
- `export-stats` output (model ids, rates, sample counts) is written to a
  file the user explicitly names; the extension does not upload it anywhere.
- No analytics/telemetry calls from the extension itself, consistent with
  Maxout's own local-first stance (§2, NG4).
- The endpoint snippet's `apiKey: "anything"` reflects that Maxout doesn't
  check client keys (per its README) — worth a one-line note in the copied
  snippet's surrounding UI so users don't mistake it for a real secret.

## 14. Performance Considerations

- Health-check polling (§7.2 `dashboardRefreshMs`, default 4–5s) should back
  off or pause when the dashboard view isn't visible
  (`WebviewView.onDidChangeVisibility`) to avoid needless work when the
  panel is closed.
- Output channel appends should not re-render the whole buffer; VS Code's
  `OutputChannel.append` is already incremental — avoid any custom buffering
  that defeats that.

## 15. Cross-Platform Considerations

- Windows: `spawn` needs `{ shell: true }` for a bare command name like
  `maxout` to resolve via PATH the way it does in `cmd.exe`/PowerShell.
- Windows: surface the README's PowerShell `$env:NAME = value` gotcha in the
  Setup Wizard command's description or a first-run tip, since it's a
  documented footgun for manual key configuration.
- Config/env file paths differ (`%USERPROFILE%\.maxout\` vs `~/.maxout/`) —
  use `os.homedir()` rather than hardcoding `$HOME`.

## 16. Testing Strategy

| Layer | Approach |
|---|---|
| Unit | Pure functions (output-line parsing, config-merge logic for §12) tested with `vitest`/`mocha` outside the VS Code API surface |
| Integration | `@vscode/test-electron` running the extension against a **mocked** Maxout server (a tiny local HTTP stub) so tests don't depend on real provider keys |
| Manual smoke test | Full loop against a real `maxout serve` instance with at least one configured provider, before each release |

## 17. Packaging & Distribution

- Standard `vsce package` → `.vsix`; publish to the Marketplace once a
  publisher id and icon are finalized.
- `activationEvents: ["onStartupFinished"]` is sufficient — no need for
  eager activation on a specific view/command.
- Bundle size should stay minimal; no runtime dependencies beyond the VS
  Code API and Node built-ins (current scaffold has zero `dependencies`,
  only `devDependencies`).

## 18. Phased Roadmap

| Phase | Scope |
|---|---|
| **0 — MVP** | Status bar + health check, start/stop/restart, terminal-shelled status/setup/trace/export-stats, copy-endpoint clipboard helper, config file open/scaffold |
| **1 — Observability** | Dashboard webview (§8.3), notification on cooldown/exhaustion (§8.4), inline trace view instead of terminal dump, `revive` command |
| **2 — Integration** | Per-extension "point at Maxout" adapters (§12), workspace-scoped `defaultAlias` used consistently across features |
| **3 — Polish** | Icon/branding, Marketplace listing, `--json` core changes landed and consumed (Appendix B), automated integration tests |

## 19. Open Questions / Risks

1. Should the extension be able to *install* Maxout (`npm install -g`) on
   first use if it's missing, or only detect-and-link-to-instructions? Auto-
   install is more convenient but riskier (global installs from an
   extension are something users may not expect).
2. Is a single global server the right model, or should the extension ever
   spawn a workspace-scoped instance on an alternate port (e.g., to isolate
   quota usage per project)? Current spec assumes one shared global server,
   matching Maxout's own design.
3. How aggressively should "warn on cooldown" fire — per-event (noisy) or
   debounced to "state changed since last dashboard view" (quieter, spec's
   current lean)?
4. Regex-based stdout parsing (v1) is inherently fragile against upstream
   log-format changes. Appendix B's `--json` proposal should be prioritized
   accordingly rather than treated as a nice-to-have.

## Appendix A: Proposed Extension Project Layout

```
maxout-vscode/
├── package.json          # manifest: commands, configuration, activation
├── tsconfig.json
├── .vscodeignore
├── .vscode/
│   ├── launch.json        # F5 → Extension Development Host
│   └── tasks.json         # npm: compile as preLaunchTask
└── src/
    ├── extension.ts        # activate/deactivate, command wiring
    ├── processManager.ts
    ├── healthCheck.ts
    ├── statusBar.ts
    ├── dashboardProvider.ts # Phase 1
    ├── traceView.ts         # Phase 1
    ├── configEditor.ts
    ├── terminalRunner.ts
    └── integrations/        # Phase 2
        ├── continue.ts
        ├── cline.ts
        └── rooCode.ts
```

## Appendix B: Suggested Changes to Maxout Core

These live in the `maxout` repo itself, not the extension, but the
extension's Phase 1–2 quality depends on them:

1. `maxout status --json` — same data as the human-readable table, machine
   parseable. Removes all terminal-scraping from the dashboard.
2. `maxout trace <id> --json` — structured candidate list + skip reasons for
   the inline trace view (§8.3).
3. Optional: a lightweight internal HTTP route (e.g. `GET /internal/status`,
   loopback-only) so the dashboard can poll over HTTP instead of shelling
   out to the CLI on an interval — cheaper and avoids spawning a process
   every refresh tick.
4. Optional: an SSE or WebSocket stream of routing events so the extension
   can update live instead of polling — most valuable if `--trace`'s stdout
   format is expected to keep changing, since it replaces regex-parsing
   entirely with a contract.
