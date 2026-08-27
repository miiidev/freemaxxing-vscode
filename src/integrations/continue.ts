import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IntegrationTarget, MaxoutEndpoint, registerIntegration } from './types';

interface ContinueConfig {
  models?: ContinueModel[];
  customModels?: ContinueModel[];
  providers?: ContinueProvider[];
  [key: string]: unknown;
}

interface ContinueModel {
  title: string;
  provider: string;
  model: string;
  apiBase?: string;
  apiKey?: string;
  [key: string]: unknown;
}

interface ContinueProvider {
  name: string;
  apiBase?: string;
  apiKey?: string;
  models?: string[];
  [key: string]: unknown;
}

const CONTINUE_EXTENSION_ID = 'continue.continue';

function getContinueConfigPaths(): string[] {
  const paths: string[] = [];

  // Workspace config
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      paths.push(path.join(folder.uri.fsPath, '.continue', 'config.json'));
    }
  }

  // Global config
  const homeDir = os.homedir();
  paths.push(path.join(homeDir, '.continue', 'config.json'));

  // VS Code user data (for portable installs)
  const userDataDir = vscode.env.appRoot;
  if (userDataDir) {
    paths.push(path.join(userDataDir, '..', 'data', 'User', 'globalStorage', 'continue.continue', 'config.json'));
  }

  return paths;
}

function findExistingConfig(): string | undefined {
  for (const p of getContinueConfigPaths()) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

function readJsonFile(filePath: string): ContinueConfig {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as ContinueConfig;
  } catch {
    return {};
  }
}

function writeJsonFile(filePath: string, config: ContinueConfig): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
}

function ensureConfigStructure(config: ContinueConfig): ContinueConfig {
  if (!config.models) { config.models = []; }
  if (!config.customModels) { config.customModels = []; }
  if (!config.providers) { config.providers = []; }
  return config;
}

const continueTarget: IntegrationTarget = {
  id: 'continue',
  name: 'Continue',
  extensionId: CONTINUE_EXTENSION_ID,

  isInstalled(): boolean {
    return vscode.extensions.getExtension(CONTINUE_EXTENSION_ID) !== undefined;
  },

  getConfigPath(): string | undefined {
    return findExistingConfig();
  },

  async readConfig(): Promise<ContinueConfig> {
    const configPath = this.getConfigPath();
    if (!configPath) {
      // Return empty config with structure
      return ensureConfigStructure({});
    }
    return readJsonFile(configPath);
  },

  async writeConfig(config: unknown): Promise<void> {
    const configPath = this.getConfigPath();
    if (!configPath) {
      // Create in workspace if available, else global
      const workspaceFolders = vscode.workspace.workspaceFolders;
      const targetPath = workspaceFolders
        ? path.join(workspaceFolders[0].uri.fsPath, '.continue', 'config.json')
        : path.join(os.homedir(), '.continue', 'config.json');
      writeJsonFile(targetPath, config as ContinueConfig);
      return;
    }
    writeJsonFile(configPath, config as ContinueConfig);
  },

  mergeMaxoutConfig(config: unknown, endpoint: MaxoutEndpoint): unknown {
    const cfg = ensureConfigStructure(config as ContinueConfig);

    // Check if Maxout provider already exists
    const maxoutProviderIndex = cfg.providers!.findIndex(
      (p) => p.name === 'maxout' || (p.apiBase && p.apiBase.includes('8787'))
    );

    const newProvider: ContinueProvider = {
      name: 'maxout',
      apiBase: endpoint.apiBase,
      apiKey: endpoint.apiKey,
      models: [endpoint.model],
    };

    if (maxoutProviderIndex >= 0) {
      cfg.providers![maxoutProviderIndex] = newProvider;
    } else {
      cfg.providers!.push(newProvider);
    }

    // Also add as a custom model for easy selection
    const modelExists = cfg.customModels!.some(
      (m) => m.title === 'Maxout' && m.apiBase === endpoint.apiBase
    );
    if (!modelExists) {
      cfg.customModels!.push({
        title: 'Maxout',
        provider: 'maxout',
        model: endpoint.model,
        apiBase: endpoint.apiBase,
        apiKey: endpoint.apiKey,
      });
    }

    return cfg;
  },

  async openConfigDiff(original: unknown, merged: unknown): Promise<void> {
    const originalStr = JSON.stringify(original, null, 2);
    const mergedStr = JSON.stringify(merged, null, 2);

    if (originalStr === mergedStr) {
      void vscode.window.showInformationMessage('Continue config already has Maxout configured.');
      return;
    }

    const doc = await vscode.workspace.openTextDocument({
      content: mergedStr,
      language: 'json',
    });
    await vscode.window.showTextDocument(doc, { preview: false });
    void vscode.window.showInformationMessage(
      'Continue config updated with Maxout. Review and save the file.'
    );
  },
};

registerIntegration(continueTarget);
export { continueTarget };