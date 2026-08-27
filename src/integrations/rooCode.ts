import * as vscode from 'vscode';
import { IntegrationTarget, MaxoutEndpoint, registerIntegration } from './types';

interface RooCodeSettings {
  apiProvider?: string;
  apiModel?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  openAiApiBaseUrl?: string;
  openAiApiKey?: string;
  openAiModel?: string;
  [key: string]: unknown;
}

const ROO_CODE_EXTENSION_ID = 'roo-code.roo-code';

const rooCodeTarget: IntegrationTarget = {
  id: 'rooCode',
  name: 'Roo Code',
  extensionId: ROO_CODE_EXTENSION_ID,

  isInstalled(): boolean {
    return vscode.extensions.getExtension(ROO_CODE_EXTENSION_ID) !== undefined;
  },

  getConfigPath(): string | undefined {
    return 'vscode-settings://roo-code';
  },

  async readConfig(): Promise<RooCodeSettings> {
    const config = vscode.workspace.getConfiguration('roo-code');
    return {
      apiProvider: config.get<string>('apiProvider'),
      apiModel: config.get<string>('apiModel'),
      apiBaseUrl: config.get<string>('apiBaseUrl'),
      apiKey: config.get<string>('apiKey'),
      openAiApiBaseUrl: config.get<string>('openAiApiBaseUrl'),
      openAiApiKey: config.get<string>('openAiApiKey'),
      openAiModel: config.get<string>('openAiModel'),
    };
  },

  async writeConfig(config: unknown): Promise<void> {
    const cfg = config as RooCodeSettings;
    const wsConfig = vscode.workspace.getConfiguration('roo-code');

    const updates: [string, unknown][] = [];

    if (cfg.apiProvider !== undefined) { updates.push(['apiProvider', cfg.apiProvider]); }
    if (cfg.apiModel !== undefined) { updates.push(['apiModel', cfg.apiModel]); }
    if (cfg.apiBaseUrl !== undefined) { updates.push(['apiBaseUrl', cfg.apiBaseUrl]); }
    if (cfg.apiKey !== undefined) { updates.push(['apiKey', cfg.apiKey]); }
    if (cfg.openAiApiBaseUrl !== undefined) { updates.push(['openAiApiBaseUrl', cfg.openAiApiBaseUrl]); }
    if (cfg.openAiApiKey !== undefined) { updates.push(['openAiApiKey', cfg.openAiApiKey]); }
    if (cfg.openAiModel !== undefined) { updates.push(['openAiModel', cfg.openAiModel]); }

    for (const [key, value] of updates) {
      await wsConfig.update(key, value, vscode.ConfigurationTarget.Workspace);
    }
  },

  mergeMaxoutConfig(config: unknown, endpoint: MaxoutEndpoint): unknown {
    const cfg = (config as RooCodeSettings) || {};

    // Roo Code uses OpenAI-compatible API settings
    cfg.openAiApiBaseUrl = endpoint.apiBase;
    cfg.openAiApiKey = endpoint.apiKey;
    cfg.openAiModel = endpoint.model;
    cfg.apiProvider = 'openai';
    cfg.apiModel = endpoint.model;
    cfg.apiBaseUrl = endpoint.apiBase;
    cfg.apiKey = endpoint.apiKey;

    return cfg;
  },

  async openConfigDiff(original: unknown, merged: unknown): Promise<void> {
    const origStr = JSON.stringify(original, null, 2);
    const mergedStr = JSON.stringify(merged, null, 2);

    if (origStr === mergedStr) {
      void vscode.window.showInformationMessage('Roo Code already has Maxout configured in settings.');
      return;
    }

    const doc = await vscode.workspace.openTextDocument({
      content: mergedStr,
      language: 'json',
    });
    await vscode.window.showTextDocument(doc, { preview: false });
    void vscode.window.showInformationMessage(
      'Roo Code settings updated with Maxout. Review and save the workspace settings.json.'
    );
  },
};

registerIntegration(rooCodeTarget);
export { rooCodeTarget };