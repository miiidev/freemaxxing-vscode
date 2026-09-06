import * as vscode from 'vscode';
import { getIntegrations, getInstalledIntegrations, IntegrationTarget, FreemaxxingEndpoint, detectAndShowIntegrationPicker } from './index';
import { buildEndpointConfig } from '../parsers';

export async function pointExtensionAtFreemaxxing(
  getConfig: () => vscode.WorkspaceConfiguration,
  cliPath: () => string
): Promise<void> {
  const host = getConfig().get<string>('host', '127.0.0.1');
  const port = getConfig().get<number>('port', 8787);
  const alias = getConfig().get<string>('defaultAlias', 'auto/coding');

  const endpoint: FreemaxxingEndpoint = {
    apiBase: `http://${host}:${port}/v1`,
    apiKey: 'anything', // FreeMaxxing doesn't validate client keys
    model: alias,
  };

  const installed = getInstalledIntegrations();
  if (installed.length === 0) {
    void vscode.window.showInformationMessage(
      'No supported AI extensions (Continue, Cline, Roo Code) detected. Install one first.'
    );
    return;
  }

  if (installed.length === 1) {
    await applyToTarget(installed[0], endpoint);
    return;
  }

  const selected = await detectAndShowIntegrationPicker();
  if (selected) {
    await applyToTarget(selected, endpoint);
  }
}

async function applyToTarget(target: IntegrationTarget, endpoint: FreemaxxingEndpoint): Promise<void> {
  try {
    const original = await target.readConfig();
    const merged = (target.mergeFreemaxxingConfig ?? target.mergeMaxoutConfig)(original, endpoint);

    const origStr = JSON.stringify(original);
    const mergedStr = JSON.stringify(merged);

    if (origStr === mergedStr) {
      void vscode.window.showInformationMessage(
        `${target.name} already has FreeMaxxing configured.`
      );
      return;
    }

    await target.writeConfig(merged);

    if (target.openConfigDiff) {
      await target.openConfigDiff(original, merged);
    } else {
      void vscode.window.showInformationMessage(
        `${target.name} updated with FreeMaxxing endpoint.`
      );
    }
  } catch (err: any) {
    void vscode.window.showErrorMessage(
      `Failed to configure ${target.name}: ${err?.message ?? err}`
    );
  }
}

export function getAvailableIntegrations(): IntegrationTarget[] {
  return getIntegrations();
}

export function getInstalledIntegrationNames(): string[] {
  return getInstalledIntegrations().map(t => t.name);
}

// Backward compat alias
export const pointExtensionAtMaxout = pointExtensionAtFreemaxxing;
export type MaxoutEndpoint = FreemaxxingEndpoint;