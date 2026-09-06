# FreeMaxxing for VS Code

**Local LLM proxy manager — start, stop, and monitor your FreeMaxxing server from VS Code.**

FreeMaxxing (`https://github.com/miiidev/freemaxxing`) is a local OpenAI-compatible proxy that pools free-tier LLMs (OpenRouter, Groq, Google, Mistral, Cerebras, and local Ollama) behind stable aliases (`auto/coding`, `auto/fast`, `auto/any`). This extension turns it from “a terminal tab you forget about” into a first-class editor feature.

## Features

* **Status Bar** — `FreeMaxxing: running` / `stopped` / `N models cooling down` with last `x-freemaxxing-served-by` tooltip (`src/statusBar.ts:74`)
* **Dashboard** (`FreeMaxxing` Activity Bar → Dashboard) — quota & reliability table (`score`, `n`, `avg`), filter/search/sort, detail drawer with **Revive**, `harvest` + `custom alias` badges (`src/dashboardProvider.ts:147`)
* **Lifecycle** — `Start` / `Stop` / `Restart` server (`freemaxxing serve --trace` via `src/processManager.ts:31`)
* **Setup Wizard** — `freemaxxing setup` in integrated terminal (`src/terminalRunner.ts:12`)
* **Trace / Revive** — input-box → `freemaxxing trace <id>` / `revive <model|provider>` with `x-freemaxxing-served-by` summary (`src/traceView.ts:84`)
* **Copy Endpoint** — clipboard `{"apiBase","apiKey":"anything","model":"auto/coding"}` (`src/parsers.ts:125`)
* **Providers** — `Show Providers` / `Disable` / `Enable` (`freemaxxing providers/disable/enable`) (`src/extension.ts:362`)
* **Point Extension at FreeMaxxing** — auto-configures **Continue** / **Cline** / **Roo Code** (`src/integrations/continue.ts:126`)

## Requirements

* Node `>=20`
* FreeMaxxing CLI on `PATH` or set `freemaxxing.cliPath` (e.g. `node D:\...\freemaxxing\dist\cli.js`). Bare `freemaxxing` needs `npm link` in `../freemaxxing` or global install.

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `freemaxxing.cliPath` | `freemaxxing` | Path to CLI binary |
| `freemaxxing.host` | `127.0.0.1` | Server bind host |
| `freemaxxing.port` | `8787` | Server port |
| `freemaxxing.autoStart` | `false` | Start on VS Code startup |
| `freemaxxing.trace` | `true` | Launch with `--trace` |
| `freemaxxing.defaultAlias` | `auto/coding` | Alias for Copy Endpoint (resource scope) |
| `freemaxxing.dashboardRefreshMs` | `5000` | Dashboard poll interval |
| `freemaxxing.warnOnCooldown` | `true` | Notify on cooldown/exhausted |
| `freemaxxing.localBaseURL` | `""` | Override local provider (`http://localhost:11434/v1`) |
| `freemaxxing.ttfbTimeoutMs` | `30000` | TTFB timeout |
| `freemaxxing.retryBackoffMs` | `1000` | Retry backoff |

Config file: `~/.freemaxxing/config.json` (scaffolded by `FreeMaxxing: Open Config File`).

## Commands

`FreeMaxxing: Show Menu` → QuickPick for all above. Also `Show Dashboard`, `Trace a Request`, `Revive a Model or Provider`, `Open Config File`, `Copy Endpoint Config`, `Export Reliability Stats`, `Point Extension at FreeMaxxing`, `Show Providers`, `Disable Provider`, `Enable Provider`.

## Known Issues

* `freemaxxing` must be on `PATH` or `freemaxxing.cliPath` set — otherwise `ENOENT` with `Open Settings` prompt.
* `dist/` must be included (fixed in `.vscodeignore:3`).

## Release Notes

See `CHANGELOG.md`.

## Development

```bash
npm install
npm run compile   # esbuild -> dist/extension.js
npm run test      # vitest 18 tests
```

Spec: `freemaxxing-vscode-spec.md`.
