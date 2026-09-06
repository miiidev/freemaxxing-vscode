import * as vscode from 'vscode';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { formatCliOutput, parseServedBy } from './parsers';

const execP = promisify(exec);
const execFileP = promisify(execFile);

/**
 * Phase 1 inline trace view: input box → execute `freemaxxing trace <id>` →
 * formatted result shown in a dedicated output channel (no terminal dump).
 *
 * `revive` uses the same input-box pattern and result channel.
 */
export class TraceView {
  private outputChannel: vscode.OutputChannel;
  private traceHistory = new Map<string, number>(); // id → last run ts

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('FreeMaxxing Trace');
  }

  /**
   * Show an input box asking for a request ID, then run `freemaxxing trace <id>`
   * and render the formatted result inline.
   */
  show(cliPath: () => string): void {
    const input = vscode.window.createInputBox();
    input.title = 'Trace a Request';
    input.placeholder = 'Enter request ID (e.g. 8f3a9c…)';
    input.prompt = 'Paste a FreeMaxxing request ID to see routing details.';
    input.ignoreFocusOut = true;

    input.onDidAccept(() => {
      const value = input.value.trim();
      if (!value) {
        input.validationMessage = 'Please enter a request ID.';
        return;
      }
      // Request IDs look like hex uuids; warn early on obviously wrong input
      // but don't hard-block (trace accepts various id forms upstream).
      input.hide();
      void this.runTrace(cliPath(), value);
    });

    input.onDidHide(() => input.dispose());
    input.show();
  }

  /**
   * Show an input box asking for a model or provider to revive, then run
   * `freemaxxing revive <id>` and show the result inline.
   */
  showRevive(cliPath: () => string): void {
    const input = vscode.window.createInputBox();
    input.title = 'Revive a Model or Provider';
    input.placeholder = 'Enter model or provider ID (e.g. groq::gpt-oss-120b)';
    input.prompt = 'Reset cooldown/exhausted state for a model or provider.';
    input.ignoreFocusOut = true;

    input.onDidAccept(() => {
      const value = input.value.trim();
      if (!value) {
        input.validationMessage = 'Please enter a model or provider ID.';
        return;
      }
      input.hide();
      void this.runRevive(cliPath(), value);
    });

    input.onDidHide(() => input.dispose());
    input.show();
  }

  dispose(): void {
    this.outputChannel.dispose();
    this.traceHistory.clear();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async runTrace(cliPath: string, requestId: string): Promise<void> {
    this.outputChannel.show(true);
    this.outputChannel.appendLine(`——— freemaxxing trace ${requestId} ———`);
    this.outputChannel.appendLine('');

    try {
      const result = await this.runCli(cliPath, ['trace', requestId]);
      const raw = formatCliOutput(result.stdout || result.stderr);
      this.outputChannel.appendLine(raw);

      // Parse and display routing summary
      const servedBy = parseServedBy(raw);
      if (servedBy) {
        this.outputChannel.appendLine(`--- Served by: ${servedBy} ---`);
      }

      // Count routing attempts (approximate by counting model entries)
      const attemptCount = (raw.match(/model:/gi) || []).length;
      if (attemptCount > 1) {
        this.outputChannel.appendLine(`--- Routing attempts: ${attemptCount} ---`);
      }
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        this.outputChannel.appendLine(
          `FreeMaxxing CLI not found (${cliPath}). Install it or set \`freemaxxing.cliPath\` in settings.`
        );
        this.promptCliNotFound(cliPath);
      } else {
        this.outputChannel.appendLine(`Failed to run trace: ${err?.message ?? err}`);
      }
    }
    this.outputChannel.appendLine('');

    this.traceHistory.set(requestId, Date.now());
  }

  private async runRevive(cliPath: string, modelOrProvider: string): Promise<void> {
    this.outputChannel.show(true);
    this.outputChannel.appendLine(`——— freemaxxing revive ${modelOrProvider} ———`);
    this.outputChannel.appendLine('');

    try {
      const result = await this.runCli(cliPath, ['revive', modelOrProvider]);
      const raw = formatCliOutput(result.stdout || result.stderr);
      this.outputChannel.appendLine(raw);

      // Parse and display routing summary
      const servedBy = parseServedBy(raw);
      if (servedBy) {
        this.outputChannel.appendLine(`--- Served by: ${servedBy} ---`);
      }
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        this.outputChannel.appendLine(
          `FreeMaxxing CLI not found (${cliPath}). Install it or set \`freemaxxing.cliPath\` in settings.`
        );
        this.promptCliNotFound(cliPath);
      } else {
        this.outputChannel.appendLine(`Failed to run revive: ${err?.message ?? err}`);
      }
    }
    this.outputChannel.appendLine('');

    this.traceHistory.set(modelOrProvider, Date.now());
  }

  private promptCliNotFound(cliPath: string): void {
    vscode.window
      .showErrorMessage(
        'FreeMaxxing CLI not found. Install it or set `freemaxxing.cliPath` in settings.',
        'Open Settings',
        'Install Instructions'
      )
      .then((selection) => {
        if (selection === 'Open Settings') {
          void vscode.commands.executeCommand('workbench.action.openSettings', 'freemaxxing.cliPath');
        } else if (selection === 'Install Instructions') {
          void vscode.env.openExternal(
            vscode.Uri.parse('https://github.com/miiidev/freemaxxing#installation')
          );
        }
      });
  }

  /** Cross-platform CLI invocation (same strategy as HealthCheck.runCli). */
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
}