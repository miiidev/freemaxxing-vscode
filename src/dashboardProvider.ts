import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { StatusRow, stateSlug, isCoolingDown } from './parsers';

export class DashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'maxout.dashboard';
  private _view?: vscode.WebviewView;
  private _rows: StatusRow[] = [];
  private _serverUp = false;
  private _visible = false;
  private _setupCta = false;
  private _emitter = new EventEmitter();

  constructor(private readonly _extensionUri: vscode.Uri) {
  }

  // -----------------------------------------------------------------------
  // WebviewViewProvider
  // -----------------------------------------------------------------------

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    this._visible = webviewView.visible;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // Set the HTML shell once — data rows are rendered via postMessage.
    this._view.webview.html = this._getHtml();

    webviewView.onDidChangeVisibility(() => {
      this._visible = webviewView.visible;
      this._emitter.emit('visibility', this._visible);
    });

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case 'refresh':
          this._emitter.emit('refresh');
          break;
        case 'trace':
          void vscode.commands.executeCommand('maxout.trace');
          break;
        case 'setup':
          void vscode.commands.executeCommand('maxout.setup');
          break;
        case 'revive':
          if (message.model) {
            void vscode.commands.executeCommand('maxout.revive', message.model);
          }
          break;
        case 'copyEndpoint':
          void vscode.commands.executeCommand('maxout.copyEndpoint');
          break;
        case 'openConfig':
          void vscode.commands.executeCommand('maxout.openConfig');
          break;
        case 'pointExtension':
          void vscode.commands.executeCommand('maxout.pointExtension');
          break;
      }
    });

    // Push current state to the newly created view.
    this._pushData();
  }

  // -----------------------------------------------------------------------
  // Data API (called by extension.ts)
  // -----------------------------------------------------------------------

  updateData(rows: StatusRow[]): void {
    this._rows = rows;
    this._pushData();
  }

  updateServerState(up: boolean): void {
    this._serverUp = up;
    this._pushData();
  }

  setSetupCta(show: boolean): void {
    this._setupCta = show;
    this._pushData();
  }

  isVisible(): boolean {
    return this._visible;
  }

  onRefresh(fn: () => void): void {
    this._emitter.on('refresh', fn);
  }

  onDidChangeVisibility(fn: (visible: boolean) => void): void {
    this._emitter.on('visibility', fn);
  }

  // -----------------------------------------------------------------------
  // Internal: push state to webview via postMessage
  // -----------------------------------------------------------------------

  private _pushData(): void {
    if (!this._view) { return; }

    const host = vscode.workspace.getConfiguration('maxout').get<string>('host', '127.0.0.1');
    const port = vscode.workspace.getConfiguration('maxout').get<number>('port', 8787);
    const defaultAlias = vscode.workspace.getConfiguration('maxout').get<string>('defaultAlias', 'auto/coding');

    // Convert rows to a plain-data format for the webview.
    const rowData = this._rows.map((m) => ({
      model: m.model,
      state: m.state,
      slug: stateSlug(m.state),
      requests: m.requests,
      tokens: m.tokens,
      reliability: m.reliability,
    }));

    this._view.webview.postMessage({
      type: 'update',
      host,
      port,
      defaultAlias,
      serverUp: this._serverUp,
      setupCta: this._setupCta,
      rows: rowData,
    });
  }

  // -----------------------------------------------------------------------
  // HTML shell (rendered once)
  // -----------------------------------------------------------------------

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 0;
      line-height: 1.4;
    }

    /* Header */
    .header {
      padding: 10px 14px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }
    .header-info {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
    }
    .status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--vscode-errorForeground);
      flex-shrink: 0;
    }
    .status-dot.running { background: #4caf50; }
    .status-text {
      font-size: 12px;
      color: var(--vscode-foreground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .header-actions {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-shrink: 0;
    }
    .badge {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-weight: 500;
    }
    .badge.warn { background: #ff9800; color: #1e1e1e; }
    .btn {
      cursor: pointer;
      background: transparent;
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-foreground);
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 11px;
      transition: background 0.15s, border-color 0.15s;
    }
    .btn:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
    }

    /* Summary bar */
    .summary-bar {
      display: flex;
      gap: 16px;
      padding: 8px 14px;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .stat { display: flex; flex-direction: column; align-items: center; gap: 1px; }
    .stat-value { font-size: 14px; font-weight: 600; color: var(--vscode-foreground); }
    .stat-label {
      font-size: 9px; text-transform: uppercase;
      color: var(--vscode-descriptionForeground); letter-spacing: 0.5px;
    }
    .stat.ok .stat-value { color: #4caf50; }
    .stat.warn .stat-value { color: #ff9800; }

    /* Filter bar */
    .filter-bar {
      display: flex;
      gap: 6px;
      padding: 8px 14px;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-wrap: wrap;
    }
    .filter-input {
      flex: 1; min-width: 100px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      padding: 4px 8px; border-radius: 3px; font-size: 12px;
      font-family: var(--vscode-font-family);
    }
    .filter-input:focus { outline: none; border-color: var(--vscode-focusBorder); }
    .filter-chip {
      cursor: pointer; padding: 3px 8px; border-radius: 10px;
      background: transparent; border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground); font-size: 10px;
      transition: all 0.15s;
    }
    .filter-chip:hover { background: var(--vscode-list-hoverBackground); }
    .filter-chip.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }

    /* Table */
    .table-wrapper { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th {
      text-align: left; padding: 6px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-weight: 600; text-transform: uppercase; font-size: 10px;
      color: var(--vscode-descriptionForeground);
      letter-spacing: 0.5px; cursor: pointer; user-select: none; white-space: nowrap;
    }
    th:hover { color: var(--vscode-foreground); }
    th.sort-asc::after { content: ' \\25B2'; font-size: 8px; }
    th.sort-desc::after { content: ' \\25BC'; font-size: 8px; }
    td {
      padding: 6px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      vertical-align: middle;
    }
    tr.model-row { cursor: pointer; transition: background 0.1s; }
    tr.model-row:hover { background: var(--vscode-list-hoverBackground); }
    tr.model-row.expanded { background: var(--vscode-list-activeSelectionBackground); }
    tr.detail-row { display: none; background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.1)); }
    tr.detail-row.show { display: table-row; }
    .model-cell { font-family: var(--vscode-editor-font-family); font-size: 12px; word-break: break-all; max-width: 200px; }
    .model-cell.pool { color: var(--vscode-descriptionForeground); font-style: italic; }
    .state-cell { font-weight: 500; white-space: nowrap; }
    .state-ok { color: #4caf50; }
    .state-cooldown { color: #ff9800; }
    .state-exhausted { color: var(--vscode-errorForeground); }
    .state-unknown { color: var(--vscode-descriptionForeground); }
    .num-cell { font-family: var(--vscode-editor-font-family); font-size: 12px; text-align: right; white-space: nowrap; }
    .empty { text-align: center; padding: 32px 16px !important; color: var(--vscode-descriptionForeground); }
    .cta { padding: 16px; text-align: center; }
    .cta p { margin-bottom: 12px; }
    .cta button {
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; padding: 8px 20px; border-radius: 4px; cursor: pointer; font-size: 13px;
    }
    .cta button:hover { background: var(--vscode-button-hoverBackground); }

    /* Detail row */
    .detail-content { padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
    .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
    .detail-item { display: flex; flex-direction: column; gap: 2px; }
    .detail-label { font-size: 9px; text-transform: uppercase; color: var(--vscode-descriptionForeground); letter-spacing: 0.5px; }
    .detail-value { font-size: 12px; color: var(--vscode-foreground); word-break: break-all; }
    .detail-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
    .detail-action {
      cursor: pointer; background: transparent;
      border: 1px solid var(--vscode-panel-border); color: var(--vscode-foreground);
      padding: 3px 10px; border-radius: 3px; font-size: 11px; transition: all 0.15s;
    }
    .detail-action:hover { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
    .detail-action.revive { border-color: #ff9800; color: #ff9800; }
    .detail-action.revive:hover { background: #ff9800; color: #1e1e1e; }

    /* Footer */
    .footer {
      padding: 8px 14px; border-top: 1px solid var(--vscode-panel-border);
      font-size: 11px; color: var(--vscode-descriptionForeground);
      display: flex; justify-content: space-between; align-items: center; gap: 8px;
    }
    .footer-info { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

    @media (max-width: 400px) {
      .header-top { gap: 4px; }
      .header-info { flex-direction: column; align-items: flex-start; gap: 4px; }
      .summary-bar { gap: 12px; padding: 6px 10px; }
      .filter-bar { padding: 6px 10px; }
      .filter-chip { font-size: 9px; padding: 2px 6px; }
      th, td { padding: 4px 6px; font-size: 11px; }
      .model-cell { max-width: 140px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      <div class="header-info">
        <span class="status-dot" id="statusDot"></span>
        <span class="status-text" id="statusText">Loading...</span>
      </div>
      <div class="header-actions">
        <span class="badge warn" id="cooldownBadge" style="display:none"></span>
        <button class="btn" id="btnPoint" title="Configure AI extensions">&#128268;</button>
        <button class="btn" id="btnRefresh">&#8635;</button>
      </div>
    </div>
  </div>

  <div class="summary-bar" id="summaryBar" style="display:none">
    <div class="stat"><span class="stat-value" id="statTotal">0</span><span class="stat-label">models</span></div>
    <div class="stat ok"><span class="stat-value" id="statHealthy">0</span><span class="stat-label">healthy</span></div>
    <div class="stat warn"><span class="stat-value" id="statCooldown">0</span><span class="stat-label">cooldown</span></div>
  </div>

  <div class="filter-bar">
    <input type="text" class="filter-input" id="searchInput" placeholder="Filter models..." />
    <button class="filter-chip active" data-filter="all">All</button>
    <button class="filter-chip" data-filter="ok">Healthy</button>
    <button class="filter-chip" data-filter="cooldown">Cooldown</button>
    <button class="filter-chip" data-filter="exhausted">Exhausted</button>
  </div>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th data-sort="model">Model</th>
          <th data-sort="slug">State</th>
          <th data-sort="requests" style="text-align:right">Req</th>
          <th data-sort="tokens" style="text-align:right">Tok</th>
          <th data-sort="reliability" style="text-align:right">Rel</th>
        </tr>
      </thead>
      <tbody id="modelTableBody"></tbody>
    </table>
  </div>

  <div class="footer">
    <span class="footer-info" id="footerRouted">Last routed: &mdash;</span>
    <button class="btn" id="btnTrace">Trace &rarr;</button>
  </div>

  <script>
    (function () {
      const vscode = acquireVsCodeApi();

      // ---- Persistent state (survives postMessage data updates) ----
      let currentFilter = 'all';
      let searchTerm = '';
      let sortCol = null;
      let sortDir = 'asc';
      let expandedModels = new Set();
      let rowsData = [];
      let setupCta = false;

      // ---- DOM refs (stable — never replaced) ----
      const $ = (id) => document.getElementById(id);
      const statusDot = $('statusDot');
      const statusText = $('statusText');
      const cooldownBadge = $('cooldownBadge');
      const summaryBar = $('summaryBar');
      const statTotal = $('statTotal');
      const statHealthy = $('statHealthy');
      const statCooldown = $('statCooldown');
      const footerRouted = $('footerRouted');
      const tbody = $('modelTableBody');
      const searchInput = $('searchInput');

      // ---- Button handlers ----
      $('btnRefresh').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
      $('btnTrace').addEventListener('click', () => vscode.postMessage({ command: 'trace' }));
      $('btnPoint').addEventListener('click', () => vscode.postMessage({ command: 'pointExtension' }));

      // ---- Filter chip handlers ----
      document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          currentFilter = chip.dataset.filter;
          renderTable();
        });
      });

      // ---- Search handler ----
      searchInput.addEventListener('input', () => {
        searchTerm = searchInput.value.toLowerCase();
        renderTable();
      });

      // ---- Sort handlers ----
      document.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
          const col = th.dataset.sort;
          if (sortCol === col) {
            sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            sortCol = col;
            sortDir = 'asc';
          }
          document.querySelectorAll('th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
          th.classList.add('sort-' + sortDir);
          renderTable();
        });
      });

      // ---- Message handler from extension ----
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.type !== 'update') return;

        // Update header
        statusDot.className = 'status-dot' + (msg.serverUp ? ' running' : '');
        statusText.textContent = (msg.serverUp ? 'Running' : 'Stopped') + ' \\u00B7 ' + msg.host + ':' + msg.port + ' \\u00B7 ' + msg.defaultAlias;

        // Cooldown badge
        const cooldownCount = msg.rows.filter(r => r.slug === 'cooldown' || r.slug === 'exhausted').length;
        if (cooldownCount > 0) {
          cooldownBadge.style.display = '';
          cooldownBadge.textContent = cooldownCount + ' cooling down';
        } else {
          cooldownBadge.style.display = 'none';
        }

        // Summary bar
        if (msg.rows.length > 0) {
          summaryBar.style.display = '';
          statTotal.textContent = msg.rows.length;
          statHealthy.textContent = msg.rows.filter(r => r.slug === 'ok').length;
          statCooldown.textContent = cooldownCount;
        } else {
          summaryBar.style.display = 'none';
        }

        // Footer
        footerRouted.textContent = 'Last routed: ' + (msg.rows.length > 0 ? msg.rows[0].model : '\\u2014');

        // Store state and render
        setupCta = msg.setupCta;
        rowsData = msg.rows;
        renderTable();
      });

      // ---- Render table body from rowsData ----
      function renderTable() {
        // Filter
        let filtered = rowsData.filter(r => {
          const matchFilter = currentFilter === 'all' || r.slug === currentFilter;
          const matchSearch = !searchTerm || r.model.toLowerCase().includes(searchTerm);
          return matchFilter && matchSearch;
        });

        // Sort
        if (sortCol) {
          filtered.sort((a, b) => {
            const av = a[sortCol] || '';
            const bv = b[sortCol] || '';
            const cmp = av.localeCompare(bv, undefined, { numeric: true });
            return sortDir === 'asc' ? cmp : -cmp;
          });
        }

        // Empty state
        if (rowsData.length === 0) {
          const msg = setupCta
            ? '<div class="cta"><p>No provider keys configured yet.</p><button onclick="runSetup()">Run Setup Wizard</button></div>'
            : 'No data yet. Make a request through Maxout and refresh.';
          tbody.innerHTML = '<tr><td colspan="5" class="empty">' + msg + '</td></tr>';
          return;
        }

        if (filtered.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="empty">No models match the current filter.</td></tr>';
          return;
        }

        // Build rows
        let html = '';
        for (const r of filtered) {
          const isPool = r.tokens === '\\u2014' && r.requests !== '\\u2014';
          const modelClass = isPool ? 'model-cell pool' : 'model-cell';
          html += '<tr class="model-row" data-model="' + esc(r.model) + '"'
            + ' data-state="' + esc(r.slug) + '"'
            + ' data-req="' + esc(r.requests) + '"'
            + ' data-tok="' + esc(r.tokens) + '"'
            + ' data-rel="' + esc(r.reliability) + '">'
            + '<td class="' + modelClass + '">' + esc(r.model) + '</td>'
            + '<td class="state-cell state-' + r.slug + '">' + esc(r.state) + '</td>'
            + '<td class="num-cell">' + esc(r.requests) + '</td>'
            + '<td class="num-cell">' + esc(r.tokens) + '</td>'
            + '<td class="num-cell">' + esc(r.reliability) + '</td>'
            + '</tr>';

          // Detail row if expanded
          if (expandedModels.has(r.model)) {
            html += buildDetailRow(r);
          }
        }
        tbody.innerHTML = html;

        // Attach row click handlers
        tbody.querySelectorAll('tr.model-row').forEach(row => {
          row.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            const model = row.dataset.model;
            toggleDetail(row, model);
          });
        });

        // Attach revive button handlers
        tbody.querySelectorAll('button[data-revive]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'revive', model: btn.dataset.revive });
          });
        });
      }

      function toggleDetail(row, model) {
        const nextRow = row.nextElementSibling;
        if (expandedModels.has(model)) {
          expandedModels.delete(model);
          row.classList.remove('expanded');
          if (nextRow && nextRow.classList.contains('detail-row')) {
            nextRow.remove();
          }
        } else {
          expandedModels.add(model);
          row.classList.add('expanded');
          // Find the data from rowsData
          const r = rowsData.find(x => x.model === model);
          if (r) {
            const detail = document.createElement('tr');
            detail.className = 'detail-row show';
            detail.innerHTML = buildDetailInner(r);
            row.after(detail);
            // Attach revive handler in detail row
            detail.querySelectorAll('button[data-revive]').forEach(btn => {
              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({ command: 'revive', model: btn.dataset.revive });
              });
            });
          }
        }
      }

      function buildDetailRow(r) {
        return '<tr class="detail-row show">' + buildDetailInner(r) + '</tr>';
      }

      function buildDetailInner(r) {
        const isCooling = r.slug === 'cooldown' || r.slug === 'exhausted';
        let html = '<td colspan="5"><div class="detail-content"><div class="detail-grid">';
        html += detailItem('Model', r.model);
        html += detailItem('State', r.state);
        html += detailItem('Requests', r.requests);
        html += detailItem('Tokens', r.tokens);
        html += detailItem('Reliability', r.reliability);
        html += '</div><div class="detail-actions">';
        if (isCooling) {
          html += '<button class="detail-action revive" data-revive="' + esc(r.model) + '">Revive</button>';
        }
        html += '<button class="detail-action" onclick="acquireVsCodeApi().postMessage({command:\\'copyEndpoint\\'})">Copy Endpoint</button>';
        html += '<button class="detail-action" onclick="acquireVsCodeApi().postMessage({command:\\'trace\\'})">Trace Last</button>';
        html += '</div></div></td>';
        return html;
      }

      function detailItem(label, value) {
        return '<div class="detail-item"><span class="detail-label">' + label + '</span><span class="detail-value">' + esc(value) + '</span></div>';
      }

      function esc(text) {
        return String(text)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }
    })();
  </script>
</body>
</html>`;
  }
}