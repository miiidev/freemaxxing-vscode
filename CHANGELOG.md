# Change Log

All notable changes to the "freemaxxing-vscode" extension will be documented in this file.

## 0.1.0 — 2026-09-06

* Rename `maxout-vscode` → `freemaxxing-vscode` (`freemaxxing` 0.1.0, `~/.freemaxxing`, `x-freemaxxing-served-by`)
* Sync with upstream: `local` provider (Ollama), `providers`/`disable`/`enable`, `harvest` bool, `reliability`, `localModels`, `ttfbTimeoutMs`/`retryBackoffMs`
* Dashboard: `Score` column, `Harvest` + `Custom alias` badges, 6-col layout (`src/dashboardProvider.ts`)
* Providers menu: `Show Providers`, `Disable Provider`, `Enable Provider`
* Parsers: `score` field, `x-freemaxxing-served-by` (`src/parsers.ts`)
* `tsconfig` fix: `lib DOM` + `types node` for `fs`/`setInterval` (`typescript 5.9.3`)
* Packaging: fix `.vscodeignore` (`dist/`), use `media/logo.svg` for activity bar

See `freemaxxing-vscode-spec.md` for full spec.
