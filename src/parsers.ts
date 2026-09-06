/**
 * Pure parsing functions for FreeMaxxing CLI/output parsing.
 *
 * Kept free of `vscode` imports so they can be unit-tested with vitest
 * outside the VS Code API surface (spec §16).
 */

/** A single parsed row from `freemaxxing status --reliability` output. */
export interface StatusRow {
  model: string;
  state: string;
  requests: string;
  tokens: string;
  reliability: string;
  score?: string;
}

/**
 * Parse the output from `freemaxxing status --reliability`.
 *
 * Expected layout (from actual CLI output):
 * ```
 * openrouter::deepseek/deepseek-chat-v3-0324:free    score=-  n=   0  avg=-
 * openrouter::qwen/qwen-2.5-coder-32b-instruct:free  score=-  n=   0  avg=-
 * openrouter::nvidia/nemotron-3-ultra-550b-a55b:free score=1.00  n=  50  avg=21518ms
 * mistral::mistral-small-latest                      score=1.00  n=  10  avg=4112ms
 * ```
 *
 * Strategy: split on whitespace, extract model, score, n (requests), avg (latency).
 */
export function parseStatusTable(output: string): StatusRow[] {
  const lines = output.split(/\r?\n/);
  const results: StatusRow[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) { continue; }

    // Parse: model    score=X    n=Y    avg=Z
    // Fields separated by 2+ spaces. Values after = may contain leading spaces.
    // Match model, then score=X, then n=Y, then avg=Z
    const match = trimmed.match(/^(\S+)\s{2,}score=([^\s]+)\s{2,}n=(.+?)\s{2,}avg=(.+)$/);
    if (!match) { continue; }

    const model = match[1];
    const score = match[2];
    const requests = match[3].trim();
    const avg = match[4].trim();

    // Derive state from score
    let state = 'unknown';
    if (score !== '-' && parseFloat(score) > 0) {
      state = 'ok';
    } else if (score === '-') {
      state = 'unknown';
    }

    const row: StatusRow = {
      model,
      state,
      requests,
      tokens: '—',
      reliability: avg,
      score,
    };

    results.push(row);
  }

  return results;
}

/**
 * Parse a served-by marker from a single line of server stdout/stderr or a
 * response header value. Returns the model id, or `undefined` if none of
 * the known patterns matched.
 *
 * Handles:
 *  - `x-freemaxxing-served-by: groq::gpt-oss-120b`
 *  - `x-freemaxxing-served-by: groq::gpt-oss-120b` (header value alone)
 *  - `served by groq::gpt-oss-120b`
 *  - `routing request to groq::gpt-oss-120b`
 *  - bare header values like `groq::gpt-oss-120b`
 */
export function parseServedBy(text: string): string | undefined {
  // 1. Attribute-style: "x-freemaxxing-served-by: <model>" or "served by <model>"
  const attributed = text.match(/(?:x-freemaxxing-served-by|served\s+by|serving\s+by|routed\s+to)[:\s]+(\S+)/i);
  if (attributed) {
    return cleanModel(attributed[1]);
  }

  // 2. Bare model id (e.g. an HTTP header value already stripped of its name)
  const bare = text.trim().match(/^([a-z0-9]+::[A-Za-z0-9._\-/]+)$/i);
  if (bare) {
    return bare[1];
  }

  return undefined;
}

/** Strip trailing punctuation that is not part of a model id. */
function cleanModel(value: string): string {
  return value.replace(/[.,;:!?"']+$/, '');
}

/**
 * Whether a state string represents cooldown / exhaustion (Phase 1 warning
 * logic and status-bar background use this).
 */
export function isCoolingDown(state: string): boolean {
  return /cooldown|exhausted|throttle/i.test(state);
}

/** Map a raw state string to a small stable slug for UI coloring. */
export function stateSlug(state: string): 'ok' | 'cooldown' | 'exhausted' | 'unknown' {
  if (/^ok$/i.test(state)) { return 'ok'; }
  if (/exhausted/i.test(state)) { return 'exhausted'; }
  if (/cooldown|throttle/i.test(state)) { return 'cooldown'; }
  return 'unknown';
}

/**
 * Build the JSON snippet copied by "Copy Endpoint Config".
 */
export function buildEndpointConfig(
  host: string,
  port: number,
  defaultAlias: string
): string {
  return JSON.stringify(
    {
      apiBase: `http://${host}:${port}`,
      apiKey: 'anything',
      model: defaultAlias,
    },
    null,
    2
  );
}

/**
 * Light formatting for raw CLI trace/status output before it is shown in
 * the inline trace view: trims trailing whitespace per line, drops empty
 * lines, collapses 3+ consecutive blank lines to one.
 */
export function formatCliOutput(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed.trim().length === 0) {
      blankRun++;
      if (blankRun <= 1) { out.push(''); }
      continue;
    }
    blankRun = 0;
    out.push(trimmed);
  }
  // Drop trailing blank lines
  while (out.length > 0 && out[out.length - 1].trim().length === 0) {
    out.pop();
  }
  return out.join('\n');
}