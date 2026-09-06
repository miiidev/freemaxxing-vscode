import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProcessManager } from './processManager';
import { HealthCheck } from './healthCheck';
import { StatusBar } from './statusBar';
import { DashboardProvider } from './dashboardProvider';
import { TraceView } from './traceView';
import { ConfigEditor } from './configEditor';
import { TerminalRunner } from './terminalRunner';
import { buildEndpointConfig, isCoolingDown, StatusRow } from './parsers';
import { pointExtensionAtFreemaxxing, pointExtensionAtMaxout } from './integrations';

let processManager: ProcessManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  // -----------------------------------------------------------------------
  // Module wiring
  // -----------------------------------------------------------------------
  const outputChannel = vscode.window.createOutputChannel('FreeMaxxing');
  context.subscriptions.push(outputChannel);

  processManager = new ProcessManager();
  const pm = processManager;
  const healthCheck = new HealthCheck();
  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  const dashboardProvider = new DashboardProvider(context.extensionUri);
  const traceView = new TraceView();
  const configEditor = new ConfigEditor();
  const terminalRunner = new TerminalRunner();
  context.subscriptions.push(traceView, terminalRunner);

  const getConfig = () => vscode.workspace.getConfiguration('freemaxxing');
  const cliPath = () => getConfig().get<string>('cliPath', 'freemaxxing');

  // -----------------------------------------------------------------------
  // Output channel: server stdout/stderr
  // -----------------------------------------------------------------------
  pm.onOutput((text) => outputChannel.append(text));

  // -----------------------------------------------------------------------
  // Status bar: server state, served-by, cooldown models
  // -----------------------------------------------------------------------
  statusBar.setCommand('freemaxxing.menu');
  statusBar.setState('unknown');

  healthCheck.onStateChange((up, servedBy) => {
    statusBar.setServerUp(up);
    dashboardProvider.updateServerState(up);
    if (servedBy) {
      statusBar.setLastServedBy(servedBy);
    }
    if (up) {
      // Server transitioned to up (possibly started outside this window):
      // kick a dashboard refresh so the view is not stale.
      void refreshDashboardData(true);
      maybeCelebrateSetup(up);
    }
  });

  pm.onServedBy((model) => {
    statusBar.setLastServedBy(model);
    dashboardProvider.updateServerState(true);
  });

  // -----------------------------------------------------------------------
  // Process lifecycle: crash / spawn-failure notifications (§8.4)
  // -----------------------------------------------------------------------
  pm.onExit((code) => {
    if (pm.wasUserInitiatedStop()) {
      outputChannel.appendLine('[FreeMaxxing] Server stopped by user.');
      return;
    }
    if (code !== null && code !== 0) {
      void vscode.window
        .showErrorMessage(
          `FreeMaxxing stopped unexpectedly (exit code ${code}).`,
          'Show Output',
          'Restart'
        )
        .then((selection) => {
          if (selection === 'Show Output') {
            outputChannel.show();
          } else if (selection === 'Restart') {
            void vscode.commands.executeCommand('freemaxxing.start');
          }
        });
    }
  });

  pm.onSpawnError((err) => {
    dashboardProvider.updateServerState(false);
    if (err.code === 'ENOENT') {
      void vscode.window
        .showErrorMessage(
          `FreeMaxxing CLI not found (${cliPath()}). Install it or set \`freemaxxing.cliPath\` in settings.`,
          'Open Settings',
          'Install Instructions'
        )
        .then((selection) => {
          if (selection === 'Open Settings') {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'freemaxxing.cliPath');
          } else if (selection === 'Install Instructions') {
            void vscode.env.openExternal(
              vscode.Uri.parse('https://github.com/miiidev/freemaxxing#installation')
            );
          }
        });
    } else {
      void vscode.window.showErrorMessage(`Failed to start FreeMaxxing: ${err.message}`);
    }
  });

  // -----------------------------------------------------------------------
  // Dashboard refresh: heavy `status --reliability` spawn only while the
  // webview is visible (spec §14 back-off).
  // -----------------------------------------------------------------------
  let dashboardTimer: ReturnType<typeof setInterval> | null = null;

  function refreshDashboardData(quiet = false): Promise<void> {
    outputChannel.appendLine(`[FreeMaxxing] Dashboard refresh: starting (quiet=${quiet})`);
    return healthCheck
      .fetchStatusReliability(cliPath())
      .then((rows) => {
        outputChannel.appendLine(`[FreeMaxxing] Dashboard refresh: got ${rows.length} rows`);
        dashboardProvider.updateData(rows);
        checkCooldownWarnings(rows);
        // First-run CTA: no rows AND no `.env` with keys yet (spec §8.3).
        const envPath = path.join(os.homedir(), '.freemaxxing', '.env');
        const noKeys = !fs.existsSync(envPath);
        dashboardProvider.setSetupCta(rows.length === 0 && noKeys);
      })
      .catch((err) => {
        outputChannel.appendLine(`[FreeMaxxing] Dashboard refresh failed: ${err?.message ?? err}`);
        if (!quiet) {
          // Already logged above
        }
      });
  }

  function ensureDashboardPolling(): void {
    if (dashboardTimer) { return; }
    const intervalMs = getConfig().get<number>('dashboardRefreshMs', 5000);
    void refreshDashboardData(true);
    dashboardTimer = setInterval(() => {
      if (!dashboardProvider.isVisible()) {
        stopDashboardPolling();
        return;
      }
      void refreshDashboardData(true);
    }, intervalMs);
  }

  function stopDashboardPolling(): void {
    if (dashboardTimer) {
      clearInterval(dashboardTimer);
      dashboardTimer = null;
    }
  }

  dashboardProvider.onDidChangeVisibility((visible) => {
    if (visible) {
      ensureDashboardPolling();
    } else {
      stopDashboardPolling();
    }
  });

  dashboardProvider.onRefresh(() => {
    outputChannel.appendLine('[FreeMaxxing] Dashboard refresh button clicked');
    void refreshDashboardData(false);
  });

  // -----------------------------------------------------------------------
  // Cooldown warnings (Phase 1, §8.4). Debounced: only fires when new
  // models enter cooldown since the last refresh (state snapshot compare).
  // -----------------------------------------------------------------------
  let lastCooldownSnapshot = new Set<string>();

  function checkCooldownWarnings(rows: StatusRow[]) {
    const cooling = rows.filter((m) => isCoolingDown(m.state));
    const modelIds = cooling.map((m) => m.model);
    statusBar.setCooldownModels(modelIds);

    const newlyCooling = modelIds.filter((id) => !lastCooldownSnapshot.has(id));
    lastCooldownSnapshot = new Set(modelIds);

    if (!getConfig().get<boolean>('warnOnCooldown', true)) { return; }
    if (newlyCooling.length === 0) { return; }

    const defaultAlias = getConfig().get<string>('defaultAlias', 'auto/coding');
    void vscode.window
      .showWarningMessage(
        `\`${defaultAlias}\` is running low on options: ${newlyCooling.length} model(s) in cooldown/exhausted.`,
        'Show Dashboard'
      )
      .then((selection) => {
        if (selection === 'Show Dashboard') {
void vscode.commands.executeCommand('workbench.view.extension.freemaxxing');
        }
      });
  }

  // -----------------------------------------------------------------------
  // First-setup success celebration (only once per setup invocation).
  // -----------------------------------------------------------------------
  let setupPendingAt = 0;
  let setupCelebrated = false;

  function maybeCelebrateSetup(up: boolean): void {
    if (!up || setupPendingAt === 0 || setupCelebrated) { return; }
    if (Date.now() - setupPendingAt > 120_000) { return; }
    setupCelebrated = true;
    void vscode.window
      .showInformationMessage(
        'FreeMaxxing is configured and running.',
        'Copy Endpoint Config'
      )
      .then((sel) => {
        if (sel === 'Copy Endpoint Config') {
          copyEndpoint();
        }
      });
  }

  // -----------------------------------------------------------------------
  // Commands
  // -----------------------------------------------------------------------

  function startServer() {
    const pmLocal = processManager!;
    if (pmLocal.isRunning()) {
      void vscode.window.showInformationMessage(
        'FreeMaxxing server is already running (started by this window).'
      );
      return;
    }
    const trace = getConfig().get<boolean>('trace', true);
    outputChannel.appendLine(`[FreeMaxxing] Starting: ${cliPath()} serve${trace ? ' --trace' : ''}`);
    pmLocal.start(cliPath(), { trace });
    statusBar.setState('loading');
  }

  function stopServer() {
    const pmLocal = processManager!;
    if (pmLocal.isRunning()) {
      pmLocal.stop();
      return;
    }
    if (healthCheck.isUp()) {
      void vscode.window.showInformationMessage(
        'FreeMaxxing server is running but was started outside this window. To stop it, kill the `freemaxxing serve` process in your terminal or task manager.'
      );
    } else {
      void vscode.window.showInformationMessage('FreeMaxxing server is not running.');
    }
  }

  function restartServer() {
    const pmLocal = processManager!;
    if (pmLocal.isRunning()) {
      pmLocal.stop();
      setTimeout(() => startServer(), 600);
    } else if (healthCheck.isUp()) {
      void vscode.window.showInformationMessage(
        'FreeMaxxing server is running, but this window did not start it, so it cannot be restarted from here.'
      );
    } else {
      startServer();
    }
  }

  function showMenu() {
    const items: vscode.QuickPickItem[] = [];
    const owned = processManager!.isRunning();
    const up = healthCheck.isUp();

    if (owned) {
      items.push(
        { label: '$(debug-stop) Stop Server', description: 'Stop the FreeMaxxing server process' },
        { label: '$(refresh) Restart Server', description: 'Stop and start the server again' },
      );
    } else if (up) {
      items.push({
        label: '$(debug-stop) Stop Server',
        description: 'Started outside this window — cannot be stopped from here',
      });
    } else {
      items.push({ label: '$(play) Start Server', description: 'Launch `freemaxxing serve [--trace]`' });
    }

    items.push(
      { label: '$(dashboard) Show Dashboard', description: 'Quota and reliability view' },
      { label: '$(search) Trace a Request', description: 'Look up routing details for a request ID' },
      { label: '$(tools) Run Setup Wizard', description: 'Interactive provider key setup' },
      { label: '$(clippy) Copy Endpoint Config', description: 'Copy `{apiBase, apiKey, model}` JSON' },
      { label: '$(gear) Open Config File', description: 'Open ~/.freemaxxing/config.json' },
      { label: '$(export) Export Reliability Stats', description: 'Export to freemaxxing-stats.json' },
      { label: '$(plug) Point Extension at FreeMaxxing', description: 'Configure Continue/Cline/Roo Code to use FreeMaxxing' },
      { label: '$(list-unordered) Show Providers', description: 'List provider status (enabled/disabled, key present)' },
      { label: '$(circle-slash) Disable Provider', description: 'Disable a provider in config.json' },
      { label: '$(add) Enable Provider', description: 'Enable a provider in config.json' },
    );

    void vscode.window.showQuickPick(items, { placeHolder: 'FreeMaxxing' }).then((sel) => {
      if (!sel) { return; }
      const label = sel.label;
      if (label.includes('Start Server')) { startServer(); }
      else if (label.includes('Restart Server')) { restartServer(); }
      else if (label.includes('Stop Server')) { stopServer(); }
      else if (label.includes('Show Dashboard')) { void vscode.commands.executeCommand('workbench.view.extension.freemaxxing'); }
      else if (label.includes('Trace a Request')) { traceView.show(cliPath); }
      else if (label.includes('Setup Wizard')) { runSetup(); }
      else if (label.includes('Copy Endpoint')) { copyEndpoint(); }
      else if (label.includes('Config File')) { void configEditor.open(); }
      else if (label.includes('Export')) { exportStats(); }
      else if (label.includes('Point Extension')) { void pointExtensionAtFreemaxxing(getConfig, cliPath); }
      else if (label.includes('Show Providers')) { showProviders(); }
      else if (label.includes('Disable Provider')) { disableProvider(); }
      else if (label.includes('Enable Provider')) { enableProvider(); }
    });
  }

  function runSetup() {
    const isWin = process.platform === 'win32';
    terminalRunner.run('freemaxxing.setup', 'setup', {
      cliPath: cliPath(),
      hint: isWin
        ? 'Tip: in PowerShell, set keys with `$env:NAME = "value"` (not `set NAME=value`).'
        : undefined,
    });

    // Arm the first-setup celebration.
    setupPendingAt = Date.now();
    setupCelebrated = false;
  }

  function exportStats() {
    terminalRunner.run('freemaxxing.exportStats', 'export-stats --out freemaxxing-stats.json', {
      cliPath: cliPath(),
    });
  }

  function copyEndpoint() {
    const host = getConfig().get<string>('host', '127.0.0.1');
    const port = getConfig().get<number>('port', 8787);
    const alias = getConfig().get<string>('defaultAlias', 'auto/coding');
    const snippet = buildEndpointConfig(host, port, alias);
    void vscode.env.clipboard.writeText(snippet);
    void vscode.window.showInformationMessage(
      'Endpoint config copied to clipboard. Note: FreeMaxxing does not check client keys — `apiKey: "anything"` is a placeholder, not a real secret.'
    );
  }

  function showProviders() {
    terminalRunner.run('freemaxxing.providers', 'providers', { cliPath: cliPath() });
  }

  async function disableProvider() {
    const provider = await vscode.window.showInputBox({
      title: 'Disable Provider',
      prompt: 'Enter provider name (openrouter, groq, google, mistral, cerebras, local)',
      placeHolder: 'groq',
    });
    if (!provider) { return; }
    terminalRunner.run('freemaxxing.disable', `disable ${provider}`, { cliPath: cliPath() });
  }

  async function enableProvider() {
    const provider = await vscode.window.showInputBox({
      title: 'Enable Provider',
      prompt: 'Enter provider name (openrouter, groq, google, mistral, cerebras, local)',
      placeHolder: 'groq',
    });
    if (!provider) { return; }
    terminalRunner.run('freemaxxing.enable', `enable ${provider}`, { cliPath: cliPath() });
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('freemaxxing.menu', showMenu),
    vscode.commands.registerCommand('freemaxxing.start', startServer),
    vscode.commands.registerCommand('freemaxxing.stop', stopServer),
    vscode.commands.registerCommand('freemaxxing.restart', restartServer),
    // Phase 1: "Show Status" opens the dashboard instead of a terminal dump.
    vscode.commands.registerCommand('freemaxxing.status', () =>
      void vscode.commands.executeCommand('workbench.view.extension.freemaxxing')
    ),
    vscode.commands.registerCommand('freemaxxing.setup', runSetup),
    vscode.commands.registerCommand('freemaxxing.trace', () => traceView.show(cliPath)),
    vscode.commands.registerCommand('freemaxxing.revive', () => traceView.showRevive(cliPath)),
    vscode.commands.registerCommand('freemaxxing.openConfig', () => void configEditor.open()),
    vscode.commands.registerCommand('freemaxxing.copyEndpoint', copyEndpoint),
    vscode.commands.registerCommand('freemaxxing.exportStats', exportStats),
    vscode.commands.registerCommand('freemaxxing.pointExtension', () => pointExtensionAtFreemaxxing(getConfig, cliPath)),
    vscode.commands.registerCommand('freemaxxing.showProviders', showProviders),
    vscode.commands.registerCommand('freemaxxing.disableProvider', disableProvider),
    vscode.commands.registerCommand('freemaxxing.enableProvider', enableProvider),
    vscode.window.registerWebviewViewProvider('freemaxxing.dashboard', dashboardProvider),
  );

  // -----------------------------------------------------------------------
  // Config-change handling
  // -----------------------------------------------------------------------
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('freemaxxing')) { return; }
      healthCheck.updateConfig();
      stopDashboardPolling();
      if (dashboardProvider.isVisible()) {
        ensureDashboardPolling();
      }
    })
  );

  // -----------------------------------------------------------------------
  // Bootstrap
  // -----------------------------------------------------------------------
  healthCheck.startPolling();
  dashboardProvider.updateServerState(false);

  if (getConfig().get<boolean>('autoStart', false)) {
    startServer();
  }
}

export function deactivate() {
  // Kill any owned serve child process so it does not outlive the extension
  // host (spec §10 edge case: "VS Code window closes while server is running").
  if (processManager) {
    processManager.stop();
    processManager = undefined;
  }
}