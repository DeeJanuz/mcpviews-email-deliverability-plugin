(function() {
  'use strict';

  window.__renderers = window.__renderers || {};

  var FILTERED_AUDIENCE_SCHEMA_VERSION = 'tribex.emailFilteredAudience.v1';
  var OPERATORS = [
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'in',
    'not_in',
    'exists',
    'not_exists',
    'gt',
    'gte',
    'lt',
    'lte',
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
    if (Array.isArray(value)) return value.map(compactObject);
    if (!isRecord(value)) return value;
    var out = {};
    Object.keys(value).forEach(function(key) {
      var nested = value[key];
      if (nested === undefined || nested === '') return;
      out[key] = compactObject(nested);
    });
    return out;
  }

  function normalizeWorkspacePath(value) {
    return String(value || '')
      .trim()
      .replace(/^\/+/, '')
      .replace(/^workspace\/files\//, '');
  }

  function filePath(file) {
    return normalizeWorkspacePath(firstString([
      file && file.relativePath,
      file && file.workspacePath,
      file && file.path,
    ], ''));
  }

  function fileChecksum(file) {
    return firstString([
      file && file.checksum,
      file && file.sha256,
      file && file.metadata && file.metadata.sha256,
    ], '').replace(/^sha256:/i, '');
  }

  function artifactKind(file) {
    var path = filePath(file).toLowerCase();
    var contentType = String(file && file.contentType || '').toLowerCase();
    if (path.endsWith('.html') || path.endsWith('.htm') || contentType.indexOf('text/html') === 0) return 'html';
    if (path.endsWith('.campaign.json') || path.indexOf('/campaigns/') >= 0) return 'campaign';
    if (path.endsWith('.audience.json') || path.endsWith('.csv') || path.indexOf('/audiences/') >= 0) return 'audience';
    if (path.endsWith('.json') || contentType.indexOf('json') >= 0) return 'json';
    return 'other';
  }

  function artifactLabel(file) {
    var kind = artifactKind(file);
    var label = kind === 'html' ? 'HTML' : kind === 'campaign' ? 'Campaign' : kind === 'audience' ? 'Audience' : 'JSON';
    return label + ' - ' + filePath(file);
  }

  function campaignLabel(campaign) {
    if (!isRecord(campaign)) return 'Campaign';
    var status = firstString([campaign.status], 'PREPARED');
    var created = firstString([campaign.createdAt], '');
    var suffix = created ? ' - ' + created.slice(0, 10) : '';
    return firstString([campaign.name, campaign.id], 'Campaign') + ' (' + status + ')' + suffix;
  }

  function artifactKey(file) {
    return firstString([file && file.id, file && file.workspaceFileId], '') || filePath(file);
  }

  function isWorkspaceFileId(value) {
    var id = String(value || '').trim();
    return Boolean(id && id.indexOf('/') < 0);
  }

  function workspaceFileId(value) {
    var id = firstString([value && value.id, value && value.workspaceFileId, value && value.fileId], '');
    return isWorkspaceFileId(id) ? id : '';
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

  function optionHtml(value, label, selected) {
    return '<option value="' + esc(value || '') + '"' + (selected ? ' selected' : '') + '>' + esc(label || value || '') + '</option>';
  }

  function normalizeArtifactRef(value, fallbackFormat) {
    if (!isRecord(value)) return null;
    var workspacePath = firstString([value.workspacePath, value.relativePath], '');
    var id = workspaceFileId(value);
    var sha256 = firstString([value.sha256, value.resolvedSha256], '').replace(/^sha256:/i, '');
    var format = firstString([value.format], fallbackFormat || '');
    if (!workspacePath && !id) return null;
    return compactObject({
      source: value.source || 'workspace_file',
      format: format,
      workspacePath: workspacePath,
      workspaceFileId: id,
      sha256: sha256,
      sizeBytes: value.sizeBytes,
    });
  }

  function workspaceFileRef(file, format, sha256) {
    return compactObject({
      source: 'workspace_file',
      format: format,
      workspacePath: filePath(file),
      workspaceFileId: workspaceFileId(file),
      sha256: sha256 || fileChecksum(file),
      sizeBytes: file && file.sizeBytes,
    });
  }

  function normalizeDraftInput(input) {
    var raw = isRecord(input) ? input : {};
    var prepare = isRecord(raw.campaignPreparePayload) ? raw.campaignPreparePayload : {};
    var metadata = isRecord(prepare.metadata) ? prepare.metadata : {};
    var htmlRef =
      normalizeArtifactRef(raw.htmlTemplateArtifactRef, 'html') ||
      normalizeArtifactRef(prepare.htmlTemplateArtifactRef, 'html') ||
      normalizeArtifactRef(metadata.htmlTemplateArtifactRef, 'html');
    var audienceRef =
      normalizeArtifactRef(raw.audienceArtifactRef, 'json') ||
      normalizeArtifactRef(prepare.audienceArtifactRef, 'json') ||
      normalizeArtifactRef(metadata.audienceArtifactRef, 'json');
    var merged = compactObject(Object.assign({}, raw, prepare, {
      testTo: raw.testTo || prepare.testTo,
      htmlTemplateArtifactRef: htmlRef,
      audienceArtifactRef: audienceRef,
      htmlArtifactPath: htmlRef && htmlRef.workspacePath || raw.htmlArtifactPath,
      htmlArtifactFileId: htmlRef && htmlRef.workspaceFileId || raw.htmlArtifactFileId,
      htmlArtifactSha256: htmlRef && htmlRef.sha256 || raw.htmlArtifactSha256,
      audienceArtifactPath: audienceRef && audienceRef.workspacePath || raw.audienceArtifactPath,
      audienceArtifactFileId: audienceRef && audienceRef.workspaceFileId || raw.audienceArtifactFileId,
      audienceArtifactFormat: audienceRef && audienceRef.format || raw.audienceArtifactFormat || 'json',
      audienceArtifactSha256: audienceRef && audienceRef.sha256 || raw.audienceArtifactSha256,
      audienceFilterSpec: raw.audienceFilterSpec || prepare.audienceFilterSpec || metadata.audienceFilterSpec,
      audienceFilterHash: raw.audienceFilterHash || prepare.audienceFilterHash || metadata.audienceFilterHash,
      audienceFilterCounts: raw.audienceFilterCounts || prepare.audienceFilterCounts || metadata.audienceFilterCounts,
    }));
    delete merged.campaignPreparePayload;
    delete merged.fromEmail;
    delete merged.sendingIdentityId;
    return merged;
  }

  function csvRowsFromText(text) {
    var rows = [];
    var row = [];
    var field = '';
    var quoted = false;
    var input = String(text || '');
    for (var index = 0; index < input.length; index += 1) {
      var char = input[index];
      if (quoted) {
        if (char === '"') {
          if (input[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          field += char;
        }
        continue;
      }
      if (char === '"') {
        quoted = true;
        continue;
      }
      if (char === ',') {
        row.push(field);
        field = '';
        continue;
      }
      if (char === '\n') {
        row.push(field.replace(/\r$/, ''));
        rows.push(row);
        row = [];
        field = '';
        continue;
      }
      field += char;
    }
    if (quoted) throw new Error('CSV audience artifact has an unterminated quoted field.');
    if (field.length > 0 || row.length > 0) {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
    }
    return rows.filter(function(candidate) {
      return candidate.some(function(value) { return String(value || '').trim().length > 0; });
    });
  }

  function parseCsvAudience(text) {
    var rows = csvRowsFromText(text);
    if (rows.length < 2) throw new Error('CSV audience artifact must include a header row and at least one data row.');
    var headers = rows[0].map(function(header) { return header.trim(); });
    if (headers.some(function(header) { return !header; })) throw new Error('CSV audience artifact headers must be non-empty.');
    var seen = {};
    headers.forEach(function(header) {
      if (seen[header]) throw new Error('CSV audience artifact has duplicate header: ' + header + '.');
      seen[header] = true;
    });
    return rows.slice(1).map(function(cells) {
      var record = {};
      headers.forEach(function(header, index) {
        record[header] = cells[index] || '';
      });
      return record;
    });
  }

  function parseJsonAudience(text) {
    var parsed = JSON.parse(text || '[]');
    if (Array.isArray(parsed)) return parsed;
    if (isRecord(parsed)) {
      var preferredKeys = ['audience', 'rows', 'candidates', 'items', 'data', 'records', 'clients'];
      for (var index = 0; index < preferredKeys.length; index += 1) {
        if (Array.isArray(parsed[preferredKeys[index]])) return parsed[preferredKeys[index]];
      }
      var arrayKey = Object.keys(parsed).sort().find(function(key) {
        return Array.isArray(parsed[key]);
      });
      if (arrayKey) return parsed[arrayKey];
    }
    throw new Error('JSON audience artifact must be an array, or an object with an audience-like array such as audience, rows, candidates, items, data, records, or clients.');
  }

  function parseAudience(text, format) {
    var rows = String(format || 'json').toLowerCase() === 'csv'
      ? parseCsvAudience(text)
      : parseJsonAudience(text);
    return rows.map(function(row, index) {
      if (!isRecord(row)) throw new Error('Audience row ' + (index + 1) + ' must be an object.');
      return row;
    });
  }

  function isScalar(value) {
    return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }

  function collectPaths(record, prefix, out) {
    Object.keys(record).sort().forEach(function(key) {
      var value = record[key];
      var path = prefix ? prefix + '.' + key : key;
      if (isScalar(value)) {
        out[path] = true;
      } else if (isRecord(value)) {
        collectPaths(value, path, out);
      }
    });
  }

  function collectAudienceFieldPaths(rows) {
    var paths = {};
    rows.forEach(function(row) {
      if (isRecord(row)) collectPaths(row, '', paths);
    });
    return Object.keys(paths).sort();
  }

  function readField(row, path) {
    var current = row;
    var parts = String(path || '').split('.').filter(Boolean);
    for (var i = 0; i < parts.length; i += 1) {
      if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, parts[i])) {
        return { exists: false, value: undefined };
      }
      current = current[parts[i]];
    }
    return { exists: true, value: current };
  }

  function normalizeFilterSpec(spec) {
    var raw = isRecord(spec) ? spec : {};
    return {
      combine: raw.combine === 'any' ? 'any' : 'all',
      predicates: (Array.isArray(raw.predicates) ? raw.predicates : []).map(function(predicate) {
        if (!isRecord(predicate)) return null;
        var operator = firstString([predicate.operator], 'equals');
        if (OPERATORS.indexOf(operator) < 0) return null;
        var fieldPath = firstString([predicate.fieldPath, predicate.field], '');
        if (!fieldPath && operator !== 'exists' && operator !== 'not_exists') return null;
        var value = predicate.value;
        if (operator === 'in' || operator === 'not_in') {
          value = Array.isArray(value)
            ? value.map(String)
            : String(value == null ? '' : value).split(',').map(function(item) { return item.trim(); }).filter(Boolean);
        }
        return compactObject({
          mode: predicate.mode === 'exclude' ? 'exclude' : 'include',
          fieldPath: fieldPath,
          operator: operator,
          value: value,
        });
      }).filter(Boolean),
    };
  }

  function stableJsonStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableJsonStringify).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function(key) {
      return JSON.stringify(key) + ':' + stableJsonStringify(value[key]);
    }).join(',') + '}';
  }

  function bytesToHex(bytes) {
    return Array.prototype.map.call(bytes, function(byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function sha256Text(text) {
    if (!window.crypto || !window.crypto.subtle || !window.TextEncoder) {
      return Promise.resolve('');
    }
    return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || ''))).then(function(digest) {
      return bytesToHex(new Uint8Array(digest));
    }).catch(function() {
      return '';
    });
  }

  function sha256Bytes(bytes, fallback) {
    if (window.crypto && window.crypto.subtle && typeof window.crypto.subtle.digest === 'function') {
      var data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return window.crypto.subtle.digest('SHA-256', data).then(function(digest) {
        return bytesToHex(new Uint8Array(digest));
      }).catch(function() {
        return fallback || '';
      });
    }
    return Promise.resolve(fallback || '');
  }

  function bytesToText(bytes) {
    if (window.TextDecoder) return new TextDecoder('utf-8').decode(bytes);
    var text = '';
    for (var i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(text));
  }

  function comparable(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return JSON.stringify(value);
  }

  function evalPredicate(row, predicate) {
    var field = readField(row, predicate.fieldPath);
    if (predicate.operator === 'exists') return { matched: field.exists && field.value !== undefined, invalid: false };
    if (predicate.operator === 'not_exists') return { matched: !field.exists || field.value === undefined, invalid: false };
    if (!field.exists || field.value === undefined) return { matched: false, invalid: false };
    if (['gt', 'gte', 'lt', 'lte'].indexOf(predicate.operator) >= 0) {
      var left = Number(field.value);
      var right = Number(predicate.value);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return { matched: false, invalid: true };
      if (predicate.operator === 'gt') return { matched: left > right, invalid: false };
      if (predicate.operator === 'gte') return { matched: left >= right, invalid: false };
      if (predicate.operator === 'lt') return { matched: left < right, invalid: false };
      return { matched: left <= right, invalid: false };
    }
    var actual = comparable(field.value);
    var expected = comparable(predicate.value);
    if (predicate.operator === 'equals') return { matched: actual === expected, invalid: false };
    if (predicate.operator === 'not_equals') return { matched: actual !== expected, invalid: false };
    if (predicate.operator === 'contains') return { matched: actual.indexOf(expected) >= 0, invalid: false };
    if (predicate.operator === 'not_contains') return { matched: actual.indexOf(expected) < 0, invalid: false };
    if (predicate.operator === 'in') return { matched: (predicate.value || []).map(comparable).indexOf(actual) >= 0, invalid: false };
    if (predicate.operator === 'not_in') return { matched: (predicate.value || []).map(comparable).indexOf(actual) < 0, invalid: false };
    return { matched: false, invalid: true };
  }

  function applyFilter(rows, spec) {
    var normalized = normalizeFilterSpec(spec);
    var filtered = [];
    var invalidRows = [];
    rows.forEach(function(row, index) {
      if (!isRecord(row)) {
        invalidRows.push({ index: index, reason: 'row_not_object' });
        return;
      }
      if (!normalized.predicates.length) {
        filtered.push(row);
        return;
      }
      var evaluations = normalized.predicates.map(function(predicate) {
        var result = evalPredicate(row, predicate);
        return {
          invalid: result.invalid,
          passes: predicate.mode === 'exclude' ? !result.matched : result.matched,
        };
      });
      if (evaluations.some(function(result) { return result.invalid; })) {
        invalidRows.push({ index: index, reason: 'invalid_predicate_value' });
        return;
      }
      var passes = normalized.combine === 'any'
        ? evaluations.some(function(result) { return result.passes; })
        : evaluations.every(function(result) { return result.passes; });
      if (passes) filtered.push(row);
    });
    return sha256Text(stableJsonStringify(normalized)).then(function(hash) {
      return {
        filterSpec: normalized,
        filterHash: hash,
        rows: filtered,
        fieldPaths: collectAudienceFieldPaths(rows),
        counts: {
          source: rows.length,
          filtered: filtered.length,
          excluded: rows.length - filtered.length - invalidRows.length,
          invalid: invalidRows.length,
        },
        invalidRows: invalidRows,
      };
    });
  }

  function slugify(value) {
    return String(value || 'email-campaign')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'email-campaign';
  }

  function humanizeSlug(value) {
    var cleaned = String(value || '')
      .replace(/\.[^.]+$/g, '')
      .replace(/\.campaign$/i, '')
      .replace(/\.audience$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return '';
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  function timestampId() {
    return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  }

  function browserTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (_) {
      return 'UTC';
    }
  }

  function normalizedJoinPath(folder, fileName) {
    var normalizedFolder = normalizeWorkspacePath(folder || 'email/audiences/filtered').replace(/\/+$/, '');
    var normalizedFile = normalizeWorkspacePath(fileName || 'filtered-audience.audience.json').replace(/^\/+/, '');
    if (!/\.json$/i.test(normalizedFile)) normalizedFile += '.audience.json';
    return (normalizedFolder ? normalizedFolder + '/' : '') + normalizedFile;
  }

  function localDateTimeToIso(value, timeZone) {
    var match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return '';
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var hour = Number(match[4]);
    var minute = Number(match[5]);
    var zone = String(timeZone || browserTimeZone() || 'UTC').trim();
    if (!zone || zone === browserTimeZone()) {
      var local = new Date(year, month - 1, day, hour, minute, 0, 0);
      return Number.isFinite(local.getTime()) ? local.toISOString() : '';
    }
    try {
      var targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
      var formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      for (var index = 0; index < 3; index += 1) {
        var parts = {};
        formatter.formatToParts(new Date(targetUtc)).forEach(function(part) {
          if (part.type !== 'literal') parts[part.type] = Number(part.value);
        });
        var zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0, 0);
        targetUtc += Date.UTC(year, month - 1, day, hour, minute, 0, 0) - zonedAsUtc;
      }
      return new Date(targetUtc).toISOString();
    } catch (_) {
      var fallback = new Date(year, month - 1, day, hour, minute, 0, 0);
      return Number.isFinite(fallback.getTime()) ? fallback.toISOString() : '';
    }
  }

  function dateTimeLocalDefault() {
    var date = new Date(Date.now() + 10 * 60 * 1000);
    date.setSeconds(0, 0);
    var pad = function(value) { return String(value).padStart(2, '0'); };
    return [
      date.getFullYear(),
      '-',
      pad(date.getMonth() + 1),
      '-',
      pad(date.getDate()),
      'T',
      pad(date.getHours()),
      ':',
      pad(date.getMinutes()),
    ].join('');
  }

  function emailFromAudienceRow(row) {
    return firstString([
      row && row.email,
      row && row.emailAddress,
      row && row.email_address,
      row && row.contact && row.contact.email,
    ], '');
  }

  function button(label, id, kind) {
    return '<button type="button" class="email-launcher-btn ' + (kind || '') + '" data-action="' + esc(id) + '">' + esc(label) + '</button>';
  }

  function labelWithTip(label, help) {
    return '<label class="email-launcher-label">' + esc(label) +
      (help
        ? '<span class="email-launcher-tip" tabindex="0" role="img" title="' + esc(help) + '" aria-label="' + esc(help) + '">?</span>'
        : '') +
      '</label>';
  }

  function previewValue(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  function launcherStyles() {
    var selectChevronDark = 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%239ca3af%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E")';
    var selectChevronLight = 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b7280%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E")';
    return ''
      + '.email-launcher{'
      + '  --glass-bg:rgba(255,255,255,0.06);'
      + '  --glass-bg-heavy:rgba(255,255,255,0.10);'
      + '  --glass-border:rgba(255,255,255,0.10);'
      + '  --glass-blur:12px;'
      + '  --glass-shadow:0 8px 32px rgba(0,0,0,0.40);'
      + '  --glass-inset-highlight:inset 0 1px 0 rgba(255,255,255,0.06);'
      + '  --bg-app:#0f1117;'
      + '  --bg-surface:rgba(255,255,255,0.05);'
      + '  --bg-surface-hover:rgba(255,255,255,0.08);'
      + '  --bg-surface-subtle:rgba(255,255,255,0.03);'
      + '  --text-primary:rgba(255,255,255,0.95);'
      + '  --text-secondary:rgba(255,255,255,0.62);'
      + '  --text-tertiary:rgba(255,255,255,0.38);'
      + '  --accent-primary:#818cf8;'
      + '  --accent-primary-hover:#6366f1;'
      + '  --accent-primary-ghost:rgba(129,140,248,0.12);'
      + '  --border-default:rgba(255,255,255,0.08);'
      + '  --border-subtle:rgba(255,255,255,0.04);'
      + '  --border-strong:rgba(255,255,255,0.15);'
      + '  --color-warning:#f59e0b;'
      + '  --color-warning-bg:rgba(245,158,11,0.14);'
      + '  --color-warning-text:#fcd34d;'
      + '  --color-error-bg:rgba(239,68,68,0.15);'
      + '  --color-error-text:#fca5a5;'
      + '  --color-success-bg:rgba(34,197,94,0.15);'
      + '  --color-success-text:#86efac;'
      + '  --font-sans:Figtree,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
      + '  --font-mono:"SF Mono","Fira Code","Cascadia Code",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;'
      + '  --text-h1:24px;'
      + '  --text-h3:16px;'
      + '  --text-body:14px;'
      + '  --text-small:12px;'
      + '  --text-xs:11px;'
      + '  --weight-medium:500;'
      + '  --weight-semibold:600;'
      + '  --weight-bold:700;'
      + '  --space-1:4px;'
      + '  --space-2:8px;'
      + '  --space-3:12px;'
      + '  --space-4:16px;'
      + '  --space-5:20px;'
      + '  --space-6:24px;'
      + '  --border-radius-sm:4px;'
      + '  --border-radius-md:8px;'
      + '  --border-radius-lg:12px;'
      + '  --border-radius-pill:999px;'
      + '  --transition-fast:0.15s ease;'
      + '  min-height:100%;'
      + '  padding:var(--space-6) var(--space-4);'
      + '  box-sizing:border-box;'
      + '  color:var(--text-primary);'
      + '  background:radial-gradient(circle at top left,rgba(129,140,248,0.18),transparent 34%),linear-gradient(180deg,#0b1020 0%,#0f1117 55%,#111827 100%);'
      + '  font:var(--text-body)/1.45 var(--font-sans);'
      + '}'
      + '.email-launcher *{box-sizing:border-box;}'
      + '.email-launcher h2,.email-launcher h3,.email-launcher p{margin:0;}'
      + '.email-launcher-shell{max-width:1280px;margin:0 auto;display:grid;gap:var(--space-4);}'
      + '.email-launcher-top{display:flex;justify-content:space-between;gap:var(--space-4);align-items:flex-start;}'
      + '.email-launcher-kicker{color:var(--text-tertiary);font-size:var(--text-xs);font-weight:var(--weight-semibold);text-transform:uppercase;letter-spacing:0;margin-bottom:4px;}'
      + '.email-launcher-title h2{font-size:var(--text-h1);line-height:1.2;font-weight:var(--weight-bold);color:var(--text-primary);}'
      + '.email-launcher-title p{margin-top:4px;color:var(--text-secondary);font-size:var(--text-small);}'
      + '.email-launcher-status{min-width:240px;border:1px solid var(--glass-border);background:var(--glass-bg);border-radius:var(--border-radius-lg);padding:var(--space-3);color:var(--text-secondary);box-shadow:var(--glass-shadow),var(--glass-inset-highlight);backdrop-filter:blur(var(--glass-blur));-webkit-backdrop-filter:blur(var(--glass-blur));}'
      + '.email-launcher-status strong{display:block;color:var(--text-primary);font-weight:var(--weight-semibold);}'
      + '.email-launcher-status span{display:block;margin-top:3px;font-size:var(--text-xs);line-height:1.35;color:var(--text-tertiary);}'
      + '.email-launcher-grid{display:grid;grid-template-columns:minmax(320px,420px) 1fr;gap:var(--space-4);align-items:start;}'
      + '.email-launcher-step-grid{grid-template-columns:repeat(2,minmax(0,1fr));}'
      + '.email-launcher [hidden]{display:none!important;}'
      + '.email-launcher-stepper{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:var(--space-2);border:1px solid var(--border-default);background:var(--bg-surface-subtle);border-radius:var(--border-radius-lg);padding:var(--space-2);}'
      + '.email-launcher-wizard-step{min-height:54px;border:1px solid transparent;background:transparent;color:var(--text-secondary);border-radius:var(--border-radius-md);padding:8px 10px;text-align:left;font:inherit;cursor:pointer;transition:border-color var(--transition-fast),background var(--transition-fast),color var(--transition-fast);}'
      + '.email-launcher-wizard-step:hover{border-color:var(--border-default);background:var(--bg-surface);color:var(--text-primary);}'
      + '.email-launcher-wizard-step.active{border-color:rgba(129,140,248,.42);background:var(--accent-primary-ghost);color:var(--text-primary);}'
      + '.email-launcher-wizard-step span{display:block;font-size:var(--text-xs);font-weight:var(--weight-semibold);color:var(--text-tertiary);}'
      + '.email-launcher-wizard-step strong{display:block;margin-top:2px;font-size:var(--text-small);line-height:1.2;font-weight:var(--weight-semibold);}'
      + '.email-launcher-panel{background:var(--glass-bg);backdrop-filter:blur(var(--glass-blur));-webkit-backdrop-filter:blur(var(--glass-blur));border:1px solid var(--glass-border);border-radius:var(--border-radius-lg);padding:var(--space-4);box-shadow:var(--glass-shadow),var(--glass-inset-highlight);}'
      + '.email-launcher-panel h3{display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-h3);font-weight:var(--weight-semibold);color:var(--text-primary);margin-bottom:var(--space-3);}'
      + '.email-launcher-panel h3::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent-primary);box-shadow:0 0 0 3px rgba(129,140,248,0.12);}'
      + '.email-launcher-field{display:grid;gap:var(--space-1);margin:0 0 var(--space-3);}'
      + '.email-launcher-field label{font-size:var(--text-xs);font-weight:var(--weight-semibold);color:var(--text-secondary);text-transform:uppercase;letter-spacing:0;}'
      + '.email-launcher-label{display:flex;align-items:center;gap:6px;min-width:0;}'
      + '.email-launcher-tip{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:1px solid var(--border-default);border-radius:var(--border-radius-pill);background:var(--bg-surface);color:var(--text-tertiary);font-size:10px;line-height:1;text-transform:none;cursor:help;flex-shrink:0;}'
      + '.email-launcher-tip:hover,.email-launcher-tip:focus{border-color:var(--accent-primary);color:var(--text-primary);outline:none;}'
      + '.email-launcher input,.email-launcher textarea,.email-launcher select{width:100%;min-height:38px;border:1px solid var(--border-default);border-radius:var(--border-radius-md);background:var(--bg-surface);color:var(--text-primary);padding:8px 10px;font:inherit;outline:none;transition:border-color var(--transition-fast),background-color var(--transition-fast);}'
      + '.email-launcher textarea{min-height:88px;resize:vertical;}'
      + '.email-launcher select{appearance:none;-webkit-appearance:none;color-scheme:dark;background-color:var(--bg-surface);background-image:' + selectChevronDark + ';background-repeat:no-repeat;background-position:right 11px center;background-size:14px 14px;padding-right:34px;}'
      + '.email-launcher input:focus,.email-launcher textarea:focus,.email-launcher select:focus{border-color:var(--accent-primary);}'
      + '.email-launcher input:focus,.email-launcher textarea:focus{background:var(--bg-surface-hover);}'
      + '.email-launcher select:focus{background-color:var(--bg-surface-hover);}'
      + '.email-launcher input::placeholder,.email-launcher textarea::placeholder{color:var(--text-tertiary);}'
      + '.email-launcher-row{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);}'
      + '.email-launcher-actions{display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center;}'
      + '.email-launcher-btn{min-height:38px;border:1px solid var(--border-default);background:var(--bg-surface);color:var(--text-primary);border-radius:var(--border-radius-md);padding:0 14px;font-weight:var(--weight-semibold);font-size:var(--text-small);font-family:inherit;cursor:pointer;transition:border-color var(--transition-fast),background var(--transition-fast),color var(--transition-fast),transform var(--transition-fast);}'
      + '.email-launcher-btn:hover{border-color:var(--border-strong);background:var(--bg-surface-hover);}'
      + '.email-launcher-btn:active{transform:scale(0.98);}'
      + '.email-launcher-btn.primary{background:var(--accent-primary);color:#fff;border-color:var(--accent-primary);}'
      + '.email-launcher-btn.primary:hover{background:var(--accent-primary-hover);border-color:var(--accent-primary-hover);}'
      + '.email-launcher-btn.warn{background:var(--color-warning-bg);border-color:rgba(245,158,11,0.32);color:var(--color-warning-text);}'
      + '.email-launcher-btn:disabled{opacity:.5;cursor:not-allowed;transform:none;}'
      + '.email-launcher-counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--space-3);}'
      + '.email-launcher-count{border:1px solid var(--border-subtle);background:var(--bg-surface);border-radius:var(--border-radius-md);padding:var(--space-3);min-width:0;}'
      + '.email-launcher-count span{display:block;color:var(--text-secondary);font-size:var(--text-xs);font-weight:var(--weight-semibold);text-transform:uppercase;letter-spacing:0;}'
      + '.email-launcher-count strong{display:block;margin-top:4px;font-size:var(--text-h1);line-height:1.1;font-weight:var(--weight-bold);color:var(--accent-primary);}'
      + '.email-launcher-filter-row{display:grid;grid-template-columns:minmax(84px,.75fr) minmax(0,1.25fr) minmax(112px,.85fr) minmax(0,1fr) 38px;gap:var(--space-2);margin:0 0 var(--space-2);align-items:start;min-width:0;}'
      + '.email-launcher-filter-row select,.email-launcher-filter-row input{min-width:0;}'
      + '.email-launcher-filter-row .email-launcher-btn{padding:0;min-width:38px;color:var(--text-secondary);}'
      + '.email-launcher-preview{margin-top:var(--space-3);border:1px solid var(--border-subtle);border-radius:var(--border-radius-md);background:var(--bg-surface-subtle);overflow:hidden;}'
      + '.email-launcher-preview-head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-3);border-bottom:1px solid var(--border-subtle);}'
      + '.email-launcher-preview-head strong{font-size:var(--text-small);font-weight:var(--weight-semibold);color:var(--text-primary);}'
      + '.email-launcher-preview-head span{font-size:var(--text-xs);color:var(--text-tertiary);text-align:right;}'
      + '.email-launcher-preview-scroll{max-height:240px;overflow:auto;}'
      + '.email-launcher-preview table{width:100%;border-collapse:collapse;min-width:620px;font-size:var(--text-small);}'
      + '.email-launcher-preview th,.email-launcher-preview td{padding:8px 10px;border-bottom:1px solid var(--border-subtle);text-align:left;vertical-align:top;}'
      + '.email-launcher-preview th{position:sticky;top:0;z-index:1;background:rgba(17,24,39,.96);color:var(--text-secondary);font-size:var(--text-xs);font-weight:var(--weight-semibold);text-transform:uppercase;letter-spacing:0;}'
      + '.email-launcher-preview td{color:var(--text-primary);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      + '.email-launcher-preview-empty{padding:var(--space-3);font-size:var(--text-small);color:var(--text-tertiary);}'
      + '.email-launcher-workflow-actions{display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center;margin-bottom:var(--space-3);}'
      + '.email-launcher-workflow-actions .email-launcher-btn{min-width:112px;}'
      + '.email-launcher-btn.step{border-radius:var(--border-radius-pill);}'
      + '.email-launcher-btn.step.active{background:var(--accent-primary);border-color:var(--accent-primary);color:#fff;}'
      + '.email-launcher-workflow-body{border:1px solid var(--border-subtle);border-radius:var(--border-radius-md);background:var(--bg-surface-subtle);padding:var(--space-4);min-height:180px;}'
      + '.email-launcher-kv{display:grid;grid-template-columns:minmax(120px,220px) minmax(0,1fr);gap:0;border:1px solid var(--border-subtle);border-radius:var(--border-radius-md);overflow:hidden;background:var(--bg-surface);}'
      + '.email-launcher-kv dt,.email-launcher-kv dd{padding:9px 10px;border-bottom:1px solid var(--border-subtle);min-width:0;}'
      + '.email-launcher-kv dt{color:var(--text-secondary);font-size:var(--text-xs);font-weight:var(--weight-semibold);text-transform:uppercase;letter-spacing:0;background:var(--bg-surface-subtle);}'
      + '.email-launcher-kv dd{margin:0;color:var(--text-primary);word-break:break-word;}'
      + '.email-launcher-kv dt:last-of-type,.email-launcher-kv dd:last-of-type{border-bottom:0;}'
      + '.email-launcher-email-preview{display:grid;gap:var(--space-3);}'
      + '.email-launcher-email-frame{width:100%;height:420px;border:1px solid var(--border-default);border-radius:var(--border-radius-md);background:#fff;}'
      + '.email-launcher-chip-row{display:flex;gap:var(--space-2);flex-wrap:wrap;margin:0 0 var(--space-3);}'
      + '.email-launcher-chip{display:inline-flex;align-items:center;border:1px solid var(--border-default);border-radius:var(--border-radius-pill);padding:4px 9px;font-size:var(--text-xs);color:var(--text-secondary);background:var(--bg-surface);}'
      + '.email-launcher-file-manager{margin-top:var(--space-3);border:1px solid var(--border-default);background:var(--bg-surface-subtle);border-radius:var(--border-radius-md);padding:var(--space-3);display:grid;gap:var(--space-3);}'
      + '.email-launcher-folder-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--space-2);}'
      + '.email-launcher-folder-option{border:1px solid var(--border-default);background:var(--bg-surface);border-radius:var(--border-radius-md);padding:9px 10px;text-align:left;color:var(--text-primary);font:inherit;cursor:pointer;min-height:44px;}'
      + '.email-launcher-folder-option.active{border-color:rgba(129,140,248,.52);background:var(--accent-primary-ghost);}'
      + '.email-launcher-breadcrumb{display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:var(--text-secondary);font-size:var(--text-small);}'
      + '.email-launcher-breadcrumb span{border:1px solid var(--border-subtle);border-radius:var(--border-radius-pill);padding:3px 8px;background:var(--bg-surface);}'
      + '.email-launcher-result{white-space:pre-wrap;max-height:260px;overflow:auto;background:rgba(0,0,0,0.28);color:rgba(238,242,255,0.92);border:1px solid var(--border-subtle);border-radius:var(--border-radius-md);padding:var(--space-3);font:12px/1.45 var(--font-mono);}'
      + '.email-launcher-error{border:1px solid rgba(239,68,68,0.28);background:var(--color-error-bg);color:var(--color-error-text);border-radius:var(--border-radius-md);padding:var(--space-3);display:none;font-size:var(--text-small);}'
      + '.email-launcher-error.visible{display:block;}'
      + '.email-launcher-small{font-size:var(--text-small);color:var(--text-tertiary);line-height:1.45;}'
      + '.email-launcher-status-line{margin-top:var(--space-2);font-size:var(--text-small);color:var(--text-tertiary);line-height:1.4;}'
      + '.email-launcher-path{margin-top:var(--space-3);padding:var(--space-3);border:1px solid var(--border-subtle);border-radius:var(--border-radius-md);background:var(--bg-surface-subtle);font-size:var(--text-small);line-height:1.45;color:var(--text-secondary);}'
      + '.email-launcher-support-pre{white-space:pre-wrap;word-break:break-word;}'
      + '.email-launcher-details{margin-top:var(--space-3);border-top:1px solid var(--border-subtle);padding-top:var(--space-3);}'
      + '.email-launcher-details summary{cursor:pointer;color:var(--text-secondary);font-size:var(--text-small);font-weight:var(--weight-semibold);}'
      + '.email-launcher-details[open] summary{margin-bottom:var(--space-3);}'
      + '.email-launcher-wide{grid-column:1/-1;}'
      + '@media (prefers-color-scheme:light){.email-launcher{--glass-bg:rgba(255,255,255,0.72);--glass-bg-heavy:rgba(255,255,255,0.86);--glass-border:rgba(0,0,0,0.08);--glass-shadow:0 8px 32px rgba(0,0,0,0.08);--glass-inset-highlight:inset 0 1px 0 rgba(255,255,255,0.5);--bg-app:#f5f5f7;--bg-surface:rgba(255,255,255,0.8);--bg-surface-hover:rgba(255,255,255,0.95);--bg-surface-subtle:rgba(255,255,255,0.5);--text-primary:rgba(0,0,0,0.87);--text-secondary:rgba(0,0,0,0.60);--text-tertiary:rgba(0,0,0,0.38);--border-default:rgba(0,0,0,0.08);--border-subtle:rgba(0,0,0,0.04);--border-strong:rgba(0,0,0,0.15);background:#f5f5f7;}.email-launcher select{color-scheme:light;background-image:' + selectChevronLight + ';}.email-launcher-btn.primary{color:#fff;}.email-launcher-preview th{background:rgba(255,255,255,.96);}}'
      + '@media(max-width:900px){.email-launcher-grid,.email-launcher-step-grid{grid-template-columns:1fr;}.email-launcher-stepper{grid-template-columns:1fr 1fr;}.email-launcher-top{display:grid;}.email-launcher-status{min-width:0;}.email-launcher-counts{grid-template-columns:repeat(2,1fr);}.email-launcher-filter-row{grid-template-columns:1fr;}.email-launcher-filter-row .email-launcher-btn{width:100%;}.email-launcher-row{grid-template-columns:1fr;}.email-launcher-preview-head{display:grid;}.email-launcher-preview-head span{text-align:left;}.email-launcher-kv{grid-template-columns:1fr;}.email-launcher-kv dt{border-bottom:0;}.email-launcher-email-frame{height:340px;}}';
  }

  window.__renderers.email_campaign_launcher = function(container, data) {
    var draft = normalizeDraftInput(data && data.draft);
    var state = {
      organizationId: firstString([data && data.organization_id, data && data.organizationId, draft.organizationId], ''),
      workspaceId: firstString([data && data.workspace_id, data && data.workspaceId, draft.workspaceId], ''),
      projectId: firstString([data && data.project_id, data && data.projectId, draft.projectId], ''),
      threadId: firstString([data && data.thread_id, data && data.threadId, draft.threadId], ''),
      name: firstString([draft.name, draft.templateName], 'Manual email campaign'),
      templateKey: firstString([draft.templateKey], ''),
      templateName: firstString([draft.templateName, draft.name], ''),
      subjectTemplate: firstString([draft.subjectTemplate], ''),
      textTemplate: firstString([draft.textTemplate], ''),
      testTo: firstString([draft.testTo], ''),
      htmlArtifactRef: normalizeArtifactRef(draft.htmlTemplateArtifactRef, 'html') || compactObject({
        source: 'workspace_file',
        format: 'html',
        workspacePath: draft.htmlArtifactPath,
        workspaceFileId: draft.htmlArtifactFileId,
        sha256: draft.htmlArtifactSha256,
      }),
      sourceAudienceRef: normalizeArtifactRef(draft.audienceArtifactRef, draft.audienceArtifactFormat || 'json') || compactObject({
        source: 'workspace_file',
        format: draft.audienceArtifactFormat || 'json',
        workspacePath: draft.audienceArtifactPath,
        workspaceFileId: draft.audienceArtifactFileId,
        sha256: draft.audienceArtifactSha256,
      }),
      audienceRows: [],
      sourceAudienceText: '',
      fieldPaths: [],
      filterSpec: normalizeFilterSpec(draft.audienceFilterSpec),
      filterResult: null,
      filteredAudienceRef: null,
      saveFolder: firstString([draft.saveFolder], 'email/audiences/filtered'),
      saveFileName: firstString([draft.saveFileName], ''),
      selectedSaveFolder: firstString([draft.saveFolder], 'email/audiences/filtered'),
      newFolderName: '',
      saveDialogOpen: false,
      saveFileNameTouched: false,
      saveFolderTouched: false,
      artifacts: [],
      preparedCampaigns: [],
      orgOptions: [],
      workspaceOptions: [],
      contextStatus: 'Finding organizations and workspace context.',
      artifactStatus: 'Select a workspace to load template and audience artifacts.',
      campaignId: '',
      reviewSessionId: '',
      scheduledLocal: dateTimeLocalDefault(),
      scheduledTimeZone: browserTimeZone(),
      wizardStep: 'campaign',
      activeStep: 'prepare',
      preparedResult: null,
      previewResult: null,
      testResult: null,
      reviewResult: null,
      applyResult: null,
      statusResult: null,
      testRecipientIndex: '0',
      testRecipientId: '',
      busy: false,
      status: 'Ready',
      error: '',
      lastResult: null,
    };

    container.innerHTML =
      '<style>' +
      launcherStyles() +
      '</style>' +
      '<div class="email-launcher"><div class="email-launcher-shell">' +
      '<div class="email-launcher-top"><div class="email-launcher-title"><div class="email-launcher-kicker">Campaign Workflow</div><h2>Email Campaigns</h2><p>Manual launcher with artifact-backed templates, audiences, and database-backed campaign drafts.</p></div><div class="email-launcher-status"><strong data-role="status-title">Ready</strong><span data-role="status-detail">Select artifacts, filter, then prepare.</span></div></div>' +
      '<div class="email-launcher-error" data-role="error"></div>' +
      '<div class="email-launcher-stepper" aria-label="Campaign steps">' +
      '<button type="button" class="email-launcher-wizard-step" data-action="wizard-step" data-step="campaign"><span>Step 1</span><strong>Choose campaign</strong></button>' +
      '<button type="button" class="email-launcher-wizard-step" data-action="wizard-step" data-step="audience"><span>Step 2</span><strong>Choose audience</strong></button>' +
      '<button type="button" class="email-launcher-wizard-step" data-action="wizard-step" data-step="filter"><span>Step 3</span><strong>Filter people</strong></button>' +
      '<button type="button" class="email-launcher-wizard-step" data-action="wizard-step" data-step="review-message"><span>Step 4</span><strong>Review message</strong></button>' +
      '<button type="button" class="email-launcher-wizard-step" data-action="wizard-step" data-step="test"><span>Step 5</span><strong>Send test</strong></button>' +
      '<button type="button" class="email-launcher-wizard-step" data-action="wizard-step" data-step="approve"><span>Step 6</span><strong>Approve and schedule</strong></button>' +
      '<button type="button" class="email-launcher-wizard-step" data-action="wizard-step" data-step="status"><span>Step 7</span><strong>Status</strong></button>' +
      '</div>' +
      '<div data-wizard-step="campaign" class="email-launcher-grid email-launcher-step-grid">' +
      '<section class="email-launcher-panel"><h3>Context</h3><div class="email-launcher-row"><div class="email-launcher-field">' + labelWithTip('Organization', 'Organizations are loaded from your current TribeX AI permissions.') + '<select data-select="organizationId"></select></div><div class="email-launcher-field">' + labelWithTip('Workspace', 'Workspaces are scoped to the selected organization and drive durable artifact search.') + '<select data-select="workspaceId"></select></div></div><div class="email-launcher-status-line" data-role="context-status"></div><div class="email-launcher-actions">' + button('Refresh Context', 'discover-context') + button('Search Artifacts', 'search', 'primary') + '</div><details class="email-launcher-details"><summary>Support details</summary><pre class="email-launcher-result email-launcher-support-pre" data-role="support-context"></pre></details></section>' +
      '<section class="email-launcher-panel"><h3>Campaign Library</h3><div class="email-launcher-field">' + labelWithTip('Drafted campaign', 'Campaign drafts are database records created when Prepare succeeds.') + '<select data-role="prepared-campaign-select"></select></div><div class="email-launcher-actions">' + button('Open Draft', 'open-prepared-campaign', 'primary') + button('Refresh Drafts', 'list-campaigns') + '</div><div class="email-launcher-status-line" data-role="artifact-status"></div><p class="email-launcher-path" data-role="artifact-summary"></p></section>' +
      '<section class="email-launcher-panel email-launcher-wide"><h3>Campaign Details</h3><div class="email-launcher-field">' + labelWithTip('Name', 'Human-readable campaign label used for prepared campaign snapshots.') + '<input data-field="name"></div><div class="email-launcher-row"><div class="email-launcher-field">' + labelWithTip('Template key', 'Stable key for deduplicating and tracking the template used by this campaign.') + '<input data-field="templateKey"></div><div class="email-launcher-field">' + labelWithTip('Template name', 'Display name for the template in campaign metadata.') + '<input data-field="templateName"></div></div><div class="email-launcher-field">' + labelWithTip('Subject template', 'Subject line with explicit {{variables}} resolved from filtered audience rows.') + '<input data-field="subjectTemplate"></div><div class="email-launcher-field">' + labelWithTip('Text template', 'Plain text fallback. Leave empty only when the platform can derive it from an HTML artifact.') + '<textarea data-field="textTemplate"></textarea></div><div class="email-launcher-actions">' + button('Auto-fill Details', 'autofill-details') + button('Next: Choose Audience', 'next-audience', 'primary') + '</div></section>' +
      '</div>' +
      '<div data-wizard-step="audience" class="email-launcher-grid">' +
      '<section class="email-launcher-panel email-launcher-wide"><h3>Choose Audience</h3><div class="email-launcher-row"><div class="email-launcher-field">' + labelWithTip('HTML template', 'Load a durable HTML template artifact.') + '<select data-role="template-select"></select></div><div class="email-launcher-field">' + labelWithTip('Audience JSON or CSV', 'Load a durable JSON audience artifact or uploaded CSV audience file.') + '<select data-role="audience-select"></select></div></div><div class="email-launcher-actions">' + button('Load Template', 'load-template') + button('Load Audience', 'load-audience', 'primary') + button('Next: Filter People', 'next-filter') + '</div><div class="email-launcher-preview" data-role="audience-preview"></div><div class="email-launcher-actions" style="margin-top:12px">' + button('Save Filtered Audience', 'open-save-dialog') + '</div><div class="email-launcher-file-manager" data-role="save-dialog" hidden></div></section>' +
      '</div>' +
      '<div data-wizard-step="filter" class="email-launcher-grid">' +
      '<section class="email-launcher-panel email-launcher-wide"><h3>Filter People</h3><div class="email-launcher-row"><div class="email-launcher-field">' + labelWithTip('Combine predicates', 'All requires every predicate to pass. Any keeps rows that pass at least one predicate.') + '<select data-role="combine"><option value="all">All predicates</option><option value="any">Any predicate</option></select></div><div class="email-launcher-field">' + labelWithTip('Fields', 'Fields are discovered from CSV headers or stable JSON scalar paths after loading an audience.') + '<select data-role="field-browser"></select></div></div><div data-role="predicates"></div><div class="email-launcher-actions">' + button('Add Predicate', 'add-predicate') + button('Apply Filter', 'apply-filter', 'primary') + button('Next: Review Message', 'next-review-message') + '</div></section>' +
      '<section class="email-launcher-panel email-launcher-wide"><h3>Counts</h3><div class="email-launcher-counts"><div class="email-launcher-count"><span>Source</span><strong data-count="source">0</strong></div><div class="email-launcher-count"><span>Filtered</span><strong data-count="filtered">0</strong></div><div class="email-launcher-count"><span>Excluded</span><strong data-count="excluded">0</strong></div><div class="email-launcher-count"><span>Invalid</span><strong data-count="invalid">0</strong></div></div></section>' +
      '</div>' +
      '<div data-wizard-step="review-message test approve status" class="email-launcher-grid">' +
      '<section class="email-launcher-panel email-launcher-wide"><h3>Campaign Workflow</h3><div class="email-launcher-workflow-actions">' + button('Prepare', 'prepare', 'step primary') + button('Preview', 'preview', 'step') + button('Send Test', 'activate-test', 'step') + button('Review Summary', 'review', 'step') + button('Schedule Send', 'activate-apply', 'step warn') + button('Status', 'status', 'step') + '</div><div class="email-launcher-workflow-body" data-role="workflow-body"></div><details class="email-launcher-details"><summary>Support details</summary><pre class="email-launcher-result" data-role="result"></pre></details></section>' +
      '</div>' +
      '</div></div>';

    var fields = {};
    Array.prototype.slice.call(container.querySelectorAll('[data-field]')).forEach(function(input) {
      var key = input.getAttribute('data-field');
      fields[key] = input;
      input.setAttribute('autocapitalize', 'none');
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('spellcheck', 'false');
      input.value = state[key] || '';
      input.addEventListener('input', function() {
        state[key] = input.value;
        if (key === 'saveFolder') state.saveFolderTouched = true;
        if (key === 'saveFileName') state.saveFileNameTouched = true;
      });
    });

    var statusTitle = container.querySelector('[data-role="status-title"]');
    var statusDetail = container.querySelector('[data-role="status-detail"]');
    var errorEl = container.querySelector('[data-role="error"]');
    var resultEl = container.querySelector('[data-role="result"]');
    var supportContextEl = container.querySelector('[data-role="support-context"]');
    var templateSelect = container.querySelector('[data-role="template-select"]');
    var audienceSelect = container.querySelector('[data-role="audience-select"]');
    var preparedCampaignSelect = container.querySelector('[data-role="prepared-campaign-select"]');
    var artifactSummary = container.querySelector('[data-role="artifact-summary"]');
    var artifactStatusEl = container.querySelector('[data-role="artifact-status"]');
    var contextStatusEl = container.querySelector('[data-role="context-status"]');
    var organizationSelect = container.querySelector('[data-select="organizationId"]');
    var workspaceSelect = container.querySelector('[data-select="workspaceId"]');
    var combineEl = container.querySelector('[data-role="combine"]');
    var fieldBrowser = container.querySelector('[data-role="field-browser"]');
    var predicatesEl = container.querySelector('[data-role="predicates"]');
    var audiencePreviewEl = container.querySelector('[data-role="audience-preview"]');
    var saveDialogEl = container.querySelector('[data-role="save-dialog"]');
    var workflowBodyEl = container.querySelector('[data-role="workflow-body"]');

    combineEl.value = state.filterSpec.combine;
    combineEl.addEventListener('change', function() {
      state.filterSpec.combine = combineEl.value === 'any' ? 'any' : 'all';
      recomputeFilter();
    });

    container.addEventListener('click', function(event) {
      var actionEl = event.target.closest('[data-action]');
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-action');
      runAction(action, actionEl);
    });

    if (organizationSelect) {
      organizationSelect.addEventListener('change', function() {
        state.organizationId = organizationSelect.value;
        state.workspaceId = '';
        state.artifacts = [];
        state.preparedCampaigns = [];
        clearPreparedWorkflow();
        state.artifactStatus = 'Select a workspace to load template and audience artifacts.';
        syncFields();
        runAction('load-workspaces');
      });
    }

    if (workspaceSelect) {
      workspaceSelect.addEventListener('change', function() {
        state.workspaceId = workspaceSelect.value;
        state.artifacts = [];
        state.preparedCampaigns = [];
        clearPreparedWorkflow();
        state.artifactStatus = state.workspaceId
          ? 'Workspace selected. Loading Campaign Library and artifacts.'
          : 'Select a workspace to load template and audience artifacts.';
        syncFields();
        renderContextControls();
        renderArtifactOptions();
        if (state.workspaceId) runAction('load-workspace-resources');
      });
    }

    function setBusy(busy, detail) {
      state.busy = busy;
      Array.prototype.slice.call(container.querySelectorAll('button, [data-select]')).forEach(function(control) {
        control.disabled = busy;
      });
      if (detail) setStatus(detail);
      renderContextControls();
      updateArtifactActionAvailability();
    }

    function setStatus(message, detail) {
      state.status = message || 'Ready';
      statusTitle.textContent = state.status;
      statusDetail.textContent = detail || '';
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

    function normalizeIdentifier(value) {
      return String(value || '').trim().toLowerCase();
    }

    function syncStateFromFields() {
      Object.keys(fields).forEach(function(key) {
        state[key] = fields[key].value;
      });
      ['threadId', 'workspaceId', 'projectId', 'organizationId'].forEach(function(key) {
        state[key] = normalizeIdentifier(state[key]);
        if (fields[key]) fields[key].value = state[key];
      });
    }

    function client() {
      return window.__tribexAiClient || null;
    }

    function wizardStepForActiveWorkflow() {
      if (state.activeStep === 'test') return 'test';
      if (state.activeStep === 'review' || state.activeStep === 'apply') return 'approve';
      if (state.activeStep === 'status') return 'status';
      return 'review-message';
    }

    function setWizardStep(step) {
      if (!step) return;
      state.wizardStep = step;
      if (step === 'review-message' && !['prepare', 'preview'].includes(state.activeStep)) {
        state.activeStep = state.previewResult ? 'preview' : 'prepare';
      }
      if (step === 'test') state.activeStep = 'test';
      if (step === 'approve' && !['review', 'apply'].includes(state.activeStep)) {
        state.activeStep = state.reviewResult ? 'apply' : 'review';
      }
      if (step === 'status') state.activeStep = 'status';
      refreshWizard();
      renderWorkflow();
    }

    function refreshWizard() {
      Array.prototype.slice.call(container.querySelectorAll('[data-wizard-step]')).forEach(function(panel) {
        var steps = String(panel.getAttribute('data-wizard-step') || '').split(/\s+/);
        panel.hidden = steps.indexOf(state.wizardStep) < 0;
      });
      Array.prototype.slice.call(container.querySelectorAll('.email-launcher-wizard-step')).forEach(function(buttonEl) {
        buttonEl.classList.toggle('active', buttonEl.getAttribute('data-step') === state.wizardStep);
      });
    }

    function readableArtifactName(ref, fallback) {
      var path = normalizeWorkspacePath(ref && (ref.workspacePath || ref.relativePath) || '');
      if (!path) return fallback;
      return humanizeSlug(path.split('/').pop());
    }

    function supportContextPayload() {
      return {
        threadId: state.threadId || null,
        workspaceId: state.workspaceId || null,
        projectId: state.projectId || null,
        organizationId: state.organizationId || null,
        campaignId: state.campaignId || null,
        reviewSessionId: state.reviewSessionId || null,
        htmlArtifactRef: state.htmlArtifactRef || null,
        sourceAudienceRef: state.sourceAudienceRef || null,
        filteredAudienceRef: state.filteredAudienceRef || null,
      };
    }

    function folderFromPath(path) {
      var normalized = normalizeWorkspacePath(path);
      var index = normalized.lastIndexOf('/');
      return index >= 0 ? normalized.slice(0, index) : '';
    }

    function availableSaveFolders() {
      var seen = {};
      var folders = [];
      function add(folder) {
        var normalized = normalizeWorkspacePath(folder || 'email/audiences/filtered').replace(/\/+$/, '');
        if (!normalized || seen[normalized]) return;
        seen[normalized] = true;
        folders.push(normalized);
      }
      add(state.selectedSaveFolder || state.saveFolder);
      add('email/audiences/filtered');
      state.artifacts.forEach(function(file) {
        var folder = folderFromPath(filePath(file));
        if (folder) add(folder);
      });
      folders.sort(function(left, right) {
        if (left === 'email/audiences/filtered') return -1;
        if (right === 'email/audiences/filtered') return 1;
        return left.localeCompare(right);
      });
      return folders;
    }

    function breadcrumbHtml(folder) {
      var parts = normalizeWorkspacePath(folder).split('/').filter(Boolean);
      if (!parts.length) return '<span>Workspace root</span>';
      return parts.map(function(part) {
        return '<span>' + esc(humanizeSlug(part)) + '</span>';
      }).join('');
    }

    function renderSaveDialog() {
      if (!saveDialogEl) return;
      saveDialogEl.hidden = !state.saveDialogOpen;
      if (!state.saveDialogOpen) {
        saveDialogEl.innerHTML = '';
        return;
      }
      var folders = availableSaveFolders();
      if (!state.selectedSaveFolder || folders.indexOf(state.selectedSaveFolder) < 0) {
        state.selectedSaveFolder = folders[0] || 'email/audiences/filtered';
      }
      if (!state.saveFileName) updateSuggestedSaveFileName(state.filterResult);
      saveDialogEl.innerHTML = [
        '<div>',
        '<p class="email-launcher-small">Choose where this filtered audience should be saved. Prepare keeps rows temporary unless you save them here.</p>',
        '<div class="email-launcher-breadcrumb" style="margin-top:8px">' + breadcrumbHtml(state.selectedSaveFolder) + '</div>',
        '</div>',
        '<div class="email-launcher-folder-list">',
        folders.map(function(folder) {
          return '<button type="button" class="email-launcher-folder-option' + (folder === state.selectedSaveFolder ? ' active' : '') + '" data-folder="' + esc(folder) + '">' + esc(folder.split('/').map(humanizeSlug).join(' / ')) + '</button>';
        }).join(''),
        '</div>',
        '<div class="email-launcher-row"><div class="email-launcher-field">',
        labelWithTip('File name', 'Rename the saved filtered audience. The platform will add .json if needed.'),
        '<input data-role="save-file-name" value="' + esc(state.saveFileName || '') + '"></div><div class="email-launcher-field">',
        labelWithTip('New folder', 'Create a folder inside the selected destination by name.'),
        '<input data-role="new-folder-name" value="' + esc(state.newFolderName || '') + '" placeholder="testing"></div></div>',
        '<div class="email-launcher-actions">',
        button('Create Folder', 'create-folder'),
        button('Save Here', 'save-filtered', 'primary'),
        button('Cancel', 'close-save-dialog'),
        '</div>',
      ].join('');
      Array.prototype.slice.call(saveDialogEl.querySelectorAll('[data-folder]')).forEach(function(buttonEl) {
        buttonEl.addEventListener('click', function() {
          state.selectedSaveFolder = buttonEl.getAttribute('data-folder') || state.selectedSaveFolder;
          state.saveFolder = state.selectedSaveFolder;
          state.saveFolderTouched = true;
          renderSaveDialog();
        });
      });
      var fileNameInput = saveDialogEl.querySelector('[data-role="save-file-name"]');
      if (fileNameInput) {
        fileNameInput.addEventListener('input', function() {
          state.saveFileName = fileNameInput.value;
          state.saveFileNameTouched = true;
        });
      }
      var folderNameInput = saveDialogEl.querySelector('[data-role="new-folder-name"]');
      if (folderNameInput) {
        folderNameInput.addEventListener('input', function() {
          state.newFolderName = folderNameInput.value;
        });
      }
    }

    function renderContextControls() {
      if (contextStatusEl) contextStatusEl.textContent = state.contextStatus || '';
      if (artifactStatusEl) artifactStatusEl.textContent = state.artifactStatus || '';

      if (organizationSelect) {
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
      }

      if (workspaceSelect) {
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
      }
    }

    function syncFields() {
      Object.keys(fields).forEach(function(key) {
        if (fields[key].value !== String(state[key] || '')) fields[key].value = state[key] || '';
      });
      artifactSummary.innerHTML = [
        'Campaign draft: ' + esc(state.campaignId ? 'Saved in database' : 'Not prepared yet'),
        'Template: ' + esc(readableArtifactName(state.htmlArtifactRef, 'Not selected')),
        'Audience: ' + esc(readableArtifactName(state.sourceAudienceRef, 'Not selected')),
        'Filtered audience: ' + esc(state.filteredAudienceRef ? 'Saved copy selected' : 'Temporary until saved'),
      ].join('<br>');
      if (supportContextEl) supportContextEl.textContent = JSON.stringify(supportContextPayload(), null, 2);
      renderContextControls();
      renderSaveDialog();
      refreshWizard();
      renderWorkflow();
    }

    function artifactMatchesRef(file, ref) {
      if (!file || !ref) return false;
      var refFileId = firstString([ref.workspaceFileId, ref.fileId], '');
      var fileId = firstString([file.id, file.workspaceFileId], '');
      var refPath = normalizeWorkspacePath(firstString([ref.workspacePath, ref.relativePath], ''));
      var path = filePath(file);
      return (refFileId && fileId && refFileId === fileId) || (refPath && path && refPath === path);
    }

    function selectMatchingArtifact(select, ref) {
      if (!select || !ref) return;
      var match = state.artifacts.find(function(file) {
        return artifactMatchesRef(file, ref);
      });
      if (match) select.value = artifactKey(match);
    }

    function renderArtifactOptions() {
      var htmlOptions = state.artifacts.filter(function(file) {
        var kind = artifactKind(file);
        return kind === 'html';
      });
      var audienceOptions = state.artifacts.filter(function(file) {
        var kind = artifactKind(file);
        return kind === 'audience' || kind === 'json';
      });
      if (!audienceOptions.length && state.artifacts.length) {
        audienceOptions = state.artifacts.filter(function(file) { return artifactKind(file) !== 'campaign'; });
      }
      if (preparedCampaignSelect) {
        preparedCampaignSelect.innerHTML = '<option value="">Select drafted campaign...</option>' + state.preparedCampaigns.map(function(campaign) {
          return '<option value="' + esc(campaign.id) + '">' + esc(campaignLabel(campaign)) + '</option>';
        }).join('');
        if (state.campaignId) preparedCampaignSelect.value = state.campaignId;
      }
      templateSelect.innerHTML = '<option value="">Select template...</option>' + htmlOptions.map(function(file) {
        return '<option value="' + esc(artifactKey(file)) + '">' + esc(artifactLabel(file)) + '</option>';
      }).join('');
      audienceSelect.innerHTML = '<option value="">Select audience...</option>' + audienceOptions.map(function(file) {
        return '<option value="' + esc(artifactKey(file)) + '">' + esc(artifactLabel(file)) + '</option>';
      }).join('');
      selectMatchingArtifact(templateSelect, state.htmlArtifactRef);
      selectMatchingArtifact(audienceSelect, state.sourceAudienceRef);
      updateArtifactActionAvailability();
      state.artifactStatus = state.artifacts.length
        ? 'Found ' + state.artifacts.length + ' artifact' + (state.artifacts.length === 1 ? '' : 's') + ' in this workspace.'
        : state.artifactStatus;
      renderContextControls();
    }

    function setActionDisabled(action, disabled) {
      var el = container.querySelector('[data-action="' + action + '"]');
      if (el) el.disabled = !!disabled;
    }

    function updateArtifactActionAvailability() {
      var templateCount = state.artifacts.filter(function(file) {
        return artifactKind(file) === 'html';
      }).length;
      var audienceCount = state.artifacts.filter(function(file) {
        var kind = artifactKind(file);
        return kind === 'audience' || kind === 'json';
      }).length;
      setActionDisabled('open-prepared-campaign', state.busy || !state.preparedCampaigns.length);
      setActionDisabled('load-template', state.busy || !templateCount);
      setActionDisabled('load-audience', state.busy || !audienceCount);
    }

    function renderFieldOptions() {
      fieldBrowser.innerHTML = state.fieldPaths.length
        ? state.fieldPaths.map(function(path) { return '<option value="' + esc(path) + '">' + esc(path) + '</option>'; }).join('')
        : '<option value="">Load an audience first</option>';
    }

    function renderPredicates() {
      predicatesEl.innerHTML = state.filterSpec.predicates.length
        ? state.filterSpec.predicates.map(function(predicate, index) {
          var fieldOptions = state.fieldPaths.length
            ? state.fieldPaths.map(function(path) {
              return '<option value="' + esc(path) + '"' + (path === predicate.fieldPath ? ' selected' : '') + '>' + esc(path) + '</option>';
            }).join('')
            : '<option value="' + esc(predicate.fieldPath || '') + '">' + esc(predicate.fieldPath || 'field') + '</option>';
          return '<div class="email-launcher-filter-row" data-predicate-index="' + index + '">' +
            '<select data-predicate-field="mode"><option value="include"' + (predicate.mode !== 'exclude' ? ' selected' : '') + '>Include</option><option value="exclude"' + (predicate.mode === 'exclude' ? ' selected' : '') + '>Exclude</option></select>' +
            '<select data-predicate-field="fieldPath">' + fieldOptions + '</select>' +
            '<select data-predicate-field="operator">' + OPERATORS.map(function(operator) { return '<option value="' + esc(operator) + '"' + (operator === predicate.operator ? ' selected' : '') + '>' + esc(operator) + '</option>'; }).join('') + '</select>' +
            '<input data-predicate-field="value" value="' + esc(Array.isArray(predicate.value) ? predicate.value.join(', ') : predicate.value || '') + '">' +
            '<button type="button" class="email-launcher-btn" data-action="remove-predicate" data-index="' + index + '">x</button>' +
            '</div>';
        }).join('')
        : '<p class="email-launcher-small">No predicates. All valid audience rows will be included.</p>';
      Array.prototype.slice.call(predicatesEl.querySelectorAll('[data-predicate-field]')).forEach(function(input) {
        input.addEventListener('input', syncPredicatesFromDom);
        input.addEventListener('change', syncPredicatesFromDom);
      });
    }

    function syncPredicatesFromDom() {
      state.filterSpec.predicates = Array.prototype.slice.call(predicatesEl.querySelectorAll('[data-predicate-index]')).map(function(row) {
        var predicate = {};
        Array.prototype.slice.call(row.querySelectorAll('[data-predicate-field]')).forEach(function(input) {
          predicate[input.getAttribute('data-predicate-field')] = input.value;
        });
        return predicate;
      });
      state.filterSpec = normalizeFilterSpec(state.filterSpec);
      recomputeFilter();
    }

    function renderCounts() {
      var counts = state.filterResult && state.filterResult.counts || {
        source: state.audienceRows.length,
        filtered: 0,
        excluded: 0,
        invalid: 0,
      };
      ['source', 'filtered', 'excluded', 'invalid'].forEach(function(key) {
        var el = container.querySelector('[data-count="' + key + '"]');
        if (el) el.textContent = String(counts[key] || 0);
      });
      renderAudiencePreview();
    }

    function previewFieldPaths(rows) {
      var preferred = ['email', 'emailAddress', 'first_name', 'last_name', 'company', 'metadata.company', 'custom_note'];
      var available = collectAudienceFieldPaths(rows);
      var selected = [];
      preferred.forEach(function(path) {
        if (available.indexOf(path) >= 0 && selected.indexOf(path) < 0) selected.push(path);
      });
      available.forEach(function(path) {
        if (selected.length < 6 && selected.indexOf(path) < 0) selected.push(path);
      });
      return selected.slice(0, 6);
    }

    function renderAudiencePreview() {
      if (!audiencePreviewEl) return;
      if (!state.audienceRows.length) {
        audiencePreviewEl.innerHTML = '<div class="email-launcher-preview-empty">Load an audience artifact to preview source and filtered rows.</div>';
        return;
      }
      var result = state.filterResult;
      var rows = result ? result.rows : state.audienceRows;
      var counts = result && result.counts || {
        source: state.audienceRows.length,
        filtered: rows.length,
        excluded: 0,
        invalid: 0,
      };
      var fieldsToShow = previewFieldPaths(rows.length ? rows : state.audienceRows);
      if (!fieldsToShow.length) {
        audiencePreviewEl.innerHTML = '<div class="email-launcher-preview-empty">Audience rows loaded, but no scalar preview fields were discovered.</div>';
        return;
      }
      var sample = rows.slice(0, 8);
      var header = fieldsToShow.map(function(path) {
        return '<th title="' + esc(path) + '">' + esc(path) + '</th>';
      }).join('');
      var body = sample.length
        ? sample.map(function(row) {
          return '<tr>' + fieldsToShow.map(function(path) {
            return '<td title="' + esc(previewValue(readField(row, path).value)) + '">' + esc(previewValue(readField(row, path).value)) + '</td>';
          }).join('') + '</tr>';
        }).join('')
        : '<tr><td colspan="' + fieldsToShow.length + '">No rows match the current filter.</td></tr>';
      audiencePreviewEl.innerHTML = [
        '<div class="email-launcher-preview-head"><strong>Audience Preview</strong><span>',
        esc(counts.filtered) + ' of ' + esc(counts.source) + ' rows included',
        counts.excluded ? ' · ' + esc(counts.excluded) + ' excluded' : '',
        counts.invalid ? ' · ' + esc(counts.invalid) + ' invalid' : '',
        '</span></div>',
        '<div class="email-launcher-preview-scroll"><table><thead><tr>' + header + '</tr></thead><tbody>' + body + '</tbody></table></div>',
      ].join('');
    }

    function shortHash(value) {
      var text = String(value || '');
      return text.length > 16 ? text.slice(0, 12) + '...' : text;
    }

    function kvRows(rows) {
      return '<dl class="email-launcher-kv">' + rows.map(function(row) {
        return '<dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1] == null || row[1] === '' ? 'None' : row[1]) + '</dd>';
      }).join('') + '</dl>';
    }

    function resultCampaign(result) {
      return result && result.campaign || null;
    }

    function firstArtifactRef(candidates, fallbackFormat) {
      for (var i = 0; i < candidates.length; i += 1) {
        var ref = normalizeArtifactRef(candidates[i], fallbackFormat);
        if (ref) return ref;
      }
      return null;
    }

    function campaignRecipientSummary(campaign) {
      if (!campaign) return {};
      var total = Number(campaign.recipientCount || 0);
      var suppressed = Number(campaign.suppressedCount || 0);
      return {
        total: total,
        suppressed: suppressed,
        sendable: Math.max(total - suppressed, 0),
      };
    }

    function filterMetadataFromStatusResult(result) {
      var campaign = result && result.campaign || {};
      var provenance = result && result.provenance || {};
      var metadata = isRecord(campaign.metadata) ? campaign.metadata : {};
      var nested = isRecord(provenance.audienceFilter)
        ? provenance.audienceFilter
        : isRecord(metadata.audienceFilter)
          ? metadata.audienceFilter
          : metadata;
      return {
        spec: isRecord(nested.audienceFilterSpec) ? nested.audienceFilterSpec : isRecord(nested.spec) ? nested.spec : null,
        hash: firstString([nested.audienceFilterHash, nested.hash], ''),
        counts: isRecord(nested.audienceFilterCounts) ? nested.audienceFilterCounts : isRecord(nested.counts) ? nested.counts : null,
      };
    }

    function hydrateFilterResultFromStatus(result) {
      var filter = filterMetadataFromStatusResult(result);
      if (!filter.spec && !filter.hash && !filter.counts) return;
      state.filterSpec = normalizeFilterSpec(filter.spec || state.filterSpec);
      var fieldPaths = {};
      state.filterSpec.predicates.forEach(function(predicate) {
        if (predicate.fieldPath) fieldPaths[predicate.fieldPath] = true;
      });
      state.fieldPaths = Object.keys(fieldPaths).sort();
      state.filterResult = {
        rows: state.audienceRows,
        filterSpec: state.filterSpec,
        filterHash: filter.hash,
        counts: Object.assign({
          source: state.audienceRows.length,
          filtered: state.audienceRows.length,
          excluded: 0,
          invalid: 0,
        }, filter.counts || {}),
        fieldPaths: state.fieldPaths,
      };
    }

    function wizardStepForPreparedCampaign(campaign) {
      var status = String(campaign && campaign.status || '').toUpperCase();
      if (status === 'PENDING_APPROVAL' || status === 'APPROVED') return 'approve';
      if (status === 'SENDING' || status === 'SENT' || status === 'PARTIALLY_FAILED' || status === 'FAILED' || status === 'CANCELED') return 'status';
      return 'review-message';
    }

    function activeStepForPreparedCampaign(campaign) {
      var status = String(campaign && campaign.status || '').toUpperCase();
      if (status === 'PENDING_APPROVAL') return 'review';
      if (status === 'APPROVED') return 'apply';
      if (status === 'SENDING' || status === 'SENT' || status === 'PARTIALLY_FAILED' || status === 'FAILED' || status === 'CANCELED') return 'status';
      return 'prepare';
    }

    function hydratePreparedCampaignStatus(result, fallbackCampaignId) {
      var campaign = result && result.campaign || {};
      var templateVersion = result && result.templateVersion || {};
      var provenance = result && result.provenance || {};
      var metadata = isRecord(campaign.metadata) ? campaign.metadata : {};
      var artifactRefs = isRecord(metadata.artifactRefs) ? metadata.artifactRefs : {};
      var templateArtifactRefs = isRecord(provenance.templateArtifactRefs) ? provenance.templateArtifactRefs : {};
      state.campaignId = firstString([campaign.id, fallbackCampaignId], state.campaignId);
      state.reviewSessionId = firstString([campaign.reviewSessionId], state.reviewSessionId);
      state.name = firstString([campaign.name], state.name);
      state.templateName = firstString([campaign.name, state.templateName], state.name);
      state.subjectTemplate = firstString([templateVersion.subjectTemplate, campaign.subject], state.subjectTemplate);
      state.textTemplate = firstString([templateVersion.textTemplate], state.textTemplate);
      state.htmlArtifactRef = firstArtifactRef([
        templateVersion.artifactRefs && templateVersion.artifactRefs.htmlTemplate,
        templateVersion.metadata && templateVersion.metadata.htmlTemplateArtifactRef,
        templateArtifactRefs.htmlTemplate,
        artifactRefs.htmlTemplate,
        metadata.htmlTemplateArtifactRef,
      ], 'html') || state.htmlArtifactRef;
      var preparedAudienceRef = firstArtifactRef([
        campaign.audienceArtifactRef,
        provenance.audienceArtifactRef,
        artifactRefs.audience,
      ], 'json');
      state.sourceAudienceRef = firstArtifactRef([
        metadata.sourceAudienceArtifactRef,
        artifactRefs.sourceAudience,
        preparedAudienceRef,
      ], 'json') || state.sourceAudienceRef;
      state.filteredAudienceRef = firstArtifactRef([
        metadata.filteredAudienceArtifactRef,
        preparedAudienceRef,
      ], 'json') || state.filteredAudienceRef;
      hydrateFilterResultFromStatus(result);
      state.preparedResult = {
        campaign: campaign,
        recipients: campaignRecipientSummary(campaign),
      };
      state.statusResult = result;
      if (campaign.reviewSessionId && !state.reviewResult && String(campaign.status || '').toUpperCase() === 'PENDING_APPROVAL') {
        state.reviewResult = {
          reviewRequired: true,
          reviewSessionId: campaign.reviewSessionId,
          campaign: campaign,
        };
      }
      state.activeStep = activeStepForPreparedCampaign(campaign);
      state.wizardStep = wizardStepForPreparedCampaign(campaign);
    }

    function filteredRowsForWorkflow() {
      return state.filterResult && state.filterResult.rows && state.filterResult.rows.length
        ? state.filterResult.rows
        : state.audienceRows;
    }

    function previewOptionsHtml() {
      var previews = state.previewResult && state.previewResult.previews || [];
      var rows = filteredRowsForWorkflow();
      if (!previews.length) return '<option value="">Preview the campaign first</option>';
      return previews.map(function(preview, index) {
        var email = emailFromAudienceRow(rows[index]) || preview.emailHash || preview.recipientId;
        return '<option value="' + esc(String(index)) + '"' + (String(index) === String(state.testRecipientIndex) ? ' selected' : '') + '>' + esc(email) + '</option>';
      }).join('');
    }

    function selectedPreview() {
      var previews = state.previewResult && state.previewResult.previews || [];
      var index = Math.max(0, Number(state.testRecipientIndex) || 0);
      return previews[index] || previews[0] || null;
    }

    function selectedPreviewEmail() {
      var rows = filteredRowsForWorkflow();
      var index = Math.max(0, Number(state.testRecipientIndex) || 0);
      return emailFromAudienceRow(rows[index]) || state.testTo || '';
    }

    function filterSummaryText(campaign) {
      var counts = state.filterResult && state.filterResult.counts ||
        campaign && campaign.metadata && campaign.metadata.audienceFilterCounts ||
        null;
      if (!counts) return '';
      return [
        String(counts.filtered || 0) + ' included',
        String(counts.excluded || 0) + ' excluded',
        String(counts.invalid || 0) + ' invalid',
      ].join(', ');
    }

    function renderPreparePane() {
      var campaign = resultCampaign(state.preparedResult) || (state.statusResult && state.statusResult.campaign) || null;
      if (!campaign) {
        return '<p class="email-launcher-small">Prepare creates a deterministic campaign snapshot in the platform database. It uses temporary filtered rows unless you explicitly saved a filtered audience artifact above.</p>';
      }
      var recipients = state.preparedResult && state.preparedResult.recipients || {};
      return [
        '<div class="email-launcher-chip-row">',
        '<span class="email-launcher-chip">Database saved</span>',
        state.filteredAudienceRef ? '<span class="email-launcher-chip">Durable audience artifact</span>' : '<span class="email-launcher-chip">Temporary filtered audience</span>',
        '</div>',
        kvRows([
          ['Status', campaign.status],
          ['Name', campaign.name],
          ['Subject', campaign.subject],
          ['Recipients', recipients.total ?? campaign.recipientCount],
          ['Suppressed', recipients.suppressed ?? campaign.suppressedCount],
          ['Sendable', recipients.sendable ?? Math.max((campaign.recipientCount || 0) - (campaign.suppressedCount || 0), 0)],
          ['Audience source', state.filteredAudienceRef ? 'Saved filtered audience' : 'Temporary filtered rows'],
          ['Filter', filterSummaryText(campaign) || 'No filter summary available'],
        ]),
      ].join('');
    }

    function renderPreviewPane() {
      var preview = selectedPreview();
      if (!preview) {
        return '<p class="email-launcher-small">Click Preview after Prepare to inspect rendered subject, text, and HTML for the filtered audience.</p>';
      }
      var html = preview.htmlBody || '<pre>' + esc(preview.textBody || '') + '</pre>';
      return [
        '<div class="email-launcher-email-preview">',
        kvRows([
          ['Recipient', selectedPreviewEmail() || preview.emailHash],
          ['Status', preview.status],
          ['Subject', preview.subject],
        ]),
        '<iframe class="email-launcher-email-frame" sandbox srcdoc="' + esc(html) + '"></iframe>',
        '<details class="email-launcher-details"><summary>Text fallback</summary><pre class="email-launcher-result">' + esc(preview.textBody || '') + '</pre></details>',
        '</div>',
      ].join('');
    }

    function renderTestPane() {
      var preview = selectedPreview();
      return [
        '<div class="email-launcher-row"><div class="email-launcher-field">',
        labelWithTip('Audience recipient', 'Pick the filtered audience row whose rendered content should be used for the test email.'),
        '<select data-role="test-recipient-select">' + previewOptionsHtml() + '</select></div><div class="email-launcher-field">',
        labelWithTip('Send test to', 'The test email address. Defaults to the selected audience row email so you can verify personalization.'),
        '<input data-role="test-to-input" value="' + esc(state.testTo || selectedPreviewEmail()) + '"></div></div>',
        preview ? kvRows([
          ['Rendered subject', preview.subject],
          ['Selected recipient', selectedPreviewEmail() || 'Audience row selected'],
        ]) : '<p class="email-launcher-small">Preview first so the test send can use a concrete prepared recipient.</p>',
        '<div class="email-launcher-actions" style="margin-top:12px">' + button('Send Test Email', 'test-send', 'primary') + '</div>',
        state.testResult ? '<div style="margin-top:12px">' + kvRows([
          ['Sent', state.testResult.sent ? 'Yes' : 'No'],
          ['Recipient', state.testTo || selectedPreviewEmail()],
          ['Provider accepted', state.testResult.providerMessageId ? 'Yes' : 'Pending'],
        ]) + '</div>' : '',
      ].join('');
    }

    function reviewSummaryRows(reviewResult) {
      var table = reviewResult && reviewResult.review && reviewResult.review.tables && reviewResult.review.tables[0];
      var row = table && table.rows && table.rows[0];
      var cells = row && row.cells || {};
      return Object.keys(cells).map(function(key) {
        return [key, cells[key] && cells[key].value];
      });
    }

    function renderReviewPane() {
      if (!state.reviewResult) {
        return '<p class="email-launcher-small">Review Summary prepares the production-send summary inside this campaign flow. Scheduling the send is the approval action.</p>';
      }
      var campaign = resultCampaign(state.reviewResult) || state.statusResult && state.statusResult.campaign || {};
      return [
        kvRows([
          ['Review Required', state.reviewResult.reviewRequired ? 'Yes' : 'No'],
          ['Campaign Status', campaign.status],
          ['Review Session', state.reviewSessionId || state.reviewResult.reviewSessionId],
          ['Approval', 'Scheduling from this plugin UI approves the send'],
        ]),
        '<div style="margin-top:12px">',
        kvRows(reviewSummaryRows(state.reviewResult)),
        '</div>',
      ].join('');
    }

    function renderApplyPane() {
      return [
        '<div class="email-launcher-row"><div class="email-launcher-field">',
        labelWithTip('Send date/time', 'Local scheduled send time. The platform converts this using the timezone below.'),
        '<input type="datetime-local" data-role="scheduled-local" value="' + esc(state.scheduledLocal) + '"></div><div class="email-launcher-field">',
        labelWithTip('Timezone', 'Timezone used to convert the selected date/time to UTC.'),
        '<select data-role="scheduled-timezone"><option value="' + esc(browserTimeZone()) + '"' + ((state.scheduledTimeZone || browserTimeZone()) === browserTimeZone() ? ' selected' : '') + '>My timezone (' + esc(browserTimeZone()) + ')</option><option value="UTC"' + ((state.scheduledTimeZone || browserTimeZone()) === 'UTC' ? ' selected' : '') + '>UTC</option></select></div></div>',
        '<p class="email-launcher-small">Scheduling from this plugin UI approves the campaign and queues it for the selected time.</p>',
        '<div class="email-launcher-actions">' + button('Schedule Apply/Send', 'apply', 'warn') + '</div>',
        state.applyResult ? '<div style="margin-top:12px">' + kvRows([
          ['Queued', state.applyResult.queued ? 'Yes' : 'No'],
          ['Scheduled At', state.applyResult.scheduledAt],
          ['Queued Count', state.applyResult.queuedCount],
          ['Suppressed During Apply', state.applyResult.suppressedDuringApply],
        ]) + '</div>' : '<p class="email-launcher-small">Production sends require plugin UI approval. This step records approval and queues the campaign for the selected time.</p>',
      ].join('');
    }

    function renderStatusPane() {
      var campaign = state.statusResult && state.statusResult.campaign || null;
      var refreshAction = '<div class="email-launcher-actions" style="margin-bottom:12px">' + button('Refresh Status', 'refresh-status', 'primary') + '</div>';
      if (!campaign) {
        return refreshAction + '<p class="email-launcher-small">Click Refresh Status after preparing or applying the campaign to view progress.</p>';
      }
      return refreshAction + kvRows([
        ['Status', campaign.status],
        ['Recipients', campaign.recipientCount],
        ['Suppressed', campaign.suppressedCount],
        ['Queued', campaign.queuedCount],
        ['Sent', campaign.sentCount],
        ['Failed', campaign.failedCount],
        ['Approved At', campaign.approvedAt],
        ['Send Started At', campaign.sendStartedAt],
        ['Completed At', campaign.completedAt],
      ]);
    }

    function bindWorkflowControls() {
      var recipientSelect = workflowBodyEl && workflowBodyEl.querySelector('[data-role="test-recipient-select"]');
      if (recipientSelect) {
        recipientSelect.addEventListener('change', function() {
          state.testRecipientIndex = recipientSelect.value || '0';
          var preview = selectedPreview();
          state.testRecipientId = preview && preview.recipientId || '';
          state.testTo = selectedPreviewEmail();
          renderWorkflow();
        });
      }
      var testToInput = workflowBodyEl && workflowBodyEl.querySelector('[data-role="test-to-input"]');
      if (testToInput) {
        testToInput.addEventListener('input', function() {
          state.testTo = testToInput.value;
        });
      }
      var scheduledLocal = workflowBodyEl && workflowBodyEl.querySelector('[data-role="scheduled-local"]');
      if (scheduledLocal) {
        scheduledLocal.addEventListener('input', function() {
          state.scheduledLocal = scheduledLocal.value;
        });
      }
      var scheduledTimeZone = workflowBodyEl && workflowBodyEl.querySelector('[data-role="scheduled-timezone"]');
      if (scheduledTimeZone) {
        scheduledTimeZone.addEventListener('change', function() {
          state.scheduledTimeZone = scheduledTimeZone.value;
        });
      }
    }

    function renderWorkflow() {
      if (!workflowBodyEl) return;
      Array.prototype.slice.call(container.querySelectorAll('.email-launcher-btn.step')).forEach(function(buttonEl) {
        var action = buttonEl.getAttribute('data-action');
        var step = action === 'activate-test' ? 'test' : action === 'activate-apply' ? 'apply' : action === 'review' ? 'review' : action;
        buttonEl.classList.toggle('active', step === state.activeStep);
      });
      if (state.activeStep === 'preview') workflowBodyEl.innerHTML = renderPreviewPane();
      else if (state.activeStep === 'test') workflowBodyEl.innerHTML = renderTestPane();
      else if (state.activeStep === 'review') workflowBodyEl.innerHTML = renderReviewPane();
      else if (state.activeStep === 'apply') workflowBodyEl.innerHTML = renderApplyPane();
      else if (state.activeStep === 'status') workflowBodyEl.innerHTML = renderStatusPane();
      else workflowBodyEl.innerHTML = renderPreparePane();
      bindWorkflowControls();
    }

    function selectedArtifact(select) {
      var value = select.value;
      return state.artifacts.find(function(file) {
        return artifactKey(file) === value;
      }) || null;
    }

    function applyThreadContext(thread) {
      if (!isRecord(thread)) return;
      var workspace = isRecord(thread.workspace) ? thread.workspace : {};
      var project = isRecord(thread.project) ? thread.project : {};
      state.workspaceId = normalizeIdentifier(firstString([workspace.id, thread.workspaceId, project.workspaceId], state.workspaceId));
      state.projectId = normalizeIdentifier(firstString([project.id, thread.projectId], state.projectId));
      state.organizationId = normalizeIdentifier(firstString([workspace.organizationId, thread.organizationId, project.organizationId], state.organizationId));
      state.contextStatus = state.organizationId || state.workspaceId
        ? 'Thread context resolved.'
        : state.contextStatus;
      syncFields();
    }

    function loadOrganizations() {
      var api = client();
      if (!api || typeof api.fetchOrganizations !== 'function') {
        state.contextStatus = state.organizationId
          ? 'Using provided organization context.'
          : 'Organization lookup is unavailable in this MCPViews session.';
        renderContextControls();
        return Promise.resolve();
      }
      state.contextStatus = 'Loading organizations from your permissions.';
      renderContextControls();
      return api.fetchOrganizations().then(function(orgs) {
        state.orgOptions = Array.isArray(orgs) ? orgs : [];
        if (!state.organizationId && state.orgOptions.length === 1) {
          state.organizationId = state.orgOptions[0].id;
        }
        if (state.organizationId) {
          var selected = state.orgOptions.find(function(org) { return org.id === state.organizationId; });
          state.contextStatus = selected
            ? 'Using ' + orgLabel(selected) + '.'
            : 'Using provided organization context.';
        } else {
          state.contextStatus = state.orgOptions.length
            ? 'Select an organization to load workspaces.'
            : 'No organizations found for this account.';
        }
        syncFields();
        renderContextControls();
      });
    }

    function loadWorkspacesForSelectedOrg() {
      var api = client();
      if (!state.organizationId) {
        state.workspaceOptions = [];
        state.artifacts = [];
        state.preparedCampaigns = [];
        state.contextStatus = 'Select an organization to load workspaces.';
        state.artifactStatus = 'Select a workspace to load template and audience artifacts.';
        renderArtifactOptions();
        return Promise.resolve();
      }
      if (!api || typeof api.fetchWorkspaces !== 'function') {
        state.contextStatus = state.workspaceId
          ? 'Using provided workspace context.'
          : 'Workspace lookup is unavailable in this MCPViews session.';
        renderContextControls();
        return Promise.resolve();
      }
      state.contextStatus = 'Loading workspaces.';
      renderContextControls();
      return api.fetchWorkspaces(state.organizationId).then(function(workspaces) {
        state.workspaceOptions = Array.isArray(workspaces) ? workspaces : [];
        var current = state.workspaceOptions.find(function(workspace) { return workspace.id === state.workspaceId; });
        if (!current && state.workspaceOptions.length && !state.workspaceId) {
          state.workspaceId = state.workspaceOptions[0].id;
        } else if (!current && state.workspaceId && state.workspaceOptions.length) {
          state.workspaceId = '';
        }
        if (state.workspaceId) {
          var selectedWorkspace = state.workspaceOptions.find(function(workspace) { return workspace.id === state.workspaceId; });
          state.contextStatus = selectedWorkspace
            ? 'Using ' + workspaceLabel(selectedWorkspace) + '.'
            : 'Using provided workspace.';
          state.artifactStatus = 'Workspace ready. Loading template and audience artifacts.';
        } else {
          state.contextStatus = state.workspaceOptions.length
            ? 'Select a workspace.'
            : 'No workspaces found for this organization.';
          state.artifactStatus = 'Select a workspace to load template and audience artifacts.';
        }
        syncFields();
        renderContextControls();
      });
    }

    function discoverContext() {
      var api = client();
      if (!api) {
        state.contextStatus = 'TribeX AI client is unavailable. Open from an authenticated MCPViews AI session.';
        renderContextControls();
        return Promise.resolve();
      }
      var threadPromise = state.threadId.trim() && typeof api.fetchThread === 'function'
        ? api.fetchThread(state.threadId.trim()).then(function(thread) {
            applyThreadContext(thread);
          }).catch(function() {
            state.contextStatus = 'Could not resolve thread context. Select an organization.';
          })
        : Promise.resolve();
      return threadPromise
        .then(loadOrganizations)
        .then(loadWorkspacesForSelectedOrg)
        .then(function() {
          if (state.workspaceId) {
            return loadWorkspaceScopedResources();
          }
          setStatus('Select org and workspace', state.contextStatus);
          return null;
        });
    }

    function ensureWorkspaceContext() {
      state.workspaceId = normalizeIdentifier(state.workspaceId);
      if (fields.workspaceId) fields.workspaceId.value = state.workspaceId;
      if (state.workspaceId) return Promise.resolve(state.workspaceId);
      if (!state.threadId.trim()) throw new Error('Workspace ID or thread ID is required.');
      if (!window.__tribexAiClient || typeof window.__tribexAiClient.fetchThread !== 'function') {
        throw new Error('TribeX AI client cannot resolve thread context in this MCPViews session.');
      }
      return window.__tribexAiClient.fetchThread(normalizeIdentifier(state.threadId)).then(function(thread) {
        applyThreadContext(thread);
        if (!state.workspaceId) throw new Error('Could not resolve workspace from thread.');
        return state.workspaceId;
      });
    }

    function resolveThread() {
      state.threadId = normalizeIdentifier(state.threadId);
      if (fields.threadId) fields.threadId.value = state.threadId;
      if (!state.threadId) throw new Error('Thread ID is required.');
      if (!window.__tribexAiClient || typeof window.__tribexAiClient.fetchThread !== 'function') {
        throw new Error('TribeX AI client is unavailable.');
      }
      return window.__tribexAiClient.fetchThread(state.threadId).then(function(thread) {
        applyThreadContext(thread);
        setStatus('Thread resolved', state.workspaceId);
      });
    }

    function searchArtifacts() {
      if (!window.__tribexAiClient || typeof window.__tribexAiClient.listWorkspaceFiles !== 'function') {
        throw new Error('Workspace artifact search is unavailable.');
      }
      return ensureWorkspaceContext().then(function(workspaceId) {
        state.artifactStatus = 'Searching durable workspace artifacts.';
        renderContextControls();
        var prefixes = ['email/', ''];
        return Promise.all(prefixes.map(function(prefix) {
          return window.__tribexAiClient.listWorkspaceFiles(workspaceId, prefix)
            .then(function(result) { return result && result.files || []; })
            .catch(function() { return []; });
        })).then(function(groups) {
          var seen = {};
          state.artifacts = groups.reduce(function(files, group) {
              group.forEach(function(file) {
                var key = firstString([file && file.id, file && file.workspaceFileId], filePath(file));
                if (!key || seen[key]) return;
                seen[key] = true;
                files.push(file);
              });
              return files;
            }, [])
            .filter(function(file) {
              var path = filePath(file);
              var kind = artifactKind(file);
              return path && path.indexOf('/.tribex-folder') < 0 && kind !== 'campaign' && kind !== 'other';
            })
            .sort(function(left, right) { return filePath(left).localeCompare(filePath(right)); });
          renderArtifactOptions();
          state.artifactStatus = state.artifacts.length
            ? 'Found ' + state.artifacts.length + ' template or audience artifact' + (state.artifacts.length === 1 ? '' : 's') + '.'
            : 'No template or audience artifacts found in this workspace.';
          renderContextControls();
          setStatus('Artifacts loaded', state.artifacts.length + ' file(s)');
        });
      });
    }

    function loadWorkspaceScopedResources() {
      if (!state.workspaceId) {
        setStatus('Select org and workspace', state.contextStatus);
        return Promise.resolve(null);
      }
      var api = client();
      var artifactSearch = api && typeof api.listWorkspaceFiles === 'function'
        ? searchArtifacts().catch(function(error) {
            state.artifacts = [];
            state.artifactStatus = platformErrorDetail(error) + ' Draft library will still load.';
            renderArtifactOptions();
            return null;
          })
        : Promise.resolve(null);
      return artifactSearch.then(function() {
        return listPreparedCampaigns();
      });
    }

    function fetchArtifactText(file) {
      if (!file) throw new Error('Select an artifact first.');
      if (!window.__tribexAiClient ||
        typeof window.__tribexAiClient.getWorkspaceFile !== 'function' ||
        typeof window.__tribexAiClient.fetchSignedFileBytes !== 'function') {
        throw new Error('Workspace artifact download is unavailable.');
      }
      return ensureWorkspaceContext().then(function(workspaceId) {
        var fileId = firstString([file.id, file.workspaceFileId], '');
        if (!fileId) throw new Error('Selected artifact is missing a file ID.');
        return window.__tribexAiClient.getWorkspaceFile(workspaceId, fileId).then(function(envelope) {
          var resolvedFile = Object.assign({}, file, envelope && envelope.file ? envelope.file : {});
          return window.__tribexAiClient.fetchSignedFileBytes(envelope && envelope.download).then(function(downloaded) {
            var bytes = downloaded && downloaded.bytes ? downloaded.bytes : new Uint8Array();
            return sha256Bytes(bytes, fileChecksum(resolvedFile)).then(function(hash) {
              return {
                file: resolvedFile,
                text: bytesToText(bytes),
                sha256: hash || fileChecksum(resolvedFile),
              };
            });
          });
        });
      });
    }

    function clearPreparedWorkflow() {
      state.campaignId = '';
      state.reviewSessionId = '';
      state.lastResult = null;
      state.preparedResult = null;
      state.previewResult = null;
      state.testResult = null;
      state.reviewResult = null;
      state.applyResult = null;
      state.statusResult = null;
      if (resultEl) resultEl.textContent = '';
      renderWorkflow();
    }

    function clearSavedFilteredAudience() {
      state.filteredAudienceRef = null;
      syncFields();
    }

    function updateSuggestedSaveFileName(result) {
      if (!state.saveFolderTouched && !state.saveFolder) state.saveFolder = 'email/audiences/filtered';
      if (!state.saveFileNameTouched || !state.saveFileName) {
        var hash = result && result.filterHash ? '-' + result.filterHash.slice(0, 12) : '';
        state.saveFileName = slugify(state.name || state.templateName || 'filtered-audience') + hash + '.audience.json';
      }
      if (fields.saveFolder && fields.saveFolder.value !== state.saveFolder) fields.saveFolder.value = state.saveFolder;
      if (fields.saveFileName && fields.saveFileName.value !== state.saveFileName) fields.saveFileName.value = state.saveFileName;
    }

    function inferCampaignName() {
      var candidates = [
        state.htmlArtifactRef && state.htmlArtifactRef.workspacePath,
        state.sourceAudienceRef && state.sourceAudienceRef.workspacePath,
      ];
      for (var i = 0; i < candidates.length; i += 1) {
        var path = normalizeWorkspacePath(candidates[i] || '');
        if (!path) continue;
        var name = humanizeSlug(path.split('/').pop());
        if (name) return name;
      }
      return 'Manual email campaign';
    }

    function preferredFirstNameVariable() {
      var paths = state.fieldPaths || [];
      var exact = ['first_name', 'firstName', 'firstname', 'name.first', 'contact.first_name'];
      for (var e = 0; e < exact.length; e += 1) {
        if (paths.indexOf(exact[e]) >= 0) return exact[e];
      }
      for (var i = 0; i < paths.length; i += 1) {
        if (/first[_-]?name$/i.test(paths[i]) || /\.first$/i.test(paths[i])) return paths[i];
      }
      return '';
    }

    function autoFillDetails(force) {
      var baseName = inferCampaignName();
      if (force || !state.name || state.name === 'Manual email campaign') state.name = baseName;
      if (force || !state.templateName) state.templateName = state.name;
      if (force || !state.templateKey) state.templateKey = slugify(state.templateName).replace(/-/g, '_');
      var firstName = preferredFirstNameVariable();
      if ((force || !state.subjectTemplate) && firstName) {
        state.subjectTemplate = 'Hi {{' + firstName + '}}, quick note from TribeX';
      } else if (force || !state.subjectTemplate) {
        state.subjectTemplate = 'A quick note from TribeX';
      }
      if ((force || !state.textTemplate) && firstName) {
        state.textTemplate = 'Hi {{' + firstName + '}},\n\nWe wanted to share a quick update.\n\nBest,\nTribeX';
      } else if (force || !state.textTemplate) {
        state.textTemplate = 'Hi,\n\nWe wanted to share a quick update.\n\nBest,\nTribeX';
      }
      syncFields();
      setStatus('Campaign details filled', 'Review sender identity and template text before prepare.');
    }

    function listPreparedCampaigns() {
      if (!state.workspaceId) {
        state.preparedCampaigns = [];
        state.artifactStatus = 'Select a workspace to load drafted campaigns.';
        renderArtifactOptions();
        setStatus('Select workspace', state.artifactStatus);
        return Promise.resolve({ campaigns: [] });
      }
      return callPlatform('list', { limit: 25 }).then(function(result) {
        state.preparedCampaigns = Array.isArray(result && result.campaigns) ? result.campaigns : [];
        renderArtifactOptions();
        state.artifactStatus = state.preparedCampaigns.length
          ? 'Found ' + state.preparedCampaigns.length + ' drafted campaign' + (state.preparedCampaigns.length === 1 ? '' : 's') + ' in this workspace.'
          : 'No drafted campaigns found in this workspace.';
        renderContextControls();
        setStatus('Draft library loaded', state.preparedCampaigns.length + ' drafted campaign(s)');
        return result;
      });
    }

    function openPreparedCampaign() {
      var campaignId = preparedCampaignSelect && preparedCampaignSelect.value || state.campaignId;
      if (!campaignId) throw new Error('Select a drafted campaign first.');
      state.campaignId = campaignId;
      return callPlatform('status', { campaignId: state.campaignId, includeRecipients: true }).then(function(result) {
        hydratePreparedCampaignStatus(result, campaignId);
        renderResult(result);
        renderArtifactOptions();
        renderPredicates();
        renderFieldOptions();
        renderCounts();
        syncFields();
        setStatus('Drafted campaign opened', state.campaignId);
      });
    }

    function loadTemplateArtifact() {
      var file = selectedArtifact(templateSelect);
      if (!file) throw new Error('Select a template artifact.');
      return fetchArtifactText(file).then(function(result) {
        state.htmlArtifactRef = workspaceFileRef(result.file, 'html', result.sha256);
        autoFillDetails(false);
        setStatus('HTML template selected', filePath(result.file));
        syncFields();
      });
    }

    function loadAudienceArtifact() {
      var file = selectedArtifact(audienceSelect);
      if (!file) throw new Error('Select an audience artifact.');
      return fetchArtifactText(file).then(function(result) {
        var format = filePath(result.file).toLowerCase().endsWith('.csv') ? 'csv' : 'json';
        state.sourceAudienceRef = workspaceFileRef(result.file, format, result.sha256);
        state.sourceAudienceText = result.text;
        state.audienceRows = parseAudience(result.text, format);
        state.fieldPaths = collectAudienceFieldPaths(state.audienceRows);
        renderFieldOptions();
        if (!state.filterSpec.predicates.length && state.fieldPaths.length) {
          state.filterSpec.predicates = [];
        }
        return recomputeFilter().then(function() {
          autoFillDetails(false);
          state.wizardStep = 'filter';
          setStatus('Audience loaded', state.audienceRows.length + ' source row(s)');
          syncFields();
        });
      });
    }

    function createWorkspaceFolder() {
      var api = client();
      if (!api || typeof api.request !== 'function') throw new Error('Workspace folder creation is unavailable.');
      return ensureWorkspaceContext().then(function(workspaceId) {
        var folderName = normalizeWorkspacePath(state.newFolderName).replace(/\//g, '-');
        if (!folderName) throw new Error('Enter a folder name.');
        var parent = normalizeWorkspacePath(state.selectedSaveFolder || state.saveFolder || 'email/audiences/filtered').replace(/\/+$/, '');
        var folderPath = normalizeWorkspacePath((parent ? parent + '/' : '') + folderName);
        return api.request('POST', '/workspaces/' + encodeURIComponent(workspaceId) + '/user-sandbox/folders', {
          folderPath: folderPath,
        }).then(function(result) {
          state.saveFolder = folderPath;
          state.selectedSaveFolder = folderPath;
          state.newFolderName = '';
          state.saveFolderTouched = true;
          setStatus('Folder ready', folderPath);
          renderSaveDialog();
          return result;
        });
      });
    }

    function recomputeFilter() {
      return applyFilter(state.audienceRows, state.filterSpec).then(function(result) {
        state.filterResult = result;
        state.filterSpec = result.filterSpec;
        state.filteredAudienceRef = null;
        updateSuggestedSaveFileName(result);
        clearPreparedWorkflow();
        renderCounts();
        syncFields();
        return result;
      });
    }

    function addPredicate() {
      var path = fieldBrowser.value || state.fieldPaths[0] || 'email';
      state.filterSpec.predicates.push({
        mode: 'include',
        fieldPath: path,
        operator: 'equals',
        value: '',
      });
      renderPredicates();
      recomputeFilter();
    }

    function removePredicate(index) {
      state.filterSpec.predicates.splice(index, 1);
      renderPredicates();
      recomputeFilter();
    }

    function filteredArtifactPayload(result) {
      return {
        schemaVersion: FILTERED_AUDIENCE_SCHEMA_VERSION,
        source: 'mcpviews-email-deliverability-plugin',
        createdAt: new Date().toISOString(),
        name: state.name || 'Filtered audience',
        rowCount: result.rows.length,
        sourceArtifactRef: state.sourceAudienceRef,
        audienceFilterSpec: result.filterSpec,
        audienceFilterHash: result.filterHash,
        counts: result.counts,
        rows: result.rows,
        metadata: {
          kind: 'email-campaign-filtered-audience',
          sourceArtifactRef: state.sourceAudienceRef,
          audienceFilterSpec: result.filterSpec,
          audienceFilterHash: result.filterHash,
          audienceFilterCounts: result.counts,
          fieldPaths: result.fieldPaths,
        },
      };
    }

    function resolveWorkspaceFileRef(workspaceId, ref) {
      if (!window.__tribexAiClient || !ref || isWorkspaceFileId(ref.workspaceFileId)) {
        return Promise.resolve(ref);
      }
      if (!ref.workspacePath || typeof window.__tribexAiClient.listWorkspaceFiles !== 'function') {
        return Promise.resolve(ref);
      }
      return window.__tribexAiClient.listWorkspaceFiles(workspaceId, ref.workspacePath)
        .then(function(result) {
          var files = result && result.files || [];
          var match = files.find(function(file) {
            return filePath(file) === ref.workspacePath;
          });
          if (!match) throw new Error('Filtered audience artifact is not indexed yet.');
          var id = workspaceFileId(match);
          if (id) ref.workspaceFileId = id;
          ref.sizeBytes = ref.sizeBytes || match.sizeBytes;
          ref.sha256 = ref.sha256 || fileChecksum(match);
          return ref;
        });
    }

    function waitForWorkspaceFileReadable(workspaceId, ref, attempts) {
      if (!window.__tribexAiClient ||
        typeof window.__tribexAiClient.getWorkspaceFile !== 'function' ||
        typeof window.__tribexAiClient.fetchSignedFileBytes !== 'function' ||
        !ref) {
        return Promise.resolve(ref);
      }
      var remaining = attempts || 5;
      function attempt() {
        return resolveWorkspaceFileRef(workspaceId, ref)
          .then(function(resolvedRef) {
            if (!isWorkspaceFileId(resolvedRef.workspaceFileId)) {
              throw new Error('Filtered audience artifact is missing a durable file ID.');
            }
            return window.__tribexAiClient.getWorkspaceFile(workspaceId, resolvedRef.workspaceFileId);
          })
          .then(function(envelope) {
            return window.__tribexAiClient.fetchSignedFileBytes(envelope && envelope.download);
          })
          .then(function(downloaded) {
            if (!downloaded || !downloaded.bytes || downloaded.bytes.length === 0) {
              throw new Error('Filtered audience artifact is not readable yet.');
            }
            return ref;
          })
          .catch(function(error) {
            remaining -= 1;
            if (remaining <= 0) throw error;
            return new Promise(function(resolve) {
              window.setTimeout(resolve, 350);
            }).then(attempt);
          });
      }
      return attempt();
    }

    function saveFilteredAudience() {
      if (!window.__tribexAiClient ||
        typeof window.__tribexAiClient.initWorkspaceFileUpload !== 'function' ||
        typeof window.__tribexAiClient.uploadWorkspaceFileToSignedUrl !== 'function') {
        throw new Error('Workspace upload APIs are unavailable.');
      }
      return ensureWorkspaceContext()
        .then(function(workspaceId) {
          return (state.filterResult ? Promise.resolve(state.filterResult) : recomputeFilter()).then(function(result) {
            if (!result.rows.length) throw new Error('The filtered audience has no valid recipients.');
            state.saveFolder = state.selectedSaveFolder || state.saveFolder || 'email/audiences/filtered';
            var artifact = filteredArtifactPayload(result);
            var content = JSON.stringify(artifact, null, 2);
            var path = normalizedJoinPath(state.saveFolder, state.saveFileName);
            var blob = new Blob([content], { type: 'application/json' });
            return sha256Text(content).then(function(hash) {
              return window.__tribexAiClient.initWorkspaceFileUpload(workspaceId, {
                relativePath: path,
                contentType: 'application/json',
                sizeBytes: blob.size,
                source: 'mcpviews-email-campaign-launcher',
                metadata: {
                  kind: 'email-campaign-filtered-audience',
                  name: state.name,
                  sourceArtifactRef: state.sourceAudienceRef,
                  audienceFilterHash: result.filterHash,
                  audienceFilterCounts: result.counts,
                },
              }).then(function(init) {
                return window.__tribexAiClient.uploadWorkspaceFileToSignedUrl(init && init.upload, blob).then(function() {
                  state.filteredAudienceRef = compactObject({
                    source: 'workspace_file',
                    format: 'json',
                    workspacePath: path,
                    workspaceFileId: workspaceFileId(init && init.file),
                    sha256: hash,
                    sizeBytes: blob.size,
                  });
                  return waitForWorkspaceFileReadable(workspaceId, state.filteredAudienceRef, 6).then(function() {
                    setStatus('Filtered audience saved', path);
                    state.saveDialogOpen = false;
                    syncFields();
                    return state.filteredAudienceRef;
                  });
                });
              });
            });
          });
        });
    }

    function campaignPreparePayload(audienceRef, filterResult) {
      var result = filterResult || state.filterResult;
      if (!result) throw new Error('Apply the audience filter before preparing.');
      var audienceInput = audienceRef
        ? {
            audienceArtifactRef: audienceRef,
          }
        : {
            audience: result.rows,
            audienceArtifactRef: {
              source: 'inline',
              format: 'json',
            },
          };
      return compactObject(Object.assign({
        name: state.name.trim() || 'Manual email campaign',
        templateKey: state.templateKey.trim(),
        templateName: state.templateName.trim() || state.name.trim(),
        subjectTemplate: state.subjectTemplate,
        textTemplate: state.textTemplate,
        htmlTemplateArtifactRef: state.htmlArtifactRef,
        audienceFilterSpec: result.filterSpec,
        audienceFilterHash: result.filterHash,
        audienceFilterCounts: result.counts,
        metadata: {
          source: 'mcpviews-email-campaign-launcher',
          stage: 'manual-campaign',
          sourceAudienceArtifactRef: state.sourceAudienceRef,
          filteredAudienceArtifactRef: audienceRef || null,
          audienceStaging: audienceRef ? 'durable_saved_artifact' : 'temporary_inline_prepare',
          audienceFilterSpec: result.filterSpec,
          audienceFilterHash: result.filterHash,
          audienceFilterCounts: result.counts,
        },
      }, audienceInput));
    }

    function ensureRuntimeEnvelope() {
      var client = window.__tribexAiClient;
      if (!client) throw new Error('TribeX AI client is unavailable.');
      if (state.threadId.trim() && typeof client.ensureRuntimeSession === 'function') {
        return client.ensureRuntimeSession(state.threadId.trim(), { forceRefresh: false }).then(function(envelope) {
          if (envelope && envelope.thread) applyThreadContext(envelope.thread);
          return envelope;
        });
      }
      if (typeof client.request === 'function') {
        return client.request('POST', '/api/mcpviews/runtime-session', {
          organizationId: state.organizationId.trim() || undefined,
          workspaceId: state.workspaceId.trim() || undefined,
          projectId: state.projectId.trim() || undefined,
          threadId: state.threadId.trim() || undefined,
          threadTitle: 'Manual email campaign launcher',
          purpose: 'email-campaign-launcher',
          metadata: { source: 'mcpviews-email-campaign-launcher' },
        }).then(function(envelope) {
          if (envelope && envelope.thread && envelope.thread.id) state.threadId = envelope.thread.id;
          if (envelope && envelope.workspace) {
            state.workspaceId = envelope.workspace.id || state.workspaceId;
            state.organizationId = envelope.workspace.organizationId || state.organizationId;
          }
          if (envelope && envelope.project) state.projectId = envelope.project.id || state.projectId;
          syncFields();
          return envelope;
        });
      }
      throw new Error('No runtime bridge is available for direct campaign calls.');
    }

    function platformPath(action) {
      return {
        domains: '/api/internal/runtime/email-deliverability/domains',
        list: '/api/internal/runtime/email-deliverability/campaigns/list',
        prepare: '/api/internal/runtime/email-deliverability/campaigns/prepare',
        preview: '/api/internal/runtime/email-deliverability/campaigns/preview',
        testSend: '/api/internal/runtime/email-deliverability/campaigns/test-send',
        review: '/api/internal/runtime/email-deliverability/campaigns/review/prepare',
        apply: '/api/internal/runtime/email-deliverability/campaigns/send/apply',
        status: '/api/internal/runtime/email-deliverability/campaigns/status',
      }[action];
    }

    function manualPlatformPath(action) {
      return {
        domains: '/api/mcpviews/email-deliverability/domains',
        list: '/api/mcpviews/email-deliverability/campaigns/list',
        prepare: '/api/mcpviews/email-deliverability/campaigns/prepare',
        preview: '/api/mcpviews/email-deliverability/campaigns/preview',
        testSend: '/api/mcpviews/email-deliverability/campaigns/test-send',
        review: '/api/mcpviews/email-deliverability/campaigns/review/prepare',
        apply: '/api/mcpviews/email-deliverability/campaigns/send/apply',
        status: '/api/mcpviews/email-deliverability/campaigns/status',
      }[action];
    }

    function withManualContext(payload) {
      return compactObject(Object.assign({}, payload || {}, {
        organizationId: normalizeIdentifier(state.organizationId),
        workspaceId: normalizeIdentifier(state.workspaceId),
        projectId: normalizeIdentifier(state.projectId),
        threadId: normalizeIdentifier(state.threadId),
      }));
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

    function callRuntimePlatform(action, payload) {
      return ensureRuntimeEnvelope().then(function(envelope) {
        var runtimeSession = envelope && envelope.runtimeSession;
        var token = runtimeSession && runtimeSession.token;
        var host = runtimeSession && runtimeSession.connection && runtimeSession.connection.host;
        if (!token || !host) throw new Error('Runtime session did not include a direct platform bearer token.');
        var path = platformPath(action);
        return fetch(host.replace(/\/+$/, '') + path, {
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

    function callPlatform(action, payload) {
      var client = window.__tribexAiClient;
      if (client && typeof client.request === 'function') {
        var manualPath = manualPlatformPath(action);
        if (manualPath) {
          return client.request('POST', manualPath, withManualContext(payload)).catch(function(error) {
            if (missingManualEndpoint(error) && client && typeof client.callEmailDeliverability === 'function') {
              return client.callEmailDeliverability(action, withManualContext(payload || {}));
            }
            if (missingManualEndpoint(error)) return callRuntimePlatform(action, payload);
            throw new Error(platformErrorDetail(error));
          });
        }
      }
      if (client && typeof client.callEmailDeliverability === 'function') {
        return client.callEmailDeliverability(action, withManualContext(payload || {})).catch(function(error) {
          if (missingManualEndpoint(error)) return callRuntimePlatform(action, payload);
          throw new Error(platformErrorDetail(error));
        });
      }
      return callRuntimePlatform(action, payload);
    }

    function renderResult(value) {
      state.lastResult = value;
      resultEl.textContent = JSON.stringify(value, null, 2);
      renderWorkflow();
    }

    function prepareCampaign() {
      return (state.filterResult ? Promise.resolve(state.filterResult) : recomputeFilter()).then(function(filterResult) {
        if (!filterResult.rows.length) throw new Error('The filtered audience has no valid recipients.');
        return callPlatform('prepare', campaignPreparePayload(state.filteredAudienceRef, filterResult)).then(function(result) {
          state.campaignId = result && result.campaign && result.campaign.id || '';
          state.preparedResult = result;
          state.activeStep = 'prepare';
          state.wizardStep = 'review-message';
          renderResult(result);
          setStatus('Campaign prepared', state.campaignId || '');
          return listPreparedCampaigns().catch(function() { return null; });
        });
      });
    }

    function previewCampaign() {
      if (!state.campaignId) throw new Error('Prepare a campaign first.');
      return callPlatform('preview', { campaignId: state.campaignId, limit: 3 }).then(function(result) {
        state.previewResult = result;
        var preview = selectedPreview();
        state.testRecipientId = preview && preview.recipientId || '';
        state.testTo = state.testTo || selectedPreviewEmail();
        state.activeStep = 'preview';
        state.wizardStep = 'review-message';
        renderResult(result);
        setStatus('Preview ready', state.campaignId);
      });
    }

    function testSendCampaign() {
      if (!state.campaignId) throw new Error('Prepare a campaign first.');
      var preview = selectedPreview();
      state.testRecipientId = preview && preview.recipientId || state.testRecipientId;
      if (!state.testTo.trim()) state.testTo = selectedPreviewEmail();
      if (!state.testTo.trim()) throw new Error('Test recipient is required.');
      return callPlatform('testSend', {
        campaignId: state.campaignId,
        testTo: state.testTo.trim(),
        recipientId: state.testRecipientId || undefined,
      }).then(function(result) {
        state.testResult = result;
        state.activeStep = 'test';
        state.wizardStep = 'test';
        renderResult(result);
        setStatus('Test send requested', state.campaignId);
      });
    }

    function prepareReview() {
      if (!state.campaignId) throw new Error('Prepare a campaign first.');
      return callPlatform('review', { campaignId: state.campaignId }).then(function(result) {
        state.reviewSessionId = result && result.reviewSessionId || '';
        state.reviewResult = result;
        state.activeStep = 'review';
        state.wizardStep = 'approve';
        renderResult(result);
        setStatus('Review summary ready', state.reviewSessionId);
        return null;
      });
    }

    function applySend() {
      if (!state.campaignId) throw new Error('Prepare a campaign first.');
      if (!state.scheduledLocal.trim()) {
        throw new Error('Select a send date/time before applying the production send.');
      }
      var scheduledAt = localDateTimeToIso(state.scheduledLocal, state.scheduledTimeZone);
      if (!scheduledAt) throw new Error('Could not convert scheduled send date/time.');
      return callPlatform('apply', {
        campaignId: state.campaignId,
        confirmed: true,
        reviewSessionId: state.reviewSessionId || undefined,
        scheduledAt: scheduledAt,
        scheduledTimeZone: state.scheduledTimeZone || browserTimeZone(),
      }).then(function(result) {
        state.applyResult = result;
        state.activeStep = 'status';
        state.wizardStep = 'status';
        renderResult(result);
        setStatus('Send apply submitted', state.campaignId);
        return getStatus().catch(function() { return null; });
      });
    }

    function getStatus() {
      if (!state.campaignId) throw new Error('Prepare a campaign first.');
      return callPlatform('status', { campaignId: state.campaignId, includeRecipients: true }).then(function(result) {
        state.statusResult = result;
        state.activeStep = 'status';
        state.wizardStep = 'status';
        renderResult(result);
        setStatus('Status loaded', state.campaignId);
      });
    }

    function runAction(action, actionEl) {
      clearError();
      var promise;
      try {
        syncStateFromFields();
        if (action === 'wizard-step') {
          setWizardStep(actionEl.getAttribute('data-step'));
          return;
        }
        if (action === 'next-audience') {
          setWizardStep('audience');
          return;
        }
        if (action === 'next-filter') {
          setWizardStep('filter');
          return;
        }
        if (action === 'next-review-message') {
          setWizardStep('review-message');
          return;
        }
        if (action === 'open-save-dialog') {
          state.saveDialogOpen = true;
          renderSaveDialog();
          return;
        }
        if (action === 'close-save-dialog') {
          state.saveDialogOpen = false;
          renderSaveDialog();
          return;
        }
        if (action === 'remove-predicate') {
          removePredicate(Number(actionEl.getAttribute('data-index')));
          return;
        }
        if (action === 'resolve') promise = resolveThread();
        if (action === 'discover-context') promise = discoverContext();
        if (action === 'load-workspaces') promise = loadWorkspacesForSelectedOrg().then(function() {
          if (state.workspaceId) return loadWorkspaceScopedResources();
          return null;
        });
        if (action === 'load-workspace-resources') promise = loadWorkspaceScopedResources();
        if (action === 'search') promise = searchArtifacts();
        if (action === 'list-campaigns') promise = listPreparedCampaigns();
        if (action === 'open-prepared-campaign') promise = openPreparedCampaign();
        if (action === 'load-template') promise = loadTemplateArtifact();
        if (action === 'load-audience') promise = loadAudienceArtifact();
        if (action === 'create-folder') promise = createWorkspaceFolder();
        if (action === 'autofill-details') {
          autoFillDetails(true);
          return;
        }
        if (action === 'add-predicate') {
          addPredicate();
          return;
        }
        if (action === 'apply-filter') promise = recomputeFilter().then(function(result) {
          setStatus('Filter applied', result.counts.filtered + ' recipient(s)');
          setWizardStep('review-message');
        });
        if (action === 'save-filtered') promise = saveFilteredAudience();
        if (action === 'prepare') promise = prepareCampaign();
        if (action === 'preview') promise = previewCampaign();
        if (action === 'activate-test') {
          setWizardStep('test');
          return;
        }
        if (action === 'test-send') promise = testSendCampaign();
        if (action === 'review') promise = prepareReview();
        if (action === 'activate-apply') {
          state.activeStep = 'apply';
          setWizardStep('approve');
          return;
        }
        if (action === 'apply') promise = applySend();
        if (action === 'status') promise = getStatus();
        if (action === 'refresh-status') promise = getStatus();
        if (!promise) return;
        setBusy(true, 'Working');
        promise.catch(showError).finally(function() {
          setBusy(false);
        });
      } catch (error) {
        showError(error);
      }
    }

    state.fieldPaths = collectAudienceFieldPaths(state.audienceRows);
    renderArtifactOptions();
    renderFieldOptions();
    renderPredicates();
    renderCounts();
    syncFields();
    renderWorkflow();
    if (state.sourceAudienceRef && state.sourceAudienceRef.workspacePath) {
      setStatus('Ready', 'Load the selected source audience to inspect fields.');
    }
    if (client()) {
      setBusy(true, 'Finding organizations');
      discoverContext().catch(showError).finally(function() {
        setBusy(false);
      });
    } else {
      state.contextStatus = 'TribeX AI client is unavailable. Open from an authenticated MCPViews AI session.';
      renderContextControls();
    }
  };
})();
