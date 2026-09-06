import { describe, it, expect } from 'vitest';
import {
  parseStatusTable,
  parseServedBy,
  isCoolingDown,
  stateSlug,
  buildEndpointConfig,
  formatCliOutput,
} from './parsers';

describe('parseStatusTable', () => {
  // Test data matches actual `freemaxxing status --reliability` output format:
  // Fields are separated by 2+ spaces
  // provider::model    score=X    n=Y    avg=Zms

  it('parses models with score, requests, and latency', () => {
    const output = [
      'openrouter::nvidia/nemotron-3-ultra-550b-a55b:free  score=1.00  n=  50  avg=21518ms',
      'mistral::mistral-small-latest                      score=1.00  n=  10  avg=4112ms',
      'openrouter::qwen/qwen-2.5-coder-32b-instruct:free  score=-  n=   0  avg=-',
    ].join('\n');

    const rows = parseStatusTable(output);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      model: 'openrouter::nvidia/nemotron-3-ultra-550b-a55b:free',
      state: 'ok',
      requests: '50',
      tokens: '—',
      reliability: '21518ms',
      score: '1.00',
    });
    expect(rows[1].model).toBe('mistral::mistral-small-latest');
    expect(rows[1].state).toBe('ok');
    expect(rows[2].model).toBe('openrouter::qwen/qwen-2.5-coder-32b-instruct:free');
    expect(rows[2].state).toBe('unknown');
    expect(rows[2].requests).toBe('0');
  });

  it('returns no rows for empty or garbage output', () => {
    expect(parseStatusTable('')).toEqual([]);
    expect(parseStatusTable('garbage without a header')).toEqual([]);
  });
});

describe('parseServedBy', () => {
  it('parses the header-style attribute', () => {
    expect(parseServedBy('x-freemaxxing-served-by: groq::gpt-oss-120b')).toBe('groq::gpt-oss-120b');
  });

  it('parses "served by" prose', () => {
    expect(parseServedBy('Request served by groq::gpt-oss-120b in 412ms')).toBe('groq::gpt-oss-120b');
  });

  it('parses "routed to" prose', () => {
    expect(parseServedBy('routed to openrouter::qwen-2.5-72b')).toBe('openrouter::qwen-2.5-72b');
  });

  it('strips trailing punctuation from the model id', () => {
    expect(parseServedBy('served by google::gemini-2.5-flash.')).toBe('google::gemini-2.5-flash');
  });

  it('accepts a bare header value (model id only)', () => {
    expect(parseServedBy('groq::llama-3.1-70b')).toBe('groq::llama-3.1-70b');
  });

  it('returns undefined when nothing matches', () => {
    expect(parseServedBy('listening on 127.0.0.1:8787')).toBeUndefined();
    expect(parseServedBy('')).toBeUndefined();
  });
});

describe('isCoolingDown / stateSlug', () => {
  it('flags cooldown and exhausted states', () => {
    expect(isCoolingDown('cooldown 3m')).toBe(true);
    expect(isCoolingDown('exhausted')).toBe(true);
    expect(isCoolingDown('peak-throttle')).toBe(true);
    expect(isCoolingDown('ok')).toBe(false);
  });

  it('maps states to slug colors', () => {
    expect(stateSlug('ok')).toBe('ok');
    expect(stateSlug('cooldown 3m')).toBe('cooldown');
    expect(stateSlug('exhausted')).toBe('exhausted');
    expect(stateSlug('req 31/1000')).toBe('unknown');
  });
});

describe('buildEndpointConfig', () => {
  it('produces the expected JSON snippet', () => {
    const snippet = buildEndpointConfig('127.0.0.1', 8787, 'auto/coding');
    expect(JSON.parse(snippet)).toEqual({
      apiBase: 'http://127.0.0.1:8787',
      apiKey: 'anything',
      model: 'auto/coding',
    });
  });
});

describe('formatCliOutput', () => {
  it('trims trailing whitespace and collapses blank runs', () => {
    const raw = 'line1   \n\n\n\nline2\n\nline3\n\n\n';
    expect(formatCliOutput(raw)).toBe('line1\n\nline2\n\nline3');
  });

  it('returns empty string for blank input', () => {
    expect(formatCliOutput('   \n\n  ')).toBe('');
  });
});