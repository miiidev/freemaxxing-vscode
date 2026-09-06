import * as vscode from 'vscode';

export type { IntegrationTarget, FreemaxxingEndpoint, MaxoutEndpoint } from './types';
export { registerIntegration, getIntegrations, getInstalledIntegrations, getIntegrationById } from './types';

export { pointExtensionAtFreemaxxing, pointExtensionAtMaxout, getAvailableIntegrations, getInstalledIntegrationNames } from './commands';

export async function detectAndShowIntegrationPicker() {
  const { getIntegrations } = await import('./types');
  const installed = getIntegrations().filter((t) => t.isInstalled());
  if (installed.length === 0) {
    void vscode.window.showInformationMessage(
      'No supported AI extensions (Continue, Cline, Roo Code) detected.'
    );
    return undefined;
  }

  const items = installed.map((t) => ({
    label: t.name,
    description: `Extension ID: ${t.extensionId}`,
    target: t,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select an AI extension to point at FreeMaxxing',
  });

  return selected?.target;
}

// Side-effect imports: adapters call registerIntegration from './index'
// which re-exports from './types'. By the time these execute,
// './types' is fully loaded (its const TARGETS = [] is initialized).
require('./continue');
require('./cline');
require('./rooCode');
