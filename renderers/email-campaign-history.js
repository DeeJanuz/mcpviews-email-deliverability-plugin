(function() {
  'use strict';

  window.__renderers = window.__renderers || {};

  var STATUSES = [
    'PREPARED',
    'PENDING_APPROVAL',
    'APPROVED',
    'SENDING',
    'SENT',
    'PARTIALLY_FAILED',
    'FAILED',
    'CANCELED',
  ];

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function firstString(values, fallback) {
    for (var i = 0; i < values.length; i += 1) {
      if (typeof values[i] === 'string' && values[i].trim()) return values[i].trim();
    }
    return fallback || '';
  }

  function compactObject(value) {
    var out = {};
    Object.keys(value || {}).forEach(function(key) {
      if (value[key] !== undefined && value[key] !== '') out[key] = value[key];
    });
    return out;
  }

  function normalizeIdentifier(value) {
    return String(value || '').trim().toLowerCase();
  }

  function numberValue(value) {
    var number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  }

  function formatNumber(value) {
    return numberValue(value).toLocaleString();
  }

  function formatRate(value) {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.round(value * 1000) / 10 + '%'
      : '-';
  }

  function formatDate(value) {
    if (!value) return '-';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function humanizeStatus(value) {
    return String(value || 'UNKNOWN').toLowerCase().replace(/_/g, ' ');
  }

  function optionHtml(value, label, selected) {
    return '<option value="' + esc(value || '') + '"' + (selected ? ' selected' : '') + '>' + esc(label || value || '') + '</option>';
  }

  function orgLabel(org) {
    if (!isRecord(org)) return 'Organization';
    return firstString([org.name, org.displayName, org.slug, org.id], 'Organization');
  }

  function workspaceLabel(workspace) {
    if (!isRecord(workspace)) return 'Workspace';
    var packageName = firstString([workspace.packageName, workspace.packageKey], '');
    var label = firstString([workspace.name, workspace.title, workspace.slug, workspace.id], 'Workspace');
    return packageName ? label + ' - ' + packageName : label;
  }

  function campaignStats(item) {
    return isRecord(item && item.stats) ? item.stats : {};
  }

  function campaignTimes(item) {
    return isRecord(item && item.sendTimes) ? item.sendTimes : {};
  }

  function campaignRecord(item) {
    return isRecord(item && item.campaign) ? item.campaign : {};
  }

  function statusClass(status) {
    var normalized = String(status || '').toLowerCase().replace(/_/g, '-');
    return 'email-history-status email-history-status-' + normalized;
  }

  function button(label, action, variant) {
    return '<button type="button" class="email-history-button' + (variant ? ' ' + variant : '') + '" data-action="' + esc(action) + '">' + esc(label) + '</button>';
  }

  function metric(label, value, sublabel) {
    return [
      '<div class="email-history-metric">',
      '<span>' + esc(label) + '</span>',
      '<strong>' + esc(value) + '</strong>',
      sublabel ? '<em>' + esc(sublabel) + '</em>' : '',
      '</div>',
    ].join('');
  }

  function styles() {
    var selectChevronDark = 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%239ca3af%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E")';
    var selectChevronLight = 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b7280%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E")';
    return [
      '.email-history{--glass-bg:rgba(255,255,255,0.06);--glass-border:rgba(255,255,255,0.10);--glass-blur:12px;--glass-shadow:0 8px 32px rgba(0,0,0,0.40);--glass-inset-highlight:inset 0 1px 0 rgba(255,255,255,0.06);--bg-surface:rgba(255,255,255,0.05);--bg-surface-hover:rgba(255,255,255,0.08);--bg-surface-subtle:rgba(255,255,255,0.03);--text-primary:rgba(255,255,255,0.95);--text-secondary:rgba(255,255,255,0.62);--text-tertiary:rgba(255,255,255,0.38);--accent-primary:#818cf8;--accent-primary-hover:#6366f1;--accent-primary-ghost:rgba(129,140,248,0.12);--border-default:rgba(255,255,255,0.08);--border-subtle:rgba(255,255,255,0.04);--border-strong:rgba(255,255,255,0.15);--color-success-bg:rgba(34,197,94,0.15);--color-success-text:#86efac;--color-warning-bg:rgba(245,158,11,0.14);--color-warning-text:#fcd34d;--color-error-bg:rgba(239,68,68,0.15);--color-error-text:#fca5a5;--color-info-bg:rgba(96,165,250,0.14);--color-info-text:#93c5fd;--font-sans:Figtree,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--text-h1:24px;--text-h3:16px;--text-body:14px;--text-small:12px;--text-xs:11px;--weight-semibold:600;--weight-bold:700;--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-6:24px;--border-radius-md:8px;--border-radius-lg:12px;--border-radius-pill:999px;--transition-fast:0.15s ease;min-height:100%;padding:var(--space-6) var(--space-4);box-sizing:border-box;color:var(--text-primary);background:radial-gradient(circle at top left,rgba(129,140,248,0.18),transparent 34%),linear-gradient(180deg,#0b1020 0%,#0f1117 55%,#111827 100%);font:var(--text-body)/1.45 var(--font-sans);}',
      '.email-history *{box-sizing:border-box;}',
      '.email-history h2,.email-history h3,.email-history p{margin:0;}',
      '.email-history-shell{max-width:1280px;margin:0 auto;display:grid;gap:var(--space-4);}',
      '.email-history-top{display:flex;justify-content:space-between;gap:var(--space-4);align-items:flex-start;}',
      '.email-history-title h2{font-size:var(--text-h1);line-height:1.2;font-weight:var(--weight-bold);color:var(--text-primary);letter-spacing:0;}',
      '.email-history-title p{margin-top:4px;color:var(--text-secondary);font-size:var(--text-small);}',
      '.email-history-kicker{color:var(--text-tertiary);font-size:var(--text-xs);font-weight:var(--weight-semibold);text-transform:uppercase;letter-spacing:0;margin-bottom:4px;}',
      '.email-history-state{min-width:240px;border:1px solid var(--glass-border);background:var(--glass-bg);border-radius:var(--border-radius-lg);padding:var(--space-3);color:var(--text-secondary);box-shadow:var(--glass-shadow),var(--glass-inset-highlight);backdrop-filter:blur(var(--glass-blur));-webkit-backdrop-filter:blur(var(--glass-blur));}',
      '.email-history-state strong{display:block;color:var(--text-primary);font-weight:var(--weight-semibold);}',
      '.email-history-state span{display:block;margin-top:3px;font-size:var(--text-xs);line-height:1.35;color:var(--text-tertiary);}',
      '.email-history-panel{background:var(--glass-bg);backdrop-filter:blur(var(--glass-blur));-webkit-backdrop-filter:blur(var(--glass-blur));border:1px solid var(--glass-border);border-radius:var(--border-radius-lg);padding:var(--space-4);box-shadow:var(--glass-shadow),var(--glass-inset-highlight);}',
      '.email-history-panel h3{display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-h3);font-weight:var(--weight-semibold);color:var(--text-primary);margin-bottom:var(--space-3);}',
      '.email-history-panel h3::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent-primary);box-shadow:0 0 0 3px rgba(129,140,248,0.12);}',
      '.email-history-controls{display:grid;grid-template-columns:1.2fr 1.2fr .75fr .55fr auto;gap:var(--space-3);align-items:end;}',
      '.email-history-field{display:grid;gap:var(--space-1);min-width:0;}',
      '.email-history-field label{font-size:var(--text-xs);font-weight:var(--weight-semibold);color:var(--text-secondary);text-transform:uppercase;letter-spacing:0;}',
      '.email-history-field select,.email-history-field input{width:100%;min-height:38px;border:1px solid var(--border-default);border-radius:var(--border-radius-md);background:var(--bg-surface);color:var(--text-primary);padding:8px 10px;font:inherit;outline:none;transition:border-color var(--transition-fast),background-color var(--transition-fast);}',
      '.email-history-field select{appearance:none;-webkit-appearance:none;color-scheme:dark;background-color:var(--bg-surface);background-image:' + selectChevronDark + ';background-repeat:no-repeat;background-position:right 11px center;background-size:14px 14px;padding-right:34px;}',
      '.email-history-field select:focus,.email-history-field input:focus{border-color:var(--accent-primary);}',
      '.email-history-field input:focus{background:var(--bg-surface-hover);}',
      '.email-history-field select:focus{background-color:var(--bg-surface-hover);}',
      '.email-history-actions{display:flex;gap:var(--space-2);flex-wrap:wrap;justify-content:flex-end;align-items:center;}',
      '.email-history-button{min-height:38px;border:1px solid var(--border-default);background:var(--bg-surface);color:var(--text-primary);border-radius:var(--border-radius-md);padding:0 14px;font-weight:var(--weight-semibold);font-size:var(--text-small);font-family:inherit;cursor:pointer;line-height:1.15;transition:border-color var(--transition-fast),background var(--transition-fast),color var(--transition-fast),transform var(--transition-fast);}',
      '.email-history-button:hover{border-color:var(--border-strong);background:var(--bg-surface-hover);}',
      '.email-history-button:active{transform:scale(0.98);}',
      '.email-history-button.primary{background:var(--accent-primary);border-color:var(--accent-primary);color:#fff;}',
      '.email-history-button.primary:hover{background:var(--accent-primary-hover);border-color:var(--accent-primary-hover);}',
      '.email-history-button:disabled{cursor:not-allowed;opacity:.55;transform:none;}',
      '.email-history-error{display:none;border:1px solid rgba(239,68,68,0.28);background:var(--color-error-bg);color:var(--color-error-text);border-radius:var(--border-radius-md);padding:var(--space-3);font-size:var(--text-small);}',
      '.email-history-error.visible{display:block;}',
      '.email-history-context{margin-top:var(--space-2);font-size:var(--text-small);color:var(--text-tertiary);line-height:1.4;}',
      '.email-history-metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:var(--space-3);}',
      '.email-history-metric{border:1px solid var(--border-subtle);background:var(--bg-surface);border-radius:var(--border-radius-md);padding:var(--space-3);min-width:0;}',
      '.email-history-metric span{display:block;color:var(--text-secondary);font-size:var(--text-xs);font-weight:var(--weight-semibold);text-transform:uppercase;letter-spacing:0;margin-bottom:4px;}',
      '.email-history-metric strong{display:block;font-size:var(--text-h1);line-height:1.1;font-weight:var(--weight-bold);color:var(--accent-primary);letter-spacing:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.email-history-metric em{display:block;margin-top:3px;color:var(--text-tertiary);font-size:var(--text-xs);font-style:normal;}',
      '.email-history-table-wrap{overflow:auto;border:1px solid var(--border-subtle);border-radius:var(--border-radius-md);background:var(--bg-surface-subtle);}',
      '.email-history-table{width:100%;border-collapse:collapse;min-width:980px;font-size:var(--text-small);}',
      '.email-history-table th{position:sticky;top:0;z-index:1;background:rgba(17,24,39,.96);color:var(--text-secondary);font-size:var(--text-xs);font-weight:var(--weight-semibold);text-transform:uppercase;letter-spacing:0;text-align:left;border-bottom:1px solid var(--border-subtle);padding:8px 10px;}',
      '.email-history-table td{border-bottom:1px solid var(--border-subtle);padding:9px 10px;vertical-align:top;color:var(--text-primary);}',
      '.email-history-table tr:last-child td{border-bottom:0;}',
      '.email-history-table tr{cursor:pointer;}',
      '.email-history-table tbody tr:hover td{background:var(--bg-surface-hover);}',
      '.email-history-table tr.active td{background:var(--accent-primary-ghost);}',
      '.email-history-campaign-name{font-weight:var(--weight-bold);color:var(--text-primary);max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.email-history-subject{color:var(--text-secondary);font-size:var(--text-small);max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}',
      '.email-history-status{display:inline-flex;align-items:center;min-height:22px;border-radius:var(--border-radius-pill);border:1px solid var(--border-default);padding:2px 8px;font-size:var(--text-xs);font-weight:var(--weight-semibold);text-transform:capitalize;white-space:nowrap;background:var(--bg-surface);color:var(--text-secondary);}',
      '.email-history-status-sent{color:var(--color-success-text);border-color:rgba(34,197,94,.32);background:var(--color-success-bg);}',
      '.email-history-status-sending,.email-history-status-approved{color:var(--color-info-text);border-color:rgba(96,165,250,.32);background:var(--color-info-bg);}',
      '.email-history-status-partially-failed,.email-history-status-canceled{color:var(--color-warning-text);border-color:rgba(245,158,11,.32);background:var(--color-warning-bg);}',
      '.email-history-status-failed{color:var(--color-error-text);border-color:rgba(239,68,68,.28);background:var(--color-error-bg);}',
      '.email-history-detail{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);}',
      '.email-history-kv{display:grid;grid-template-columns:minmax(120px,220px) minmax(0,1fr);gap:0;border:1px solid var(--border-subtle);border-radius:var(--border-radius-md);overflow:hidden;background:var(--bg-surface);}',
      '.email-history-kv div{padding:9px 10px;border-bottom:1px solid var(--border-subtle);font-size:var(--text-small);min-width:0;color:var(--text-primary);}',
      '.email-history-kv div:nth-child(odd){color:var(--text-secondary);font-size:var(--text-xs);font-weight:var(--weight-semibold);text-transform:uppercase;letter-spacing:0;background:var(--bg-surface-subtle);}',
      '.email-history-kv div:nth-child(even){overflow-wrap:anywhere;}',
      '.email-history-kv div:nth-last-child(-n+2){border-bottom:0;}',
      '.email-history-empty{padding:var(--space-6);text-align:center;color:var(--text-tertiary);font-size:var(--text-small);}',
      '.email-history-events{max-height:260px;overflow:auto;border:1px solid var(--border-subtle);border-radius:var(--border-radius-md);background:var(--bg-surface);}',
      '.email-history-event{display:grid;grid-template-columns:130px 1fr 140px;gap:var(--space-2);border-bottom:1px solid var(--border-subtle);padding:8px 10px;font-size:var(--text-small);}',
      '.email-history-event:last-child{border-bottom:0;}',
      '.email-history-event strong{font-size:var(--text-small);color:var(--text-primary);}',
      '.email-history-event span{color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '@media (prefers-color-scheme:light){.email-history{--glass-bg:rgba(255,255,255,0.72);--glass-border:rgba(0,0,0,0.08);--glass-shadow:0 8px 32px rgba(0,0,0,0.08);--glass-inset-highlight:inset 0 1px 0 rgba(255,255,255,0.5);--bg-surface:rgba(255,255,255,0.8);--bg-surface-hover:rgba(255,255,255,0.95);--bg-surface-subtle:rgba(255,255,255,0.5);--text-primary:rgba(0,0,0,0.87);--text-secondary:rgba(0,0,0,0.60);--text-tertiary:rgba(0,0,0,0.38);--border-default:rgba(0,0,0,0.08);--border-subtle:rgba(0,0,0,0.04);--border-strong:rgba(0,0,0,0.15);background:#f5f5f7;}.email-history-field select{color-scheme:light;background-image:' + selectChevronLight + ';}.email-history-table th{background:rgba(255,255,255,.96);}.email-history-button.primary{color:#fff;}}',
      '@media (max-width:980px){.email-history-controls{grid-template-columns:1fr 1fr}.email-history-actions{justify-content:flex-start}.email-history-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.email-history-detail{grid-template-columns:1fr}.email-history-state{min-width:0}.email-history-top{display:grid}.email-history-kv{grid-template-columns:1fr}.email-history-kv div:nth-child(odd){border-bottom:0}}',
    ].join('');
  }

  window.__renderers.email_campaign_history = function(container, data) {
    var draft = isRecord(data && data.draft) ? data.draft : {};
    var state = {
      threadId: firstString([data && data.thread_id, data && data.threadId], ''),
      workspaceId: normalizeIdentifier(firstString([data && data.workspace_id, data && data.workspaceId], '')),
      projectId: normalizeIdentifier(firstString([data && data.project_id, data && data.projectId], '')),
      organizationId: normalizeIdentifier(firstString([data && data.organization_id, data && data.organizationId], '')),
      statusFilter: firstString([draft.status], ''),
      limit: Number(draft.limit || 25),
      includeEvents: draft.includeEvents === true,
      orgOptions: [],
      workspaceOptions: [],
      campaigns: [],
      selectedCampaignId: firstString([draft.campaignId], ''),
      contextStatus: 'Finding organizations and workspace context.',
      status: 'Ready',
      detail: 'Load campaign history.',
      error: '',
      busy: false,
      lastResult: null,
    };

    container.innerHTML =
      '<style>' + styles() + '</style>' +
      '<div class="email-history"><div class="email-history-shell">' +
      '<div class="email-history-top"><div class="email-history-title"><div class="email-history-kicker">Campaign Analytics</div><h2>Campaign History</h2><p>Database-backed campaign delivery history, send timing, and engagement stats.</p></div><div class="email-history-state"><strong data-role="status-title">Ready</strong><span data-role="status-detail">Load campaign history.</span></div></div>' +
      '<div class="email-history-error" data-role="error"></div>' +
      '<section class="email-history-panel"><div class="email-history-controls">' +
      '<div class="email-history-field"><label>Organization</label><select data-select="organizationId"></select></div>' +
      '<div class="email-history-field"><label>Workspace</label><select data-select="workspaceId"></select></div>' +
      '<div class="email-history-field"><label>Status</label><select data-role="status-filter"></select></div>' +
      '<div class="email-history-field"><label>Limit</label><input data-role="limit" type="number" min="1" max="100" step="1"></div>' +
      '<div class="email-history-actions">' + button('Refresh History', 'refresh-history', 'primary') + button('Context', 'discover-context') + '</div>' +
      '</div><div class="email-history-context" data-role="context-status"></div></section>' +
      '<section class="email-history-metrics" data-role="metrics"></section>' +
      '<section class="email-history-panel" data-role="table-panel"></section>' +
      '<section class="email-history-detail" data-role="detail"></section>' +
      '</div></div>';

    var statusTitle = container.querySelector('[data-role="status-title"]');
    var statusDetail = container.querySelector('[data-role="status-detail"]');
    var errorEl = container.querySelector('[data-role="error"]');
    var contextStatusEl = container.querySelector('[data-role="context-status"]');
    var organizationSelect = container.querySelector('[data-select="organizationId"]');
    var workspaceSelect = container.querySelector('[data-select="workspaceId"]');
    var statusFilterEl = container.querySelector('[data-role="status-filter"]');
    var limitEl = container.querySelector('[data-role="limit"]');
    var metricsEl = container.querySelector('[data-role="metrics"]');
    var tablePanelEl = container.querySelector('[data-role="table-panel"]');
    var detailEl = container.querySelector('[data-role="detail"]');

    function client() {
      return window.__tribexAiClient || null;
    }

    function setStatus(message, detail) {
      state.status = message || 'Ready';
      state.detail = detail || '';
      statusTitle.textContent = state.status;
      statusDetail.textContent = state.detail;
    }

    function showError(error) {
      var message = error && error.message ? error.message : String(error || 'Unknown error');
      state.error = message;
      errorEl.textContent = message;
      errorEl.classList.add('visible');
      setStatus('Blocked', message);
    }

    function clearError() {
      state.error = '';
      errorEl.textContent = '';
      errorEl.classList.remove('visible');
    }

    function setBusy(busy, detail) {
      state.busy = busy;
      Array.prototype.slice.call(container.querySelectorAll('button, select, input')).forEach(function(control) {
        control.disabled = busy;
      });
      if (detail) setStatus(detail);
      renderControls();
    }

    function applyThreadContext(thread) {
      if (!isRecord(thread)) return;
      var workspace = isRecord(thread.workspace) ? thread.workspace : {};
      var project = isRecord(thread.project) ? thread.project : {};
      state.workspaceId = normalizeIdentifier(firstString([workspace.id, thread.workspaceId, project.workspaceId], state.workspaceId));
      state.projectId = normalizeIdentifier(firstString([project.id, thread.projectId], state.projectId));
      state.organizationId = normalizeIdentifier(firstString([workspace.organizationId, thread.organizationId, project.organizationId], state.organizationId));
      state.contextStatus = state.workspaceId ? 'Thread context resolved.' : state.contextStatus;
      renderControls();
    }

    function renderControls() {
      if (contextStatusEl) contextStatusEl.textContent = state.contextStatus || '';
      var orgs = state.orgOptions || [];
      var orgHtml = [optionHtml('', orgs.length ? 'Select organization' : 'Loading organizations...', !state.organizationId)];
      if (state.organizationId && !orgs.some(function(org) { return org.id === state.organizationId; })) {
        orgHtml.push(optionHtml(state.organizationId, state.organizationId + ' (current)', true));
      }
      orgs.forEach(function(org) {
        orgHtml.push(optionHtml(org.id, orgLabel(org), org.id === state.organizationId));
      });
      organizationSelect.innerHTML = orgHtml.join('');
      organizationSelect.disabled = state.busy;

      var workspaces = state.workspaceOptions || [];
      var workspaceHtml = [optionHtml('', workspaces.length ? 'Select workspace' : 'Workspace resolves after org selection', !state.workspaceId)];
      if (state.workspaceId && !workspaces.some(function(workspace) { return workspace.id === state.workspaceId; })) {
        workspaceHtml.push(optionHtml(state.workspaceId, state.workspaceId + ' (current)', true));
      }
      workspaces.forEach(function(workspace) {
        workspaceHtml.push(optionHtml(workspace.id, workspaceLabel(workspace), workspace.id === state.workspaceId));
      });
      workspaceSelect.innerHTML = workspaceHtml.join('');
      workspaceSelect.disabled = state.busy || (!state.organizationId && !state.workspaceId);

      statusFilterEl.innerHTML = [optionHtml('', 'All statuses', !state.statusFilter)].concat(STATUSES.map(function(status) {
        return optionHtml(status, humanizeStatus(status), state.statusFilter === status);
      })).join('');
      statusFilterEl.disabled = state.busy;
      limitEl.value = String(state.limit || 25);
      limitEl.disabled = state.busy;
    }

    function totals() {
      return state.campaigns.reduce(function(sum, item) {
        var stats = campaignStats(item);
        sum.campaigns += 1;
        sum.recipients += numberValue(stats.recipientCount);
        sum.sent += numberValue(stats.sentCount);
        sum.opens += numberValue(stats.openCount);
        sum.clicks += numberValue(stats.linkClickCount);
        sum.optOuts += numberValue(stats.optOutCount);
        sum.bounces += numberValue(stats.bounceCount);
        return sum;
      }, {
        campaigns: 0,
        recipients: 0,
        sent: 0,
        opens: 0,
        clicks: 0,
        optOuts: 0,
        bounces: 0,
      });
    }

    function renderMetrics() {
      var sum = totals();
      metricsEl.innerHTML = [
        metric('Campaigns', formatNumber(sum.campaigns), state.statusFilter || 'all statuses'),
        metric('Recipients', formatNumber(sum.recipients), 'total audience'),
        metric('Sent', formatNumber(sum.sent), 'accepted sends'),
        metric('Opens', formatNumber(sum.opens), 'recorded events'),
        metric('Link clicks', formatNumber(sum.clicks), 'recorded events'),
        metric('Opt outs / bounces', formatNumber(sum.optOuts) + ' / ' + formatNumber(sum.bounces), 'list health'),
      ].join('');
    }

    function renderTable() {
      if (!state.campaigns.length) {
        tablePanelEl.innerHTML = '<div class="email-history-empty">No campaigns found for this workspace.</div>';
        return;
      }
      tablePanelEl.innerHTML = [
        '<div class="email-history-table-wrap"><table class="email-history-table"><thead><tr>',
        '<th>Campaign</th><th>Status</th><th>Recipients</th><th>Sent</th><th>Opens</th><th>Clicks</th><th>Opt outs</th><th>Bounces</th><th>Scheduled</th><th>Started</th><th>Completed</th>',
        '</tr></thead><tbody>',
        state.campaigns.map(function(item) {
          var campaign = campaignRecord(item);
          var stats = campaignStats(item);
          var times = campaignTimes(item);
          var active = campaign.id === state.selectedCampaignId;
          return [
            '<tr data-campaign-id="' + esc(campaign.id) + '"' + (active ? ' class="active"' : '') + '>',
            '<td><div class="email-history-campaign-name">' + esc(campaign.name || campaign.id) + '</div><div class="email-history-subject">' + esc(campaign.subject || '') + '</div></td>',
            '<td><span class="' + esc(statusClass(campaign.status)) + '">' + esc(humanizeStatus(campaign.status)) + '</span></td>',
            '<td>' + esc(formatNumber(stats.recipientCount)) + '</td>',
            '<td>' + esc(formatNumber(stats.sentCount)) + '</td>',
            '<td>' + esc(formatNumber(stats.openCount)) + '<div class="email-history-subject">' + esc(formatRate(stats.openRate)) + '</div></td>',
            '<td>' + esc(formatNumber(stats.linkClickCount)) + '<div class="email-history-subject">' + esc(formatRate(stats.clickRate)) + '</div></td>',
            '<td>' + esc(formatNumber(stats.optOutCount)) + '</td>',
            '<td>' + esc(formatNumber(stats.bounceCount)) + '</td>',
            '<td>' + esc(formatDate(times.scheduledAt)) + '</td>',
            '<td>' + esc(formatDate(times.sendStartedAt)) + '</td>',
            '<td>' + esc(formatDate(times.completedAt)) + '</td>',
            '</tr>',
          ].join('');
        }).join(''),
        '</tbody></table></div>',
      ].join('');
    }

    function kvRows(rows) {
      return '<div class="email-history-kv">' + rows.map(function(row) {
        return '<div>' + esc(row[0]) + '</div><div>' + esc(row[1] == null || row[1] === '' ? '-' : row[1]) + '</div>';
      }).join('') + '</div>';
    }

    function renderDetail() {
      var selected = state.campaigns.find(function(item) {
        return campaignRecord(item).id === state.selectedCampaignId;
      }) || state.campaigns[0];
      if (!selected) {
        detailEl.innerHTML = '';
        return;
      }
      state.selectedCampaignId = campaignRecord(selected).id;
      var campaign = campaignRecord(selected);
      var stats = campaignStats(selected);
      var times = campaignTimes(selected);
      var eventTotals = isRecord(selected.eventTotals) ? selected.eventTotals : {};
      var eventRows = Object.keys(eventTotals).sort().map(function(key) {
        return [key, eventTotals[key]];
      });
      var events = Array.isArray(selected.events) ? selected.events : [];
      detailEl.innerHTML = [
        '<section class="email-history-panel"><h3>Delivery Stats</h3>',
        kvRows([
          ['Campaign', campaign.name || campaign.id],
          ['Status', humanizeStatus(campaign.status)],
          ['Subject', campaign.subject],
          ['Recipients', formatNumber(stats.recipientCount)],
          ['Sendable', formatNumber(stats.sendableCount)],
          ['Suppressed', formatNumber(stats.suppressedCount)],
          ['Queued', formatNumber(stats.queuedCount)],
          ['Sent', formatNumber(stats.sentCount)],
          ['Failed', formatNumber(stats.failedCount)],
          ['Opens', formatNumber(stats.openCount) + ' (' + formatRate(stats.openRate) + ')'],
          ['Unique opens', formatNumber(stats.uniqueOpenCount)],
          ['Link clicks', formatNumber(stats.linkClickCount) + ' (' + formatRate(stats.clickRate) + ')'],
          ['Unique clicks', formatNumber(stats.uniqueClickCount)],
          ['Opt outs', formatNumber(stats.optOutCount) + ' (' + formatRate(stats.optOutRate) + ')'],
          ['Bounces', formatNumber(stats.bounceCount) + ' (' + formatRate(stats.bounceRate) + ')'],
        ]),
        '</section>',
        '<section class="email-history-panel"><h3>Send Times</h3>',
        kvRows([
          ['Scheduled', formatDate(times.scheduledAt)],
          ['Timezone', times.scheduledTimeZone],
          ['Approved', formatDate(times.approvedAt)],
          ['Started', formatDate(times.sendStartedAt)],
          ['Completed', formatDate(times.completedAt)],
          ['Canceled', formatDate(times.canceledAt)],
          ['Last event', formatDate(times.lastEventAt)],
          ['Snapshot', selected.provenance && selected.provenance.snapshotHash],
          ['Audience', selected.provenance && selected.provenance.audienceHash],
        ]),
        '</section>',
        '<section class="email-history-panel"><h3>Event Totals</h3>',
        eventRows.length ? kvRows(eventRows) : '<div class="email-history-empty">No events recorded.</div>',
        '</section>',
        '<section class="email-history-panel"><h3>Recent Events</h3>',
        events.length ? '<div class="email-history-events">' + events.map(function(event) {
          return '<div class="email-history-event"><strong>' + esc(event.eventType) + '</strong><span>' + esc(event.recipientId || 'campaign') + '</span><span>' + esc(formatDate(event.createdAt)) + '</span></div>';
        }).join('') + '</div>' : '<div class="email-history-empty">Enable event details in the launcher payload to include recent event rows.</div>',
        '</section>',
      ].join('');
    }

    function renderAll() {
      renderControls();
      renderMetrics();
      renderTable();
      renderDetail();
    }

    function loadOrganizations() {
      var api = client();
      if (!api || typeof api.fetchOrganizations !== 'function') {
        state.contextStatus = state.organizationId
          ? 'Using provided organization context.'
          : 'Organization lookup is unavailable in this MCPViews session.';
        renderControls();
        return Promise.resolve();
      }
      state.contextStatus = 'Loading organizations.';
      renderControls();
      return api.fetchOrganizations().then(function(orgs) {
        state.orgOptions = Array.isArray(orgs) ? orgs : [];
        if (!state.organizationId && state.orgOptions.length === 1) {
          state.organizationId = state.orgOptions[0].id;
        }
        state.contextStatus = state.organizationId
          ? 'Organization selected.'
          : 'Select an organization to load workspaces.';
        renderControls();
      });
    }

    function loadWorkspacesForSelectedOrg() {
      var api = client();
      if (!state.organizationId) {
        state.workspaceOptions = [];
        state.contextStatus = 'Select an organization to load workspaces.';
        renderControls();
        return Promise.resolve();
      }
      if (!api || typeof api.fetchWorkspaces !== 'function') {
        state.contextStatus = state.workspaceId
          ? 'Using provided workspace context.'
          : 'Workspace lookup is unavailable in this MCPViews session.';
        renderControls();
        return Promise.resolve();
      }
      state.contextStatus = 'Loading workspaces.';
      renderControls();
      return api.fetchWorkspaces(state.organizationId).then(function(workspaces) {
        state.workspaceOptions = Array.isArray(workspaces) ? workspaces : [];
        var current = state.workspaceOptions.find(function(workspace) { return workspace.id === state.workspaceId; });
        if (!current && state.workspaceOptions.length && !state.workspaceId) {
          state.workspaceId = state.workspaceOptions[0].id;
        } else if (!current && state.workspaceId && state.workspaceOptions.length) {
          state.workspaceId = '';
        }
        state.contextStatus = state.workspaceId
          ? 'Workspace selected.'
          : 'Select a workspace.';
        renderControls();
      });
    }

    function discoverContext() {
      var api = client();
      if (!api) {
        state.contextStatus = 'TribeX AI client is unavailable. Open from an authenticated MCPViews AI session.';
        renderControls();
        return Promise.resolve();
      }
      var threadPromise = state.threadId && typeof api.fetchThread === 'function'
        ? api.fetchThread(state.threadId).then(applyThreadContext).catch(function() {
            state.contextStatus = 'Could not resolve thread context. Select an organization.';
          })
        : Promise.resolve();
      return threadPromise
        .then(loadOrganizations)
        .then(loadWorkspacesForSelectedOrg)
        .then(function() {
          if (state.workspaceId) return loadHistory();
          setStatus('Select workspace', state.contextStatus);
          return null;
        });
    }

    function ensureRuntimeEnvelope() {
      var api = client();
      if (!api) throw new Error('TribeX AI client is unavailable.');
      if (state.threadId && typeof api.ensureRuntimeSession === 'function') {
        return api.ensureRuntimeSession(state.threadId, { forceRefresh: false }).then(function(envelope) {
          if (envelope && envelope.thread) applyThreadContext(envelope.thread);
          return envelope;
        });
      }
      if (typeof api.request === 'function') {
        return api.request('POST', '/api/mcpviews/runtime-session', {
          organizationId: state.organizationId || undefined,
          workspaceId: state.workspaceId || undefined,
          projectId: state.projectId || undefined,
          threadId: state.threadId || undefined,
          threadTitle: 'Email campaign history',
          purpose: 'email-campaign-history',
          metadata: { source: 'mcpviews-email-campaign-history' },
        }).then(function(envelope) {
          if (envelope && envelope.thread && envelope.thread.id) state.threadId = envelope.thread.id;
          if (envelope && envelope.workspace) {
            state.workspaceId = envelope.workspace.id || state.workspaceId;
            state.organizationId = envelope.workspace.organizationId || state.organizationId;
          }
          if (envelope && envelope.project) state.projectId = envelope.project.id || state.projectId;
          renderControls();
          return envelope;
        });
      }
      throw new Error('No runtime bridge is available for campaign history.');
    }

    function platformErrorDetail(error) {
      var message = error && error.message ? error.message : String(error || 'Platform request failed.');
      var jsonStart = message.indexOf('{');
      if (jsonStart >= 0) {
        try {
          var parsed = JSON.parse(message.slice(jsonStart));
          if (parsed && parsed.error) return parsed.error;
          if (parsed && parsed.message) return parsed.message;
        } catch (_) {}
      }
      return message;
    }

    function missingManualEndpoint(error) {
      var message = error && error.message ? error.message : String(error || '');
      return /HTTP 404/.test(message) && /\/api\/mcpviews\/email-deliverability\//.test(message) && message.indexOf('"error"') < 0;
    }

    function withManualContext(payload) {
      return compactObject(Object.assign({}, payload || {}, {
        organizationId: normalizeIdentifier(state.organizationId),
        workspaceId: normalizeIdentifier(state.workspaceId),
        projectId: normalizeIdentifier(state.projectId),
        threadId: normalizeIdentifier(state.threadId),
      }));
    }

    function callRuntimeHistory(payload) {
      return ensureRuntimeEnvelope().then(function(envelope) {
        var runtimeSession = envelope && envelope.runtimeSession;
        var token = runtimeSession && runtimeSession.token;
        var host = runtimeSession && runtimeSession.connection && runtimeSession.connection.host;
        if (!token || !host) throw new Error('Runtime session did not include a direct platform bearer token.');
        return fetch(host.replace(/\/+$/, '') + '/api/internal/runtime/email-deliverability/campaigns/history', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload || {}),
        }).then(function(response) {
          return response.json().catch(function() { return null; }).then(function(body) {
            if (!response.ok) {
              throw new Error(body && body.error ? body.error : 'Platform request failed (' + response.status + ').');
            }
            return body;
          });
        });
      });
    }

    function callHistory(payload) {
      var api = client();
      if (api && typeof api.request === 'function') {
        return api.request('POST', '/api/mcpviews/email-deliverability/campaigns/history', withManualContext(payload)).catch(function(error) {
          if (missingManualEndpoint(error)) return callRuntimeHistory(payload);
          throw new Error(platformErrorDetail(error));
        });
      }
      if (api && typeof api.callEmailDeliverability === 'function') {
        return api.callEmailDeliverability('history', withManualContext(payload || {})).catch(function(error) {
          if (missingManualEndpoint(error)) return callRuntimeHistory(payload);
          throw new Error(platformErrorDetail(error));
        });
      }
      return callRuntimeHistory(payload);
    }

    function loadHistory() {
      if (!state.workspaceId) throw new Error('Select a workspace first.');
      var payload = compactObject({
        limit: Math.min(Math.max(Number(state.limit || 25), 1), 100),
        status: state.statusFilter || undefined,
        includeEvents: state.includeEvents,
      });
      return callHistory(payload).then(function(result) {
        state.lastResult = result;
        state.campaigns = Array.isArray(result && result.campaigns) ? result.campaigns : [];
        if (!state.selectedCampaignId && state.campaigns[0]) {
          state.selectedCampaignId = campaignRecord(state.campaigns[0]).id;
        }
        renderAll();
        setStatus('History loaded', state.campaigns.length + ' campaign(s)');
        return result;
      });
    }

    organizationSelect.addEventListener('change', function() {
      state.organizationId = organizationSelect.value;
      state.workspaceId = '';
      state.workspaceOptions = [];
      state.campaigns = [];
      state.selectedCampaignId = '';
      renderAll();
      runAction('load-workspaces');
    });

    workspaceSelect.addEventListener('change', function() {
      state.workspaceId = workspaceSelect.value;
      state.campaigns = [];
      state.selectedCampaignId = '';
      renderAll();
      if (state.workspaceId) runAction('refresh-history');
    });

    statusFilterEl.addEventListener('change', function() {
      state.statusFilter = statusFilterEl.value;
      if (state.workspaceId) runAction('refresh-history');
    });

    limitEl.addEventListener('input', function() {
      state.limit = Math.min(Math.max(Number(limitEl.value || 25), 1), 100);
    });

    container.addEventListener('click', function(event) {
      var actionEl = event.target.closest('[data-action]');
      if (actionEl) {
        runAction(actionEl.getAttribute('data-action'));
        return;
      }
      var row = event.target.closest('[data-campaign-id]');
      if (row) {
        state.selectedCampaignId = row.getAttribute('data-campaign-id') || '';
        renderTable();
        renderDetail();
      }
    });

    function runAction(action) {
      clearError();
      var promise;
      try {
        if (action === 'discover-context') promise = discoverContext();
        if (action === 'load-workspaces') promise = loadWorkspacesForSelectedOrg().then(function() {
          if (state.workspaceId) return loadHistory();
          return null;
        });
        if (action === 'refresh-history') promise = loadHistory();
        if (!promise) return;
        setBusy(true, 'Working');
        promise.catch(showError).finally(function() {
          setBusy(false);
        });
      } catch (error) {
        showError(error);
      }
    }

    renderAll();
    if (client()) {
      setBusy(true, 'Finding organizations');
      discoverContext().catch(showError).finally(function() {
        setBusy(false);
      });
    } else {
      state.contextStatus = 'TribeX AI client is unavailable. Open from an authenticated MCPViews AI session.';
      renderControls();
    }
  };
})();
