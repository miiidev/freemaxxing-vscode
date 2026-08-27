import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { LineBuffer } from './lineBuffer';
import { parseServedBy } from './parsers';

/**
 * Manages the lifecycle of the `maxout serve` child process.
 *
 * Emits:
 *  - `output` (text: string): complete lines from stdout/stderr
 *  - `exit` (code: number | null): process exit
 *  - `servedBy` (model: string): parsed served-by model from output
 *  - `spawnError` (err: NodeJS.ErrnoException): spawn failure (e.g. ENOENT)
 *
 * Note about `isRunning()`: only means *this window* owns the serve process.
 * The server may be running externally (see spec §11); that is the health
 * check's job to detect.
 */
export class ProcessManager {
  private process: ChildProcess | null = null;
  private emitter = new EventEmitter();
  private stdoutBuffer = new LineBuffer();
  private stderrBuffer = new LineBuffer();
  /** True when stop() was requested, so the exit handler can suppress "unexpected crash" notifications. */
  private stopping = false;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Spawn `maxout serve [--trace]` as a piped child process.
   *
   * On Windows uses `{ shell: true }` so a bare `maxout` command resolves
   * via PATH the same way it does in cmd.exe/PowerShell (spec §15).
   *
   * Spawn failures (ENOENT) surface asynchronously through the `spawnError`
   * event, not a throw. Callers must subscribe before calling start().
   */
  start(
    cliPath: string,
    opts: { trace?: boolean; host?: string; port?: number } = {}
  ): void {
    if (this.process) {
      return; // already running (owned by this instance)
    }

    this.stopping = false;
    this.stdoutBuffer.clear();
    this.stderrBuffer.clear();

    const args = ['serve'];
    if (opts.trace) {
      args.push('--trace');
    }

    const spawnOptions: any = {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    };

    // Windows: shell: true resolves bare commands through PATH.
    if (process.platform === 'win32') {
      spawnOptions.shell = true;
    }

    const child = spawn(cliPath, args, spawnOptions);

    child.on('error', (err) => {
      this.process = null;
      this.emitter.emit('spawnError', err);
    });

    child.on('exit', (code) => {
      this.process = null;
      this.emitter.emit('exit', code);
    });

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => {
        this.handleChunk(chunk.toString(), this.stdoutBuffer);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        this.handleChunk(chunk.toString(), this.stderrBuffer);
      });
    }

    child.on('close', () => {
      const leftover = [
        ...this.stdoutBuffer.flush(),
        ...this.stderrBuffer.flush(),
      ];
      for (const line of leftover) {
        if (line.length > 0) {
          this.emitOutput(line);
          this.emitServedBy(line);
        }
      }
    });

    this.process = child;
  }

  /**
   * Kill the owned child process.
   * Windows: taskkill (SIGTERM is unreliable for processes spawned via a
   * shell); otherwise SIGTERM, escalating to SIGKILL after a grace period.
   */
  stop(): void {
    const child = this.process;
    if (!child) {
      return;
    }

    this.stopping = true;
    this.process = null;

    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } else {
        child.kill('SIGTERM');
        // If still alive after 2s, force kill
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            try { child.kill('SIGKILL'); } catch { /* already gone */ }
          }
        }, 2000).unref();
      }
    } catch {
      // Process may already be gone
    }
  }

  /** True if *this window* owns a live serve process. */
  isRunning(): boolean {
    return this.process !== null;
  }

  /** True if the last exit was caused by an explicit stop() call. */
  wasUserInitiatedStop(): boolean {
    return this.stopping;
  }

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  onOutput(fn: (text: string) => void): void {
    this.emitter.on('output', fn);
  }

  onExit(fn: (code: number | null) => void): void {
    this.emitter.on('exit', fn);
  }

  onServedBy(fn: (model: string) => void): void {
    this.emitter.on('servedBy', fn);
  }

  onSpawnError(fn: (err: NodeJS.ErrnoException) => void): void {
    this.emitter.on('spawnError', fn);
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private handleChunk(chunk: string, buffer: LineBuffer): void {
    const lines = buffer.push(chunk);
    for (const line of lines) {
      this.emitOutput(line);
      this.emitServedBy(line);
    }
  }

  private emitOutput(line: string): void {
    this.emitter.emit('output', line + '\n');
  }

  private emitServedBy(line: string): void {
    const model = parseServedBy(line);
    if (model) {
      this.emitter.emit('servedBy', model);
    }
  }
}