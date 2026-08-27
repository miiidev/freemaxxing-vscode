import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Opens or scaffolds `~/.maxout/config.json`.
 *
 * If the file doesn't exist, creates a scaffold with default content and
 * opens it as an untitled document (with a save hint).
 */
export class ConfigEditor {
  private readonly configDir: string;
  private readonly configPath: string;

  constructor() {
    this.configDir = path.join(os.homedir(), '.maxout');
    this.configPath = path.join(this.configDir, 'config.json');
  }

  /**
   * Open the config file. Scaffolds it if missing.
   */
  async open(): Promise<void> {
    const exists = fs.existsSync(this.configPath);

    if (!exists) {
      // Scaffold the directory and default config
      this.scaffold();
    }

    // Open in editor
    const doc = await vscode.workspace.openTextDocument(this.configPath);
    vscode.window.showTextDocument(doc);

    if (!exists) {
      // Show a save hint
      vscode.window.showInformationMessage(
        'A scaffold config file has been created at ~/.maxout/config.json. Edit and save it as needed.'
      );
    }
  }

  /**
   * Create the scaffold if missing.
   */
  private scaffold(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    const scaffold = {
      host: '127.0.0.1',
      port: 8787,
      aliases: {
        'auto/coding': {
          providers: ['openrouter', 'groq', 'google', 'mistral', 'cerebras'],
          tier: 'premium',
        },
        'auto/fast': {
          providers: ['groq', 'cerebras'],
          tier: 'fast',
        },
        'auto/any': {
          providers: ['openrouter', 'groq', 'google', 'mistral', 'cerebras'],
          tier: 'any',
        },
      },
      harvest: {
        enabled: true,
        intervalMs: 60000,
      },
      modelLimits: {},
      providerLimits: {},
      annotateResponses: true,
      hybrid: {
        enabled: false,
        dailyCapUSD: 0.50,
      },
    };

    fs.writeFileSync(this.configPath, JSON.stringify(scaffold, null, 2), 'utf-8');
  }
}
