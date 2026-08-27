import * as vscode from 'vscode';

/**
 * Manages the Maxout status bar item.
 *
 * Renders current server state (unknown / down / up / cooldown) and shows
 * last served-by model in the tooltip. The item itself is a clickable command
 * button that opens the maxout menu.
 */
export class StatusBar {
  private item: vscode.StatusBarItem;
  private _up = false;
  private _lastServedBy: string | undefined;
  private _state: 'unknown' | 'loading' | 'down' | 'up' = 'unknown';
  private _cooldownModels: string[] = [];

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.item.name = 'Maxout';
    this.item.show();
  }

  // -----------------------------------------------------------------------
  // State setters
  // -----------------------------------------------------------------------

  /** Set the overall state (unknown / loading / down / up). */
  setState(state: 'unknown' | 'loading' | 'down' | 'up'): void {
    this._state = state;
    this.render();
  }

  /** Set the last served-by model from the health check or process output. */
  setLastServedBy(model: string): void {
    this._lastServedBy = model;
    this._state = 'up';
    this.render();
  }

  /** Update server-up state from the health check. */
  setServerUp(up: boolean): void {
    this._up = up;
    if (up) {
      this._state = 'up';
    } else {
      this._state = 'down';
    }
    this.render();
  }

  /** Set the command that runs when the status bar is clicked. */
  setCommand(command: string): void {
    this.item.command = command;
  }

  /** Set models currently in cooldown (Phase 1). */
  setCooldownModels(models: string[]): void {
    this._cooldownModels = models;
    this.render();
  }

  /** Dispose of the status bar item. */
  dispose(): void {
    this.item.dispose();
  }

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  private render(): void {
    const hasCooldown = this._cooldownModels.length > 0;

    // If up and there are cooldowns, show warning background
    if (this._up && hasCooldown) {
      this.item.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
    } else {
      this.item.backgroundColor = undefined;
    }

    switch (this._state) {
      case 'unknown':
        this.item.text = '$(sync~spin) Maxout';
        this.item.tooltip = 'Checking...';
        break;

      case 'loading':
        this.item.text = '$(sync~spin) Maxout: starting';
        this.item.tooltip = 'Starting server...';
        break;

      case 'down':
        this.item.text = '$(circle-slash) Maxout: stopped';
        this.item.tooltip = 'Not running. Click to start.';
        break;

      case 'up':
        if (hasCooldown) {
          this.item.text = `$(warning) Maxout: ${this._cooldownModels.length} model(s) cooling down`;
          this.item.tooltip = `Models in cooldown:\n${this._cooldownModels.join('\n')}\n\nClick for options.`;
        } else if (this._lastServedBy) {
          this.item.text = `$(zap) Maxout: ${this._lastServedBy}`;
          this.item.tooltip = `Last served by ${this._lastServedBy}. Click for options.`;
        } else {
          this.item.text = '$(zap) Maxout: running';
          this.item.tooltip = 'Running. Click for options.';
        }
        break;
    }
  }
}
