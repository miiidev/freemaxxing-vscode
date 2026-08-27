import * as vscode from 'vscode';
import { IntegrationTarget, MaxoutEndpoint, registerIntegration } from './types';

interface ClineApiConfig {
  provider: string;
  model: string;
  apiBase?: string;
  apiKey?: string;
  [key: string]: unknown;
}

interface ClineSettings {
  apiConfiguration?: ClineApiConfig;
  apiConfigurations?: ClineApiConfig[];
  [key: string]: unknown;
}

const CLINE_EXTENSION_ID = 'saoudrizwan.claude-dev';

const clineTarget: IntegrationTarget = {
  id: 'cline',
  name: 'Cline',
  extensionId: CLINE_EXTENSION_ID,

  isInstalled(): boolean {
    return vscode.extensions.getExtension(CLINE_EXTENSION_ID) !== undefined;
  },

  getConfigPath(): string | undefined {
    // Cline uses VS Code settings (workspace or user)
    return 'vscode-settings://cline';
  },

  async readConfig(): Promise<ClineSettings> {
    const config = vscode.workspace.getConfiguration('cline');
    return {
      apiConfiguration: config.get<ClineApiConfig>('apiConfiguration'),
      apiConfigurations: config.get<ClineApiConfig[]>('apiConfigurations'),
    };
  },

  async writeConfig(config: unknown): Promise<void> {
    const cfg = config as ClineSettings;
    const wsConfig = vscode.workspace.getConfiguration('cline');

    if (cfg.apiConfiguration) {
      await wsConfig.update('apiConfiguration', cfg.apiConfiguration, vscode.ConfigurationTarget.Workspace);
    }
    if (cfg.apiConfigurations) {
      await wsConfig.update('apiConfigurations', cfg.apiConfigurations, vscode.ConfigurationTarget.Workspace);
    }
  },

  mergeMaxoutConfig(config: unknown, endpoint: MaxoutEndpoint): unknown {
    const cfg = (config as ClineSettings) || {};

    const maxoutConfig: ClineApiConfig = {
      provider: 'openai',
      model: endpoint.model,
      apiBase: endpoint.apiBase,
      apiKey: endpoint.apiKey,
    };

    // Set as primary apiConfiguration
    cfg.apiConfiguration = maxoutConfig;

    // Also add to apiConfigurations array if it exists
    if (Array.isArray(cfg.apiConfigurations)) {
      const idx = cfg.apiConfigurations.findIndex(
        (c) => c.apiBase?.includes('8787') || c.provider === 'maxout'
      );
      if (idx >= 0) {
        cfg.apiConfigurations[idx] = maxoutConfig;
      } else {
        cfg.apiConfigurations.push(maxoutConfig);
      }
    } else {
      cfg.apiConfigurations = [maxoutConfig];
    }

    return cfg;
  },

  async openConfigDiff(original: unknown, merged: unknown): Promise<void> {
    const origStr = JSON.stringify(original, null, 2);
    const mergedStr = JSON.stringify(merged, null, 2);

    if (origStr === mergedStr) {
      void vscode.window.showInformationMessage('Cline already has Maxout configured in settings.');
      return;
    }

    // Open the workspace settings.json for Cline
    const doc = await vscode.workspace.openTextDocument({
      content: mergedStr,
      language: 'json',
    });
    await vscode.window.showTextDocument(doc, { preview: false });
    void vscode.window.showInformationMessage(
      'Cline settings updated with Maxout. Review and save the workspace settings.json.'
    );
  },
};

registerIntegration(clineTarget);
export { clineTarget };