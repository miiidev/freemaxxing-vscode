import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
  * Opens or scaffolds `~/.freemaxxing/config.json`.
  *
  * If the file doesn't exist, creates a scaffold with default content and
  * opens it as an untitled document (with a save hint).
  */
export class ConfigEditor {
  private readonly configDir: string;
  private readonly configPath: string;

  constructor() {
    this.configDir = path.join(os.homedir(), '.freemaxxing');
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
        'A scaffold config file has been created at ~/.freemaxxing/config.json. Edit and save it as needed.'
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
      annotateResponses: true,
      harvest: true,
      modelLimits: {},
      providerLimits: {},
      reliability: {
        windowSize: 50,
        minSamples: 5,
        demoteBelow: 0.3,
      },
      aliases: {
        'auto/coding': {
          tags: ['coding'],
          requireTools: true,
        },
        'auto/fast': {
          preferSpeed: true,
        },
        'auto/any': {},
      },
      // Local LLM (Ollama/llama.cpp) - uncomment to enable:
      // localModels: ["llama3.2:latest"],
      // localBaseURL: "http://localhost:11434/v1",
    };

    fs.writeFileSync(this.configPath, JSON.stringify(scaffold, null, 2), 'utf-8');
  }
}
