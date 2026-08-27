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
import { pointExtensionAtMaxout } from './integrations';

let processManager: ProcessManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  // -----------------------------------------------------------------------
  // Module wiring
  // -----------------------------------------------------------------------
  const outputChannel = vscode.window.createOutputChannel('Maxout');
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

  const getConfig = () => vscode.workspace.getConfiguration('maxout');
  const cliPath = () => getConfig().get<string>('cliPath', 'maxout');

  // -----------------------------------------------------------------------
  // Output channel: server stdout/stderr
  // -----------------------------------------------------------------------
  pm.onOutput((text) => outputChannel.append(text));

  // -----------------------------------------------------------------------
  // Status bar: server state, served-by, cooldown models
  // -----------------------------------------------------------------------
  statusBar.setCommand('maxout.menu');
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
      outputChannel.appendLine('[Maxout] Server stopped by user.');
      return;
    }
    if (code !== null && code !== 0) {
      void vscode.window
        .showErrorMessage(
          `Maxout stopped unexpectedly (exit code ${code}).`,
          'Show Output',
          'Restart'
        )
        .then((selection) => {
          if (selection === 'Show Output') {
            outputChannel.show();
          } else if (selection === 'Restart') {
            void vscode.commands.executeCommand('maxout.start');
          }
        });
    }
  });

  pm.onSpawnError((err) => {
    dashboardProvider.updateServerState(false);
    if (err.code === 'ENOENT') {
      void vscode.window
        .showErrorMessage(
          `Maxout CLI not found (${cliPath()}). Install it or set \`maxout.cliPath\` in settings.`,
          'Open Settings',
          'Install Instructions'
        )
        .then((selection) => {
          if (selection === 'Open Settings') {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'maxout.cliPath');
          } else if (selection === 'Install Instructions') {
            void vscode.env.openExternal(
              vscode.Uri.parse('https://github.com/miiidev/maxout#installation')
            );
          }
        });
    } else {
      void vscode.window.showErrorMessage(`Failed to start Maxout: ${err.message}`);
    }
  });

  // -----------------------------------------------------------------------
  // Dashboard refresh: heavy `status --reliability` spawn only while the
  // webview is visible (spec §14 back-off).
  // -----------------------------------------------------------------------
  let dashboardTimer: ReturnType<typeof setInterval> | null = null;

  function refreshDashboardData(quiet = false): Promise<void> {
    outputChannel.appendLine(`[Maxout] Dashboard refresh: starting (quiet=${quiet})`);
    return healthCheck
      .fetchStatusReliability(cliPath())
      .then((rows) => {
        outputChannel.appendLine(`[Maxout] Dashboard refresh: got ${rows.length} rows`);
        dashboardProvider.updateData(rows);
        checkCooldownWarnings(rows);
        // First-run CTA: no rows AND no `.env` with keys yet (spec §8.3).
        const envPath = path.join(os.homedir(), '.maxout', '.env');
        const noKeys = !fs.existsSync(envPath);
        dashboardProvider.setSetupCta(rows.length === 0 && noKeys);
      })
      .catch((err) => {
        outputChannel.appendLine(`[Maxout] Dashboard refresh failed: ${err?.message ?? err}`);
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
    outputChannel.appendLine('[Maxout] Dashboard refresh button clicked');
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
          void vscode.commands.executeCommand('workbench.view.extension.maxout');
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
        'Maxout is configured and running.',
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
        'Maxout server is already running (started by this window).'
      );
      return;
    }
    const trace = getConfig().get<boolean>('trace', true);
    outputChannel.appendLine(`[Maxout] Starting: ${cliPath()} serve${trace ? ' --trace' : ''}`);
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
        'Maxout server is running but was started outside this window. To stop it, kill the `maxout serve` process in your terminal or task manager.'
      );
    } else {
      void vscode.window.showInformationMessage('Maxout server is not running.');
    }
  }

  function restartServer() {
    const pmLocal = processManager!;
    if (pmLocal.isRunning()) {
      pmLocal.stop();
      setTimeout(() => startServer(), 600);
    } else if (healthCheck.isUp()) {
      void vscode.window.showInformationMessage(
        'Maxout server is running, but this window did not start it, so it cannot be restarted from here.'
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
        { label: '$(debug-stop) Stop Server', description: 'Stop the Maxout server process' },
        { label: '$(refresh) Restart Server', description: 'Stop and start the server again' },
      );
    } else if (up) {
      items.push({
        label: '$(debug-stop) Stop Server',
        description: 'Started outside this window — cannot be stopped from here',
      });
    } else {
      items.push({ label: '$(play) Start Server', description: 'Launch `maxout serve [--trace]`' });
    }

    items.push(
      { label: '$(dashboard) Show Dashboard', description: 'Quota and reliability view' },
      { label: '$(search) Trace a Request', description: 'Look up routing details for a request ID' },
      { label: '$(tools) Run Setup Wizard', description: 'Interactive provider key setup' },
      { label: '$(clippy) Copy Endpoint Config', description: 'Copy `{apiBase, apiKey, model}` JSON' },
      { label: '$(gear) Open Config File', description: 'Open ~/.maxout/config.json' },
      { label: '$(export) Export Reliability Stats', description: 'Export to maxout-stats.json' },
      { label: '$(plug) Point Extension at Maxout', description: 'Configure Continue/Cline/Roo Code to use Maxout' },
    );

    void vscode.window.showQuickPick(items, { placeHolder: 'Maxout' }).then((sel) => {
      if (!sel) { return; }
      const label = sel.label;
      if (label.includes('Start Server')) { startServer(); }
      else if (label.includes('Restart Server')) { restartServer(); }
      else if (label.includes('Stop Server')) { stopServer(); }
      else if (label.includes('Show Dashboard')) { void vscode.commands.executeCommand('workbench.view.extension.maxout'); }
      else if (label.includes('Trace a Request')) { traceView.show(cliPath); }
      else if (label.includes('Setup Wizard')) { runSetup(); }
      else if (label.includes('Copy Endpoint')) { copyEndpoint(); }
      else if (label.includes('Config File')) { void configEditor.open(); }
      else if (label.includes('Export')) { exportStats(); }
      else if (label.includes('Point Extension')) { void pointExtensionAtMaxout(getConfig, cliPath); }
    });
  }

  function runSetup() {
    const isWin = process.platform === 'win32';
    terminalRunner.run('maxout.setup', 'setup', {
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
    terminalRunner.run('maxout.exportStats', 'export-stats --out maxout-stats.json', {
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
      'Endpoint config copied to clipboard. Note: Maxout does not check client keys — `apiKey: "anything"` is a placeholder, not a real secret.'
    );
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('maxout.menu', showMenu),
    vscode.commands.registerCommand('maxout.start', startServer),
    vscode.commands.registerCommand('maxout.stop', stopServer),
    vscode.commands.registerCommand('maxout.restart', restartServer),
    // Phase 1: "Show Status" opens the dashboard instead of a terminal dump.
    vscode.commands.registerCommand('maxout.status', () =>
      void vscode.commands.executeCommand('workbench.view.extension.maxout')
    ),
    vscode.commands.registerCommand('maxout.setup', runSetup),
    vscode.commands.registerCommand('maxout.trace', () => traceView.show(cliPath)),
    vscode.commands.registerCommand('maxout.revive', () => traceView.showRevive(cliPath)),
    vscode.commands.registerCommand('maxout.openConfig', () => void configEditor.open()),
    vscode.commands.registerCommand('maxout.copyEndpoint', copyEndpoint),
    vscode.commands.registerCommand('maxout.exportStats', exportStats),
    vscode.commands.registerCommand('maxout.pointExtension', () => pointExtensionAtMaxout(getConfig, cliPath)),
    vscode.window.registerWebviewViewProvider('maxout.dashboard', dashboardProvider),
  );

  // -----------------------------------------------------------------------
  // Config-change handling
  // -----------------------------------------------------------------------
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('maxout')) { return; }
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