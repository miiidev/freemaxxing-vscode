export interface IntegrationTarget {
  id: string;
  name: string;
  extensionId: string;
  isInstalled(): boolean;
  getConfigPath(): string | undefined;
  readConfig(): Promise<unknown>;
  writeConfig(config: unknown): Promise<void>;
  mergeMaxoutConfig(config: unknown, endpoint: FreemaxxingEndpoint): unknown;
  mergeFreemaxxingConfig?: (config: unknown, endpoint: FreemaxxingEndpoint) => unknown;
  openConfigDiff?(original: unknown, merged: unknown): Promise<void>;
}

export interface FreemaxxingEndpoint {
  apiBase: string;
  apiKey: string;
  model: string;
}

// Backward compat alias
export type MaxoutEndpoint = FreemaxxingEndpoint;

export interface IntegrationResult {
  target: IntegrationTarget;
  success: boolean;
  message: string;
  configPath?: string;
}

const TARGETS: IntegrationTarget[] = [];

export function registerIntegration(target: IntegrationTarget): void {
  TARGETS.push(target);
}

export function getIntegrations(): IntegrationTarget[] {
  return TARGETS;
}

export function getInstalledIntegrations(): IntegrationTarget[] {
  return TARGETS.filter((t) => t.isInstalled());
}

export function getIntegrationById(id: string): IntegrationTarget | undefined {
  return TARGETS.find((t) => t.id === id);
}