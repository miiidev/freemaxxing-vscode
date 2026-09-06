import * as vscode from 'vscode';

/**
 * Run one-shot FreeMaxxing CLI commands in the VS Code integrated terminal.
 *
 * `serve` is piped as a child process (see ProcessManager) so its stdout can
 * be parsed; every other CLI command (`setup`, `export-stats`, …) is
 * one-shot and interactive (`setup` shows prompts / opens a browser tab), so
 * it runs in an integrated terminal instead of being piped (spec §6.3).
 */
export class TerminalRunner {
  private terminals = new Map<string, vscode.Terminal>();

  /**
   * Execute a FreeMaxxing CLI command in a named, reused terminal.
   *
   * @param commandId - unique id for the terminal (e.g. "freemaxxing.setup")
   * @param command - CLI arguments after the binary (e.g. "setup")
   * @param options  - cliPath override; optional hint appended as a comment
   *                   line (used for the Windows PowerShell `$env:` gotcha)
   */
  run(
    commandId: string,
    command: string,
    options: { cliPath: string; hint?: string }
  ): void {
    const { cliPath, hint } = options;

    let cmd = `${cliPath} ${command}`;
    if (hint) {
      cmd += `\n# ${hint}`;
    }

    let terminal = this.terminals.get(commandId);
    if (!terminal || terminal.exitStatus !== undefined) {
      terminal = vscode.window.createTerminal({
        name: `FreeMaxxing: ${commandId.replace('freemaxxing.', '')}`,
        iconPath: new vscode.ThemeIcon('zap'),
      });
      this.terminals.set(commandId, terminal);
    }

    terminal.show();
    terminal.sendText(cmd);
  }

  /** Dispose all tracked terminals. */
  dispose(): void {
    for (const terminal of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
  }
}