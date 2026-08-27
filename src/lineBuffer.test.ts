import { describe, it, expect } from 'vitest';
import { LineBuffer } from './lineBuffer';

describe('LineBuffer', () => {
  it('returns complete lines when chunk ends with newline', () => {
    const buf = new LineBuffer();
    expect(buf.push('a\n')).toEqual(['a']);
    expect(buf.push('b\nc\n')).toEqual(['b', 'c']);
  });

  it('buffers a partial line across chunks', () => {
    const buf = new LineBuffer();
    expect(buf.push('x-maxout-served')).toEqual([]); // no newline yet
    expect(buf.push('-by: groq::gpt-oss-120b\n')).toEqual(['x-maxout-served-by: groq::gpt-oss-120b']);
  });

  it('splits multiple lines in one chunk', () => {
    const buf = new LineBuffer();
    expect(buf.push('a\nb\nc')).toEqual(['a', 'b']); // 'c' stays partial
    expect(buf.flush()).toEqual(['c']);
  });

  it('flush returns the trailing partial line', () => {
    const buf = new LineBuffer();
    buf.push('no newline here');
    expect(buf.flush()).toEqual(['no newline here']);
    expect(buf.flush()).toEqual([]); // already flushed
  });

  it('clear resets state', () => {
    const buf = new LineBuffer();
    buf.push('stale');
    buf.clear();
    expect(buf.flush()).toEqual([]);
  });
});