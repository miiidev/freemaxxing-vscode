/**
 * Accumulates streamed text chunks and hands back only complete lines.
 *
 * `maxout serve` writes JSON/routing lines; on a slow or chunked pipe a
 * single logical line can be split across multiple `data` events. Naive
 * per-chunk `toString()` parsing would miss those matches (spec §10).
 */
export class LineBuffer {
  private _partial = '';

  /** Feed a chunk; returns any complete lines (without trailing newline). */
  push(chunk: string): string[] {
    this._partial += chunk;
    const lines = this._partial.split('\n');
    // The last element is an incomplete line (or '' if input ended with \n)
    this._partial = lines.pop() ?? '';
    return lines;
  }

  /** Flush any remaining partial line (called on process close). */
  flush(): string[] {
    if (this._partial.length === 0) {
      return [];
    }
    const line = this._partial;
    this._partial = '';
    return [line];
  }

  /** Reset the buffer. */
  clear(): void {
    this._partial = '';
  }
}