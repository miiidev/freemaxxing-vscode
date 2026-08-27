import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import * as http from 'http';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { StatusRow, parseStatusTable, parseServedBy } from './parsers';

const outputChannel = vscode.window.createOutputChannel('Maxout');

const execP = promisify(exec);
const execFileP = promisify(execFile);

/**
 * Polls the Maxout server's `/v1` endpoint to determine server state.
 *
 * Treats *any* HTTP response as "up"; connection refused / DNS failure /
 * timeout as "down". Also captures the `x-maxout-served-by` header (when the
 * server responds with one) for the status bar.
 */
export class HealthCheck {
  private _up = false;
  private _lastServedBy: string | undefined;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _emitter = new EventEmitter();
  private _pollIntervalMs = 5000;

  constructor() {
    this.updateConfig();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Start the polling loop. */
  startPolling(): void {
    if (this._timer) { return; }
    const interval = this._pollIntervalMs;
    this.poll(); // immediate first check
    this._timer = setInterval(() => this.poll(), interval);
  }

  /** Stop the polling loop. */
  stopPolling(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /** Latest known server-up state. */
  isUp(): boolean {
    return this._up;
  }

  /** Last served-by model captured from a response header. */
  getLastServedBy(): string | undefined {
    return this._lastServedBy;
  }

  /** Re-read config (host, port, poll interval). */
  updateConfig(): void {
    const config = vscode.workspace.getConfiguration('maxout');
    // Health-check polling shares the dashboard refresh interval to keep
    // the setting surface small (spec §14 lean).
    this._pollIntervalMs = config.get<number>('dashboardRefreshMs', 5000);
  }

  /** Register state-change listener: (up, servedBy?) => void. */
  onStateChange(fn: (up: boolean, servedBy?: string) => void): void {
    this._emitter.on('stateChange', fn);
  }

  /**
   * Run `maxout status --reliability` and return parsed rows for the
   * dashboard. Shells out to the CLI (Phase 1 approach; spec Appendix B
   * proposes a `--json` flag to replace terminal scraping).
   *
   * Throws when the CLI is missing (`ENOENT`) — callers decide how to
   * surface that.
   */
  async fetchStatusReliability(cliPath: string): Promise<StatusRow[]> {
    const { stdout, stderr } = await this.runCli(cliPath, ['status', '--reliability']);
    const output = stdout.length > 0 ? stdout : stderr;
    outputChannel.appendLine(`[Maxout] CLI output: ${JSON.stringify(output)}`);
    outputChannel.appendLine(`[Maxout] CLI stdout length: ${stdout.length}, stderr length: ${stderr.length}`);
    return parseStatusTable(output);
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Cross-platform CLI invocation:
   *  - POSIX: execFile directly; a bare `maxout` resolves via PATH.
   *  - Windows: exec through the shell (`cmd.exe`) so a bare `maxout`
   *    resolves the same way it does in PowerShell/Command Prompt.
   */
  private async runCli(
    cliPath: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string }> {
    const isPath = /[\\/]/.test(cliPath);

    if (process.platform === 'win32') {
      const exe = isPath ? `"${cliPath}"` : cliPath;
      const command = `${exe} ${args.join(' ')}`;
      const { stdout, stderr } = await execP(command, {
        timeout: 15000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      });
      return { stdout: stdout ?? '', stderr: stderr ?? '' };
    }

    const { stdout, stderr } = await execFileP(cliPath, args, {
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
  }

  private poll(): void {
    const config = vscode.workspace.getConfiguration('maxout');
    const host = config.get<string>('host', '127.0.0.1');
    const port = config.get<number>('port', 8787);

    const req = http.get(`http://${host}:${port}/v1`, (res) => {
      const header = res.headers['x-maxout-served-by'];
      const rawServedBy = Array.isArray(header) ? header[0] : header;
      const servedBy = rawServedBy ? (parseServedBy(rawServedBy) ?? rawServedBy) : undefined;

      const wasUp = this._up;
      this._up = true;
      if (servedBy) {
        this._lastServedBy = servedBy;
      }

      if (!wasUp || servedBy) {
        this._emitter.emit('stateChange', this._up, servedBy);
      }
      res.resume(); // consume the response body to free the socket
    });

    req.on('error', () => {
      this.markDown();
    });

    req.setTimeout(3000, () => {
      req.destroy();
      this.markDown();
    });
  }

  private markDown(): void {
    const wasUp = this._up;
    this._up = false;
    if (wasUp) {
      this._emitter.emit('stateChange', false);
    }
  }
}