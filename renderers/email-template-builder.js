(function() {
  'use strict';

  window.__renderers = window.__renderers || {};

  var PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z_][a-zA-Z0-9_.-]*)\s*}}/g;
  var ARTIFACT_SCHEMA_VERSION = 'tribex.emailTemplateDraft.v1';

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
    for (var i = 0; i < values.length; i++) {
      if (typeof values[i] === 'string' && values[i].trim()) return values[i].trim();
    }
    return fallback || '';
  }

  function extractVariables() {
    var names = {};
    for (var i = 0; i < arguments.length; i++) {
      var template = arguments[i];
      if (!template) continue;
      var matches = String(template).matchAll(PLACEHOLDER_PATTERN);
      for (var match of matches) names[match[1]] = true;
    }
    return Object.keys(names).sort();
  }

  function readTemplateVariable(row, path) {
    var current = row;
    String(path || '').split('.').forEach(function(segment) {
      if (isRecord(current) && Object.prototype.hasOwnProperty.call(current, segment)) {
        current = current[segment];
      } else {
        current = undefined;
      }
    });
    return current;
  }

  function scalarValue(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return null;
  }

  function renderTemplate(template, variables) {
    var unresolved = {};
    var rendered = String(template || '').replace(PLACEHOLDER_PATTERN, function(placeholder, variableName) {
      var value = scalarValue(readTemplateVariable(variables || {}, variableName));
      if (value == null) {
        unresolved[variableName] = true;
        return placeholder;
      }
      return value;
    });
    return {
      rendered: rendered,
      unresolved: Object.keys(unresolved).sort(),
    };
  }

  function decodeHtmlEntities(value) {
    if (typeof document !== 'undefined' && document.createElement) {
      var textarea = document.createElement('textarea');
      textarea.innerHTML = value;
      return textarea.value;
    }
    return String(value || '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function htmlToPlainText(html) {
    var text = String(html || '');
    if (!text.trim()) return '';
    text = text
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, function(_match, href, label) {
        var cleanLabel = decodeHtmlEntities(String(label || '').replace(/<[^>]+>/g, '').trim());
        var cleanHref = decodeHtmlEntities(String(href || '').trim());
        if (!cleanLabel) return cleanHref;
        if (!cleanHref || cleanLabel === cleanHref) return cleanLabel;
        return cleanLabel + ' (' + cleanHref + ')';
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|header|footer|h[1-6]|tr|table)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    return decodeHtmlEntities(text)
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function sanitizePreviewHtml(html) {
    var template = document.createElement('template');
    template.innerHTML = String(html || '');
    Array.prototype.slice.call(template.content.querySelectorAll('script,iframe,object,embed,form,input,button,textarea,select')).forEach(function(node) {
      node.remove();
    });
    Array.prototype.slice.call(template.content.querySelectorAll('*')).forEach(function(node) {
      Array.prototype.slice.call(node.attributes || []).forEach(function(attribute) {
        var name = String(attribute.name || '').toLowerCase();
        var value = String(attribute.value || '');
        if (name.indexOf('on') === 0) node.removeAttribute(attribute.name);
        if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) node.removeAttribute(attribute.name);
      });
    });
    return template.innerHTML;
  }

  function syncTextTemplate(state) {
    state.textTemplate = htmlToPlainText(state.htmlTemplate);
    return state.textTemplate;
  }

  function parseAudience(text) {
    var parsed = JSON.parse(text || '[]');
    if (Array.isArray(parsed)) return parsed;
    if (isRecord(parsed) && Array.isArray(parsed.audience)) return parsed.audience;
    if (isRecord(parsed) && Array.isArray(parsed.rows)) return parsed.rows;
    throw new Error('Audience must be a JSON array, or an object with audience or rows.');
  }

  function rowEmail(row) {
    if (!isRecord(row)) return '';
    var value = row.email || row.emailAddress || row.email_address;
    return typeof value === 'string' ? value.trim() : '';
  }

  function validateState(state) {
    if (!state.subjectTemplate.trim()) throw new Error('Subject template is required.');
    if (!state.htmlTemplate.trim()) throw new Error('HTML template is required.');
    var textTemplate = syncTextTemplate(state);
    if (!textTemplate.trim()) throw new Error('Plain text preview could not be generated from the HTML template.');
    var audience = parseAudience(state.audienceText);
    if (!audience.length) throw new Error('At least one sample audience row is required.');
    for (var i = 0; i < audience.length; i++) {
      if (!rowEmail(audience[i])) {
        throw new Error('Every audience row must include email, emailAddress, or email_address.');
      }
    }
    var firstRow = isRecord(audience[0]) ? audience[0] : {};
    var variables = extractVariables(state.subjectTemplate, textTemplate, state.htmlTemplate);
    var subject = renderTemplate(state.subjectTemplate, firstRow);
    var text = renderTemplate(textTemplate, firstRow);
    var html = state.htmlTemplate.trim()
      ? renderTemplate(state.htmlTemplate, firstRow)
      : { rendered: '', unresolved: [] };
    var missing = {};
    subject.unresolved.concat(text.unresolved).concat(html.unresolved).forEach(function(name) {
      missing[name] = true;
    });
    return {
      audience: audience,
      firstRow: firstRow,
      variables: variables,
      missingVariables: Object.keys(missing).sort(),
      preview: {
        subject: subject.rendered,
        text: text.rendered,
        html: html.rendered,
      },
    };
  }

  function normalizeDecisionIds(value) {
    if (Array.isArray(value)) {
      return value.map(function(item) { return String(item || '').trim(); }).filter(Boolean).slice(0, 25);
    }
    return String(value || '')
      .split(',')
      .map(function(item) { return item.trim(); })
      .filter(Boolean)
      .slice(0, 25);
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

  function normalizeArtifactRef(value, fallbackFormat) {
    if (!isRecord(value)) return null;
    var workspacePath = firstString([value.workspacePath, value.relativePath], '');
    var workspaceFileId = firstString([value.workspaceFileId, value.fileId], '');
    var sha256 = firstString([value.sha256], '').replace(/^sha256:/i, '');
    var format = firstString([value.format], fallbackFormat || '');
    if (!workspacePath && !workspaceFileId) return null;
    return compactObject({
      source: value.source || 'workspace_file',
      format: format,
      workspacePath: workspacePath,
      workspaceFileId: workspaceFileId,
      sha256: sha256,
      sizeBytes: value.sizeBytes,
    });
  }

  function setNestedValue(target, path, value) {
    var segments = String(path || '').split('.').filter(Boolean);
    var current = target;
    segments.forEach(function(segment, index) {
      if (index === segments.length - 1) {
        current[segment] = value;
        return;
      }
      if (!isRecord(current[segment])) current[segment] = {};
      current = current[segment];
    });
  }

  function syntheticAudienceRow(variables, sampleVariables) {
    var row = {
      email: 'preview@example.com',
      emailAddress: 'preview@example.com',
    };
    var samples = isRecord(sampleVariables) ? sampleVariables : {};
    variables.forEach(function(variable) {
      var sample = scalarValue(readTemplateVariable(samples, variable));
      setNestedValue(row, variable, sample == null ? '[' + variable + ']' : sample);
    });
    return row;
  }

  function normalizeDraftInput(value) {
    var raw = isRecord(value) ? value : {};
    var prepare = isRecord(raw.campaignPreparePayload) ? raw.campaignPreparePayload : {};
    var metadata = isRecord(prepare.metadata) ? prepare.metadata : {};
    var htmlRef =
      normalizeArtifactRef(raw.htmlTemplateArtifactRef, 'html') ||
      normalizeArtifactRef(prepare.htmlTemplateArtifactRef, 'html') ||
      normalizeArtifactRef(metadata.htmlTemplateArtifactRef, 'html') ||
      normalizeArtifactRef(raw.artifactRef, 'html');
    var audienceRef =
      normalizeArtifactRef(raw.audienceArtifactRef, 'json') ||
      normalizeArtifactRef(prepare.audienceArtifactRef, 'json') ||
      normalizeArtifactRef(metadata.audienceArtifactRef, 'json');
    var campaignDraftRef =
      normalizeArtifactRef(raw.campaignDraftArtifactRef, 'json') ||
      normalizeArtifactRef(metadata.campaignDraftArtifactRef, 'json');
    var merged = compactObject(Object.assign({}, raw, prepare, {
      testTo: raw.testTo || prepare.testTo,
      sampleVariables: raw.sampleVariables || metadata.sampleVariables,
      htmlTemplateArtifactRef: htmlRef,
      audienceArtifactRef: audienceRef,
      campaignDraftArtifactRef: campaignDraftRef,
      htmlArtifactPath: htmlRef && htmlRef.workspacePath || raw.htmlArtifactPath,
      htmlArtifactFileId: htmlRef && htmlRef.workspaceFileId || raw.htmlArtifactFileId,
      htmlArtifactSha256: htmlRef && htmlRef.sha256 || raw.htmlArtifactSha256,
      audienceArtifactPath: audienceRef && audienceRef.workspacePath || raw.audienceArtifactPath,
      audienceArtifactFileId: audienceRef && audienceRef.workspaceFileId || raw.audienceArtifactFileId,
      audienceArtifactFormat: audienceRef && audienceRef.format || raw.audienceArtifactFormat || 'json',
      audienceArtifactSha256: audienceRef && audienceRef.sha256 || raw.audienceArtifactSha256,
      workspacePath: campaignDraftRef && campaignDraftRef.workspacePath || raw.workspacePath || raw.relativePath,
      workspaceFileId: campaignDraftRef && campaignDraftRef.workspaceFileId || raw.workspaceFileId || raw.fileId,
      workspaceSha256: campaignDraftRef && campaignDraftRef.sha256 || raw.workspaceSha256 || raw.sha256,
    }));
    delete merged.campaignPreparePayload;
    return merged;
  }

  function campaignPayload(state, artifact, options) {
    options = options || {};
    syncTextTemplate(state);
    var validation = validateState(state);
    var testOnly = options.testOnly !== false;
    var useAudienceArtifact = !!(state.audienceArtifactPath.trim() || state.audienceArtifactFileId.trim());
    var useHtmlArtifact = !!(state.htmlArtifactPath.trim() || state.htmlArtifactFileId.trim());
    var audienceArtifactRef = useAudienceArtifact
      ? {
          source: 'workspace_file',
          format: state.audienceArtifactFormat.trim() || 'json',
          workspacePath: state.audienceArtifactPath.trim(),
          workspaceFileId: state.audienceArtifactFileId.trim(),
          sha256: state.audienceArtifactSha256.trim(),
        }
      : {
          source: 'mcpviews-email-deliverability-plugin',
          workspacePath: artifact && artifact.workspacePath,
          workspaceFileId: artifact && artifact.workspaceFileId,
        };
    var htmlTemplateArtifactRef = useHtmlArtifact
      ? {
          source: 'workspace_file',
          workspacePath: state.htmlArtifactPath.trim(),
          workspaceFileId: state.htmlArtifactFileId.trim(),
          sha256: state.htmlArtifactSha256.trim(),
        }
      : undefined;
    return compactObject({
      name: state.name.trim() || state.templateName.trim() || 'Email template test',
      sendingIdentityId: state.sendingIdentityId.trim(),
      fromEmail: state.fromEmail.trim(),
      templateKey: state.templateKey.trim(),
      templateName: state.templateName.trim() || state.name.trim(),
      subjectTemplate: state.subjectTemplate,
      textTemplate: state.textTemplate,
      htmlTemplate: useHtmlArtifact ? undefined : state.htmlTemplate.trim() || undefined,
      htmlTemplateArtifactRef: htmlTemplateArtifactRef,
      audience: useAudienceArtifact
        ? undefined
        : (testOnly ? [validation.firstRow] : validation.audience),
      audienceArtifactRef: audienceArtifactRef,
      decidrProjectId: state.decidrProjectId.trim(),
      decidrDecisionIds: normalizeDecisionIds(state.decidrDecisionIds),
      metadata: {
        source: 'mcpviews-email-deliverability-plugin',
        stage: testOnly ? 'template-test' : 'campaign-draft',
        artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
        variables: validation.variables,
        workspacePath: artifact && artifact.workspacePath,
        workspaceFileId: artifact && artifact.workspaceFileId,
        audienceArtifactRef: audienceArtifactRef,
        htmlTemplateArtifactRef: htmlTemplateArtifactRef,
      },
      maxRecipients: testOnly ? 1 : undefined,
    });
  }

  function artifactPayload(state, artifact) {
    syncTextTemplate(state);
    var validation = validateState(state);
    return {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      source: 'mcpviews-email-deliverability-plugin',
      createdAt: new Date().toISOString(),
      context: compactObject({
        organizationId: state.organizationId,
        workspaceId: state.workspaceId,
        projectId: state.projectId,
        threadId: state.threadId,
      }),
      template: compactObject({
        name: state.name.trim() || state.templateName.trim(),
        key: state.templateKey.trim(),
        fromEmail: state.fromEmail.trim(),
        sendingIdentityId: state.sendingIdentityId.trim(),
        subjectTemplate: state.subjectTemplate,
        textTemplate: state.textTemplate,
        htmlTemplate: state.htmlTemplate.trim() || undefined,
        variables: validation.variables,
      }),
      sampleAudience: validation.audience,
      preview: validation.preview,
      personaTest: {
        testTo: state.testTo.trim(),
        campaignPayload: campaignPayload(state, artifact, { testOnly: true }),
        tools: [
          'email_campaign_prepare',
          'email_campaign_preview',
          'email_campaign_test_send',
        ],
        forbiddenTools: [
          'email_campaign_review_propose',
          'email_campaign_send_apply',
        ],
      },
      campaignWorkflow: {
        testTo: state.testTo.trim(),
        campaignPayload: campaignPayload(state, artifact, { testOnly: false }),
        tools: [
          'email_campaign_prepare',
          'email_campaign_preview',
          'email_campaign_test_send',
          'email_campaign_review_propose',
          'email_campaign_send_apply',
          'email_campaign_status',
        ],
        approvalRequired: true,
      },
      provenance: compactObject({
        workspacePath: artifact && artifact.workspacePath,
        workspaceFileId: artifact && artifact.workspaceFileId,
      }),
    };
  }

  function personaPrompt(state, artifact) {
    var validation = validateState(state);
    if (validation.missingVariables.length) {
      throw new Error('Sample row is missing variables: ' + validation.missingVariables.join(', '));
    }
    if (!state.testTo.trim()) throw new Error('Test recipient email is required.');
    var payload = campaignPayload(state, artifact, { testOnly: true });
    return [
      'Prepare exactly one deterministic email campaign snapshot and send exactly one test email.',
      '',
      'Use only these email deliverability tools in this order:',
      '1. email_campaign_prepare with the JSON payload below.',
      '2. email_campaign_preview with the returned campaignId and limit 1.',
      '3. email_campaign_test_send with the returned campaignId and testTo ' + JSON.stringify(state.testTo.trim()) + '.',
      '',
      'Do not call email_campaign_review_propose.',
      'Do not call email_campaign_send_apply.',
      'Do not send a production campaign.',
      'Do not modify the templates, audience row, sender, or test recipient after preparation.',
      '',
      artifact && artifact.workspacePath
        ? 'Workspace draft artifact: ' + artifact.workspacePath
        : 'Workspace draft artifact: not provided.',
      '',
      'email_campaign_prepare payload:',
      '```json',
      JSON.stringify(payload, null, 2),
      '```',
      '',
      'After the tool calls, summarize the campaignId, snapshotHash if present, preview count, and test-send result. Do not include raw rendered body content in the summary.',
    ].join('\n');
  }

  function personaCampaignPrompt(state, artifact) {
    var validation = validateState(state);
    if (validation.missingVariables.length) {
      throw new Error('Sample row is missing variables: ' + validation.missingVariables.join(', '));
    }
    var payload = campaignPayload(state, artifact, { testOnly: false });
    var testTo = state.testTo.trim();
    return [
      'Prepare a deterministic email campaign from the payload below, preview it, send one test email if testTo is provided, then open an MCPViews approval review for production send.',
      '',
      'Use these email deliverability tools in order:',
      '1. email_campaign_prepare with the JSON payload below.',
      '2. email_campaign_preview with the returned campaignId and limit 3.',
      testTo
        ? '3. email_campaign_test_send with the returned campaignId and testTo ' + JSON.stringify(testTo) + '.'
        : '3. Skip email_campaign_test_send because no testTo was provided.',
      '4. email_campaign_review_propose with the campaignId.',
      '5. Wait for the MCPViews review to be accepted before calling email_campaign_send_apply.',
      '6. After accepted approval only, call email_campaign_send_apply with confirmed=true and the accepted reviewSessionId.',
      '7. Call email_campaign_status and summarize redacted counts, artifact refs, and hashes.',
      '',
      'Do not modify templates, sender, audience, artifact refs, or hashes after preparation.',
      'Do not include raw rendered body content or recipient emails in the final summary.',
      '',
      artifact && artifact.workspacePath
        ? 'Workspace draft artifact: ' + artifact.workspacePath
        : 'Workspace draft artifact: not provided.',
      '',
      'email_campaign_prepare payload:',
      '```json',
      JSON.stringify(payload, null, 2),
      '```',
    ].join('\n');
  }

  function slugify(value) {
    return String(value || 'email-template')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'email-template';
  }

  function timestampId() {
    return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  }

  function normalizeWorkspacePath(value) {
    return String(value || '')
      .trim()
      .replace(/^\/+/, '')
      .replace(/^workspace\/files\//, '');
  }

  function fileChecksum(file) {
    return firstString([
      file && file.checksum,
      file && file.sha256,
      file && file.metadata && file.metadata.sha256,
    ], '').replace(/^sha256:/i, '');
  }

  function filePath(file) {
    return normalizeWorkspacePath(firstString([
      file && file.relativePath,
      file && file.workspacePath,
      file && file.path,
    ], ''));
  }

  function artifactKind(file) {
    var path = filePath(file).toLowerCase();
    var contentType = String(file && file.contentType || '').toLowerCase();
    if (path.endsWith('.html') || path.endsWith('.htm') || contentType.indexOf('text/html') === 0) {
      return 'html';
    }
    if (path.endsWith('.campaign.json') || path.indexOf('/campaigns/') >= 0) {
      return 'campaign';
    }
    if (path.endsWith('.audience.json') || path.endsWith('.csv') || path.indexOf('/audiences/') >= 0) {
      return 'audience';
    }
    if (path.endsWith('.json') || contentType.indexOf('json') >= 0) {
      return 'json';
    }
    return 'other';
  }

  function artifactKindLabel(kind) {
    if (kind === 'html') return 'HTML template';
    if (kind === 'campaign') return 'Campaign draft';
    if (kind === 'audience') return 'Audience';
    if (kind === 'json') return 'Email JSON';
    return 'File';
  }

  function artifactKey(file) {
    return firstString([file && file.id, file && file.workspaceFileId], '') || filePath(file);
  }

  function orgLabel(org) {
    if (!isRecord(org)) return 'Organization';
    return firstString([org.name, org.title, org.slug, org.id], 'Organization');
  }

  function workspaceLabel(workspace) {
    if (!isRecord(workspace)) return 'Workspace';
    var packageName = firstString([workspace.packageName, workspace.packageKey], '');
    var label = firstString([workspace.name, workspace.title, workspace.slug, workspace.id], 'Workspace');
    return packageName ? label + ' · ' + packageName : label;
  }

  function templateChoiceLabel(file) {
    var path = filePath(file);
    var kind = artifactKindLabel(artifactKind(file));
    return path ? kind + ' · ' + path : kind;
  }

  function optionHtml(value, label, selected, disabled) {
    return '<option value="' + esc(value || '') + '"' +
      (selected ? ' selected' : '') +
      (disabled ? ' disabled' : '') +
      '>' + esc(label) + '</option>';
  }

  function formatBytes(value) {
    var size = Number(value || 0);
    if (!Number.isFinite(size) || size <= 0) return '--';
    if (size < 1024) return String(size) + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
    return (size / 1024 / 1024).toFixed(1).replace(/\.0$/, '') + ' MB';
  }

  function bytesToHex(bytes) {
    return Array.prototype.map.call(bytes, function(byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function sha256Hex(bytes, fallback) {
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
    for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(text));
  }

  function workspaceFileRef(file, format, sha256) {
    return compactObject({
      source: 'workspace_file',
      format: format,
      workspacePath: filePath(file),
      workspaceFileId: firstString([file && file.id, file && file.workspaceFileId], ''),
      sha256: sha256 || fileChecksum(file),
      sizeBytes: file && file.sizeBytes,
    });
  }

  function draftFromBuilderArtifact(value) {
    if (!isRecord(value) || value.schemaVersion !== ARTIFACT_SCHEMA_VERSION) return null;
    var template = isRecord(value.template) ? value.template : {};
    var context = isRecord(value.context) ? value.context : {};
    var personaTest = isRecord(value.personaTest) ? value.personaTest : {};
    var campaignWorkflow = isRecord(value.campaignWorkflow) ? value.campaignWorkflow : {};
    return compactObject({
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      threadId: context.threadId,
      name: template.name,
      templateKey: template.key,
      fromEmail: template.fromEmail,
      sendingIdentityId: template.sendingIdentityId,
      subjectTemplate: template.subjectTemplate,
      textTemplate: template.textTemplate,
      htmlTemplate: template.htmlTemplate,
      audience: value.sampleAudience,
      testTo: personaTest.testTo || campaignWorkflow.testTo,
    });
  }

  function draftFromCampaignArtifact(value, file, sha256) {
    if (!isRecord(value)) return null;
    if (value.schemaVersion !== 'tribex.emailCampaignDraft.v1' && !isRecord(value.campaignPreparePayload)) {
      return null;
    }
    var ref = workspaceFileRef(file, 'json', sha256);
    var prepare = isRecord(value.campaignPreparePayload)
      ? Object.assign({}, value.campaignPreparePayload)
      : {};
    var metadata = isRecord(prepare.metadata) ? Object.assign({}, prepare.metadata) : {};
    prepare.metadata = Object.assign(metadata, { campaignDraftArtifactRef: ref });
    return Object.assign({}, value, {
      campaignDraftArtifactRef: ref,
      campaignPreparePayload: prepare,
    });
  }

  function syncHash(value) {
    var hash = 2166136261;
    var text = String(value || '');
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
  }

  function visibleText(element) {
    return String(element && element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
  }

  function nthOfType(element) {
    if (!element || !element.parentElement) return 1;
    var tagName = element.tagName;
    var index = 1;
    var sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  function domPathFor(element) {
    var parts = [];
    var current = element;
    while (current && current.nodeType === 1) {
      var tag = String(current.tagName || '').toLowerCase();
      if (!tag || tag === 'html') break;
      if (tag === 'body') {
        parts.unshift('body');
        break;
      }
      parts.unshift(tag + ':nth-of-type(' + nthOfType(current) + ')');
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function selectionMetadataFromElement(element, iframe, state) {
    var rect = element.getBoundingClientRect();
    var outerHTML = String(element.outerHTML || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    var domPath = domPathFor(element);
    return compactObject({
      id: 'selection_' + Date.now() + '_' + Math.random().toString(16).slice(2),
      workspacePath: state.htmlArtifactPath,
      workspaceFileId: state.htmlArtifactFileId,
      sha256: state.htmlArtifactSha256,
      selector: domPath,
      domPath: domPath,
      tagName: String(element.tagName || '').toLowerCase(),
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        iframeWidth: iframe && iframe.clientWidth,
        iframeHeight: iframe && iframe.clientHeight,
      },
      visibleText: visibleText(element),
      outerHTML: outerHTML,
      snippetHash: syncHash(outerHTML),
      changeRequest: '',
    });
  }

  function hasEditableOwnText(element) {
    if (!element || !element.childNodes) return false;
    return Array.prototype.slice.call(element.childNodes).some(function(node) {
      return node.nodeType === 3 && String(node.nodeValue || '').replace(/\s+/g, ' ').trim();
    });
  }

  function shouldMakeManualEditable(element) {
    if (!element || !element.tagName) return false;
    var tag = String(element.tagName || '').toLowerCase();
    if (/^(html|head|body|table|tbody|thead|tfoot|tr|style|script|meta|link|img|br|hr)$/i.test(tag)) return false;
    return hasEditableOwnText(element) || (!element.children.length && visibleText(element));
  }

  function configureManualEditableSurface(root, enabled) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.slice.call(root.querySelectorAll('[data-manual-editable]')).forEach(function(element) {
      element.removeAttribute('contenteditable');
      element.removeAttribute('spellcheck');
      element.removeAttribute('data-manual-editable');
    });
    if (!enabled) return;
    Array.prototype.slice.call(root.querySelectorAll('*')).forEach(function(element) {
      if (!shouldMakeManualEditable(element)) return;
      element.setAttribute('contenteditable', 'plaintext-only');
      element.setAttribute('spellcheck', 'true');
      element.setAttribute('data-manual-editable', 'true');
    });
  }

  function cleanManualEditableHtml(root) {
    if (!root) return '';
    var clone = root.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll('[data-manual-editable]')).forEach(function(element) {
      element.removeAttribute('contenteditable');
      element.removeAttribute('spellcheck');
      element.removeAttribute('data-manual-editable');
    });
    return clone.innerHTML.trim();
  }

  function injectStyles() {
    var existing = document.getElementById('email-template-builder-styles');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var style = document.createElement('style');
    style.id = 'email-template-builder-styles';
    style.textContent = [
      '.email-builder-root{--email-bg:#0f1117;--email-surface:rgba(255,255,255,.055);--email-surface-strong:rgba(255,255,255,.09);--email-surface-subtle:rgba(255,255,255,.035);--email-border:rgba(255,255,255,.09);--email-border-strong:rgba(255,255,255,.16);--email-text:rgba(255,255,255,.94);--email-muted:rgba(255,255,255,.62);--email-faint:rgba(255,255,255,.38);--email-accent:#818cf8;--email-accent-hover:#6366f1;--email-success:#22c55e;--email-warning:#eab308;--email-danger:#ef4444;--email-info:#60a5fa;--email-shadow:0 8px 32px rgba(0,0,0,.28);box-sizing:border-box;min-height:100%;padding:18px;background:var(--email-bg);color:var(--email-text);font-family:Figtree,Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
      '.email-builder-root *{box-sizing:border-box;}',
      '.email-builder-shell{max-width:1320px;margin:0 auto;}',
      '.email-builder-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:2px 0 14px;border-bottom:1px solid var(--email-border);}',
      '.email-builder-title{margin:0;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:0;color:var(--email-text);}',
      '.email-builder-subtitle{margin:5px 0 0;color:var(--email-muted);font-size:13px;line-height:1.45;max-width:680px;}',
      '.email-builder-status{min-width:260px;text-align:right;font-size:12px;color:var(--email-muted);display:flex;flex-direction:column;align-items:flex-end;gap:6px;}',
      '.email-builder-status-pill{display:inline-flex;align-items:center;justify-content:center;min-height:22px;padding:4px 10px;border:1px solid var(--email-border);border-radius:999px;background:var(--email-surface);color:var(--email-muted);font-size:12px;font-weight:600;}',
      '.email-builder-status-pill.saved{background:rgba(34,197,94,.14);border-color:rgba(34,197,94,.32);color:var(--email-success);}',
      '.email-builder-status-pill.busy{background:rgba(96,165,250,.14);border-color:rgba(96,165,250,.32);color:var(--email-info);}',
      '.email-builder-status-path{max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--email-faint);}',
      '.email-builder-start{display:grid;grid-template-columns:1fr 1.1fr .9fr;gap:10px;margin-top:14px;}',
      '.email-builder-step{min-width:0;border:1px solid var(--email-border);border-radius:12px;background:var(--email-surface);box-shadow:0 1px 0 rgba(255,255,255,.04) inset;padding:12px;}',
      '.email-builder-step-head{display:flex;align-items:flex-start;gap:9px;margin-bottom:10px;}',
      '.email-builder-step-number{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:1px solid var(--email-border-strong);border-radius:999px;color:var(--email-accent);font-size:12px;font-weight:800;flex:0 0 auto;}',
      '.email-builder-step-title{margin:0;color:var(--email-text);font-size:13px;font-weight:750;}',
      '.email-builder-step-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;}',
      '.email-builder-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px;}',
      '.email-builder-stat{min-width:0;border:1px solid var(--email-border);border-radius:12px;background:var(--email-surface);box-shadow:0 1px 0 rgba(255,255,255,.04) inset;padding:11px 12px;}',
      '.email-builder-stat-label{display:block;font-size:11px;line-height:1.3;color:var(--email-faint);font-weight:600;text-transform:uppercase;}',
      '.email-builder-stat-value{display:block;margin-top:4px;font-size:18px;line-height:1.1;color:var(--email-accent);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.email-builder-stat-value.ready{color:var(--email-success);}',
      '.email-builder-stat-value.warning{color:var(--email-warning);}',
      '.email-builder-stat-value.blocked{color:var(--email-danger);}',
      '.email-builder-grid{display:grid;grid-template-columns:minmax(360px,.75fr) minmax(520px,1.25fr);gap:16px;margin-top:16px;align-items:start;}',
      '.email-builder-panel{background:var(--email-surface);border:1px solid var(--email-border);border-radius:12px;box-shadow:var(--email-shadow);overflow:hidden;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);}',
      '.email-builder-panel-header{padding:13px 14px;border-bottom:1px solid var(--email-border);background:var(--email-surface-subtle);}',
      '.email-builder-panel-title{font-size:14px;font-weight:700;color:var(--email-text);margin:0;}',
      '.email-builder-panel-body{padding:14px;}',
      '.email-builder-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}',
      '.email-builder-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;}',
      '.email-builder-field label{font-size:12px;color:var(--email-muted);font-weight:650;}',
      '.email-builder-field input,.email-builder-field textarea,.email-builder-field select{width:100%;border:1px solid var(--email-border-strong);border-radius:8px;background:rgba(255,255,255,.045);color:var(--email-text);font:inherit;font-size:13px;line-height:1.45;padding:9px 10px;outline:none;}',
      '.email-builder-field select{appearance:auto;}',
      '.email-builder-field input:focus,.email-builder-field textarea:focus,.email-builder-field select:focus{border-color:var(--email-accent);box-shadow:0 0 0 3px rgba(129,140,248,.16);background:rgba(255,255,255,.07);}',
      '.email-builder-field select:disabled{opacity:.55;cursor:not-allowed;}',
      '.email-builder-field textarea{min-height:112px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;}',
      '.email-builder-field textarea.large{min-height:180px;}',
      '.email-builder-field textarea.html-source{min-height:520px;font-size:15px;line-height:1.6;}',
      '.email-builder-artifacts{margin:2px 0 12px;padding:12px 0;border-top:1px solid var(--email-border);border-bottom:1px solid var(--email-border);}',
      '.email-builder-artifact-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;}',
      '.email-builder-artifact-title{margin:0;color:var(--email-text);font-size:13px;font-weight:700;}',
      '.email-builder-artifact-search{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end;}',
      '.email-builder-artifact-results{display:grid;gap:6px;margin-top:10px;max-height:230px;overflow:auto;}',
      '.email-builder-artifact-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--email-border);}',
      '.email-builder-artifact-row:first-child{border-top:0;}',
      '.email-builder-artifact-path{font-size:12px;color:var(--email-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.email-builder-artifact-meta{margin-top:3px;font-size:11px;color:var(--email-faint);}',
      '.email-builder-artifact-empty{font-size:12px;color:var(--email-muted);line-height:1.45;}',
      '.email-builder-actions{display:flex;flex-wrap:wrap;gap:8px;padding:14px;border-top:1px solid var(--email-border);background:var(--email-surface-subtle);}',
      '.email-builder-advanced{margin-top:12px;border-top:1px solid var(--email-border);padding-top:12px;}',
      '.email-builder-advanced summary{cursor:pointer;color:var(--email-muted);font-size:12px;font-weight:700;}',
      '.email-builder-advanced[open] summary{margin-bottom:12px;}',
      '.email-builder-button{border:1px solid var(--email-border-strong);border-radius:8px;background:transparent;color:var(--email-muted);padding:8px 11px;font-size:13px;font-weight:650;cursor:pointer;transition:background .15s ease,color .15s ease,border-color .15s ease;}',
      '.email-builder-button:hover{background:var(--email-surface-strong);color:var(--email-text);}',
      '.email-builder-button.primary{background:var(--email-accent);border-color:var(--email-accent);color:#fff;}',
      '.email-builder-button.primary:hover{background:var(--email-accent-hover);border-color:var(--email-accent-hover);}',
      '.email-builder-button.active{background:rgba(129,140,248,.18);border-color:var(--email-accent);color:var(--email-text);box-shadow:0 0 0 3px rgba(129,140,248,.16);}',
      '.email-builder-button.active::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--email-accent);margin-right:7px;vertical-align:1px;}',
      '.email-builder-button:disabled{opacity:.55;cursor:not-allowed;}',
      '.email-builder-computed{display:grid;gap:12px;}',
      '.email-builder-strip{border:1px solid var(--email-border);border-radius:12px;background:var(--email-surface);padding:12px;box-shadow:0 1px 0 rgba(255,255,255,.04) inset;}',
      '.email-builder-strip h3{font-size:13px;margin:0 0 8px;color:var(--email-text);}',
      '.email-builder-chip-row{display:flex;flex-wrap:wrap;gap:6px;}',
      '.email-builder-chip{border:1px solid var(--email-border-strong);background:rgba(129,140,248,.1);border-radius:999px;padding:4px 8px;font-size:12px;color:var(--email-text);}',
      '.email-builder-warning{border-color:rgba(234,179,8,.38);background:rgba(234,179,8,.12);color:var(--email-warning);}',
      '.email-builder-error{border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.12);color:var(--email-danger);}',
      '.email-builder-ok{border-color:rgba(34,197,94,.36);background:rgba(34,197,94,.12);color:var(--email-success);}',
      '.email-builder-validation-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:inherit;font-size:13px;}',
      '.email-builder-dot{width:8px;height:8px;border-radius:50%;background:currentColor;display:inline-block;flex-shrink:0;}',
      '.email-builder-preview-title{font-size:12px;font-weight:700;color:var(--email-muted);margin:10px 0 5px;}',
      '.email-builder-preview-box{border:1px solid var(--email-border);border-radius:8px;background:var(--email-surface-subtle);color:var(--email-text);padding:10px;white-space:pre-wrap;font-size:13px;line-height:1.45;max-height:220px;overflow:auto;}',
      '.email-builder-preview-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0 5px;}',
      '.email-builder-preview-head .email-builder-preview-title{margin:0;}',
      '.email-builder-preview-frame{position:relative;}',
      '.email-builder-preview-frame.selecting .email-builder-iframe,.email-builder-preview-frame.manual-editing .email-builder-iframe{display:none;}',
      '.email-builder-iframe{width:100%;height:min(760px,72vh);min-height:560px;border:1px solid var(--email-border);border-radius:8px;background:#fff;}',
      '.email-builder-iframe.selecting{border-color:var(--email-accent);box-shadow:0 0 0 3px rgba(129,140,248,.18);}',
      '.email-builder-select-surface{display:none;width:100%;height:min(760px,72vh);min-height:560px;border:1px solid var(--email-accent);border-radius:8px;background:#fff;overflow:auto;box-shadow:0 0 0 3px rgba(129,140,248,.18);}',
      '.email-builder-preview-frame.selecting .email-builder-select-surface,.email-builder-preview-frame.manual-editing .email-builder-select-surface{display:block;}',
      '.email-builder-visual-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.email-builder-ai-working{display:flex;align-items:flex-start;gap:10px;border:1px solid rgba(96,165,250,.34);border-radius:10px;background:rgba(96,165,250,.12);color:var(--email-text);padding:10px 11px;margin:10px 0;font-size:13px;line-height:1.45;}',
      '.email-builder-ai-spinner{width:16px;height:16px;border:2px solid rgba(96,165,250,.28);border-top-color:var(--email-info);border-radius:50%;margin-top:1px;flex:0 0 auto;animation:email-builder-spin .8s linear infinite;}',
      '.email-builder-ai-working-title{font-weight:750;color:var(--email-text);}',
      '.email-builder-ai-working-detail{color:var(--email-muted);font-size:12px;}',
      '@keyframes email-builder-spin{to{transform:rotate(360deg)}}',
      '.email-builder-selection-list{display:grid;gap:8px;margin-top:10px;}',
      '.email-builder-selection-card{border:1px solid var(--email-border);border-radius:8px;background:var(--email-surface-subtle);padding:9px;}',
      '.email-builder-selection-card textarea{width:100%;min-height:72px;margin-top:8px;border:1px solid var(--email-border-strong);border-radius:8px;background:rgba(255,255,255,.045);color:var(--email-text);font:inherit;font-size:13px;line-height:1.4;padding:8px;resize:vertical;}',
      '.email-builder-selection-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--email-muted);font-size:12px;}',
      '.email-builder-selection-text{margin-top:6px;color:var(--email-text);font-size:12px;line-height:1.45;max-height:54px;overflow:hidden;}',
      '.email-builder-selection-actions{display:flex;justify-content:flex-end;margin-top:7px;}',
      '.email-builder-visual-chat{position:fixed;left:0;top:56px;bottom:0;width:340px;z-index:600;display:flex;flex-direction:column;background:rgba(15,17,23,.98);border-right:1px solid var(--email-border-strong);box-shadow:18px 0 42px rgba(0,0,0,.35);transform:translateX(-102%);transition:transform .18s ease;color:var(--email-text);}',
      '.email-builder-visual-chat.open{transform:translateX(0);}',
      '.email-builder-visual-chat-head{padding:10px 12px;border-bottom:1px solid var(--email-border);display:flex;align-items:center;justify-content:space-between;gap:10px;}',
      '.email-builder-visual-chat-title{margin:0;font-size:14px;font-weight:750;color:var(--email-text);}',
      '.email-builder-visual-chat-subtitle{margin:2px 0 0;font-size:11px;line-height:1.35;color:var(--email-muted);}',
      '.email-builder-visual-chat-body{padding:10px;display:grid;gap:8px;overflow:auto;flex:1;align-content:start;grid-auto-rows:max-content;}',
      '.email-builder-visual-chat-empty{border:1px dashed var(--email-border-strong);border-radius:8px;padding:10px;color:var(--email-muted);font-size:12px;line-height:1.4;}',
      '.email-builder-visual-message{border:1px solid var(--email-border);border-radius:8px;background:var(--email-surface);padding:8px;display:grid;gap:7px;align-self:start;}',
      '.email-builder-visual-message-textarea{width:100%;height:36px;min-height:36px;max-height:140px;overflow:hidden;border:1px solid var(--email-border-strong);border-radius:8px;background:rgba(255,255,255,.04);color:var(--email-text);font:inherit;font-size:13px;line-height:1.4;padding:8px;resize:none;}',
      '.email-builder-visual-message-textarea:focus{outline:none;border-color:var(--email-accent);box-shadow:0 0 0 3px rgba(129,140,248,.14);}',
      '.email-builder-visual-attachment{border:1px solid var(--email-border-strong);border-radius:8px;background:rgba(129,140,248,.08);padding:7px;display:grid;gap:4px;}',
      '.email-builder-visual-attachment-title{font-size:12px;font-weight:750;color:var(--email-text);}',
      '.email-builder-visual-attachment-line{font-size:11px;line-height:1.4;color:var(--email-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.email-builder-visual-technical{margin-top:2px;}',
      '.email-builder-visual-technical summary{cursor:pointer;color:var(--email-muted);font-size:11px;font-weight:650;}',
      '.email-builder-visual-technical[open] summary{margin-bottom:4px;}',
      '.email-builder-visual-chat-actions{padding:10px;border-top:1px solid var(--email-border);display:flex;gap:8px;justify-content:flex-end;background:var(--email-surface-subtle);}',
      '.email-builder-icon-button{width:30px;height:30px;border:1px solid var(--email-border-strong);border-radius:8px;background:transparent;color:var(--email-muted);cursor:pointer;font-size:16px;line-height:1;}',
      '.email-builder-modal-backdrop{position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.52);display:none;align-items:center;justify-content:center;padding:20px;}',
      '.email-builder-modal-backdrop.open{display:flex;}',
      '.email-builder-modal{width:min(560px,100%);border:1px solid var(--email-border-strong);border-radius:12px;background:var(--email-bg);box-shadow:0 24px 80px rgba(0,0,0,.48);overflow:hidden;color:var(--email-text);}',
      '.email-builder-modal-head{padding:14px 16px;border-bottom:1px solid var(--email-border);}',
      '.email-builder-modal-title{font-size:15px;font-weight:760;margin:0;color:var(--email-text);}',
      '.email-builder-modal-body{padding:14px;display:grid;gap:10px;}',
      '.email-builder-modal textarea{width:100%;min-height:48px;max-height:180px;overflow:hidden;border:1px solid var(--email-border-strong);border-radius:8px;background:rgba(255,255,255,.045);color:var(--email-text);font:inherit;font-size:13px;line-height:1.45;padding:10px;resize:none;}',
      '.email-builder-modal-actions{padding:12px 16px;border-top:1px solid var(--email-border);display:flex;justify-content:flex-end;gap:8px;background:var(--email-surface-subtle);}',
      '.email-builder-code{width:100%;min-height:170px;border:1px solid rgba(0,0,0,.22);border-radius:8px;background:#080b12;color:#e5e7eb;padding:10px;font-size:12px;line-height:1.45;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;white-space:pre;overflow:auto;}',
      '.email-builder-small{font-size:12px;color:var(--email-muted);line-height:1.45;}',
      '@media (prefers-color-scheme: light){.email-builder-root{--email-bg:#f5f5f7;--email-surface:rgba(255,255,255,.78);--email-surface-strong:rgba(255,255,255,.95);--email-surface-subtle:rgba(255,255,255,.52);--email-border:rgba(15,23,42,.09);--email-border-strong:rgba(15,23,42,.16);--email-text:rgba(15,23,42,.9);--email-muted:rgba(15,23,42,.62);--email-faint:rgba(15,23,42,.42);--email-shadow:0 8px 32px rgba(15,23,42,.08);}}',
      '@media (max-width: 980px){.email-builder-start{grid-template-columns:1fr}.email-builder-grid{grid-template-columns:1fr}.email-builder-visual-chat{top:48px;width:min(340px,92vw)}}',
      '@media (max-width: 860px){.email-builder-root{padding:12px}.email-builder-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.email-builder-row{grid-template-columns:1fr}.email-builder-header{flex-direction:column}.email-builder-status{text-align:left;align-items:flex-start;min-width:0}.email-builder-status-path{max-width:100%}}',
    ].join('');
    document.head.appendChild(style);
  }

  function defaultAudienceText(draft) {
    var source = draft.audience || draft.audienceRows || draft.sampleAudience;
    if (source) return JSON.stringify(source, null, 2);
    if (draft.audienceArtifactPath || draft.audienceArtifactFileId || draft.audienceArtifactRef) {
      var variables = extractVariables(draft.subjectTemplate, draft.textTemplate, draft.htmlTemplate);
      return JSON.stringify([syntheticAudienceRow(variables, draft.sampleVariables)], null, 2);
    }
    return JSON.stringify([
      {
        email: 'customer@example.com',
        first_name: 'Avery',
        company: 'Northstar',
      },
    ], null, 2);
  }

  function buildInitialState(data) {
    var draft = normalizeDraftInput(isRecord(data && data.draft) ? data.draft : {});
    var campaignDraftRef = normalizeArtifactRef(draft.campaignDraftArtifactRef, 'json');
    var htmlArtifactPath = firstString([draft.htmlArtifactPath, draft.html_template_artifact_path], '');
    var htmlArtifactSha256 = firstString([draft.htmlArtifactSha256, draft.html_template_artifact_sha256], '');
    return {
      threadId: firstString([data && data.thread_id, data && data.threadId, draft.threadId], ''),
      workspaceId: firstString([data && data.workspace_id, data && data.workspaceId, draft.workspaceId], ''),
      projectId: firstString([data && data.project_id, data && data.projectId, draft.projectId], ''),
      organizationId: firstString([data && data.organization_id, data && data.organizationId, draft.organizationId], ''),
      name: firstString([draft.name], 'Welcome email template'),
      templateKey: firstString([draft.templateKey, draft.template_key], ''),
      templateName: firstString([draft.templateName, draft.template_name], ''),
      fromEmail: firstString([draft.fromEmail, draft.from_email], ''),
      sendingIdentityId: firstString([draft.sendingIdentityId, draft.sending_identity_id], ''),
      subjectTemplate: firstString([draft.subjectTemplate, draft.subject_template], 'Hi {{first_name}}, quick note from TribeX'),
      textTemplate: firstString([draft.textTemplate, draft.text_template], 'Hi {{first_name}},\n\nThanks for taking a look. We can help {{company}} move faster with a deterministic AI workflow.\n\nBest,\nTribeX'),
      htmlTemplate: firstString([draft.htmlTemplate, draft.html_template], '<p>Hi {{first_name}},</p>\n<p>Thanks for taking a look. We can help {{company}} move faster with a deterministic AI workflow.</p>\n<p>Best,<br/>TribeX</p>'),
      htmlArtifactPath: htmlArtifactPath,
      htmlArtifactFileId: firstString([draft.htmlArtifactFileId, draft.html_template_artifact_file_id], ''),
      htmlArtifactSha256: htmlArtifactSha256,
      audienceText: defaultAudienceText(draft),
      audienceArtifactPath: firstString([draft.audienceArtifactPath, draft.audience_artifact_path], ''),
      audienceArtifactFileId: firstString([draft.audienceArtifactFileId, draft.audience_artifact_file_id], ''),
      audienceArtifactFormat: firstString([draft.audienceArtifactFormat, draft.audience_artifact_format], 'json'),
      audienceArtifactSha256: firstString([draft.audienceArtifactSha256, draft.audience_artifact_sha256], ''),
      artifactSearchQuery: firstString([data && data.artifactSearchQuery, data && data.artifact_search_query], 'email/'),
      artifactResults: [],
      artifactSearchStatus: 'Search durable workspace files under email/.',
      orgOptions: [],
      workspaceOptions: [],
      templateArtifacts: [],
      selectedTemplateKey: '',
      templateLoadedForKey: '',
      contextStatus: 'Finding organizations and workspace context.',
      templateStatus: 'Select an organization to load saved templates.',
      testTo: firstString([draft.testTo, draft.test_to], ''),
      decidrProjectId: firstString([draft.decidrProjectId, draft.decidr_project_id], ''),
      decidrDecisionIds: Array.isArray(draft.decidrDecisionIds)
        ? draft.decidrDecisionIds.join(', ')
        : firstString([draft.decidrDecisionIds, draft.decidr_decision_ids], ''),
      lastArtifact: campaignDraftRef
        ? {
            workspacePath: campaignDraftRef.workspacePath,
            workspaceFileId: campaignDraftRef.workspaceFileId,
            sha256: campaignDraftRef.sha256,
          }
        : null,
      dirty: !campaignDraftRef,
      busy: false,
      status: campaignDraftRef ? 'Campaign draft artifact loaded' : '',
      promptText: '',
      visualSelectMode: false,
      visualSelections: [],
      visualChatOpen: false,
      visualEditInFlight: false,
      manualEditMode: false,
      manualEditDirty: false,
      pendingVisualSelection: null,
      pendingVisualComment: '',
      visualEditStatus: htmlArtifactPath || draft.htmlTemplate || draft.html_template
        ? 'Enable AI edit mode, then choose rendered blocks to add comments.'
        : 'Load a saved HTML artifact to use visual edits.',
    };
  }

  window.__renderers.email_template_builder = function(container, data) {
    injectStyles();
    var state = buildInitialState(data || {});
    container.innerHTML = [
      '<div class="email-builder-root">',
      '  <aside class="email-builder-visual-chat" data-role="visual-chat"></aside>',
      '  <div class="email-builder-shell">',
      '    <header class="email-builder-header">',
      '      <div>',
      '        <h1 class="email-builder-title">Email template builder</h1>',
      '        <p class="email-builder-subtitle">Create and preview reusable HTML email templates. Plain text is generated from HTML automatically.</p>',
      '      </div>',
      '      <div class="email-builder-status" data-role="status"></div>',
      '    </header>',
      '    <section class="email-builder-start" aria-label="Campaign builder start">',
      '      <div class="email-builder-step">',
      '        <div class="email-builder-step-head">',
      '          <span class="email-builder-step-number">1</span>',
      '          <div>',
      '            <p class="email-builder-step-title">Select org</p>',
      '            <div class="email-builder-small" data-role="context-status"></div>',
      '          </div>',
      '        </div>',
      selectShell('organizationId', 'Organization'),
      selectShell('workspaceId', 'Workspace'),
      '      </div>',
      '      <div class="email-builder-step">',
      '        <div class="email-builder-step-head">',
      '          <span class="email-builder-step-number">2</span>',
      '          <div>',
      '            <p class="email-builder-step-title">Select template</p>',
      '            <div class="email-builder-small" data-role="template-status"></div>',
      '          </div>',
      '        </div>',
      selectShell('templateArtifact', 'Saved template or campaign draft'),
      '        <div class="email-builder-step-actions">',
      '          <button class="email-builder-button primary" data-action="load-selected-template">Load selected</button>',
      '          <button class="email-builder-button" data-action="refresh-templates">Refresh</button>',
      '        </div>',
      '      </div>',
      '      <div class="email-builder-step">',
      '        <div class="email-builder-step-head">',
      '          <span class="email-builder-step-number">3</span>',
      '          <div>',
      '            <p class="email-builder-step-title">Create new</p>',
      '            <div class="email-builder-small">Start a new campaign draft in the selected workspace.</div>',
      '          </div>',
      '        </div>',
      '        <button class="email-builder-button primary" data-action="create-new-template">Create new</button>',
      '      </div>',
      '    </section>',
      '    <div class="email-builder-grid">',
      '      <section class="email-builder-panel">',
      '        <div class="email-builder-panel-header"><p class="email-builder-panel-title">Template</p></div>',
      '        <div class="email-builder-panel-body">',
      '          <div class="email-builder-row">',
      fieldHtml('name', 'Template name', state.name, 'input'),
      fieldHtml('templateKey', 'Template key', state.templateKey, 'input'),
      '          </div>',
      fieldHtml('subjectTemplate', 'Subject template', state.subjectTemplate, 'textarea'),
      fieldHtml('htmlTemplate', 'HTML template', state.htmlTemplate, 'textarea html-source'),
      '          <details class="email-builder-advanced">',
      '            <summary>Advanced details</summary>',
      '            <div class="email-builder-row">',
      fieldHtml('fromEmail', 'From email', state.fromEmail, 'input'),
      fieldHtml('sendingIdentityId', 'Sending identity ID', state.sendingIdentityId, 'input'),
      '            </div>',
      '            <div class="email-builder-row">',
      fieldHtml('htmlArtifactPath', 'HTML artifact path', state.htmlArtifactPath, 'input'),
      fieldHtml('htmlArtifactFileId', 'HTML artifact file ID', state.htmlArtifactFileId, 'input'),
      '            </div>',
      fieldHtml('htmlArtifactSha256', 'HTML artifact sha256', state.htmlArtifactSha256, 'input'),
      '            <div class="email-builder-artifacts">',
      '            <div class="email-builder-artifact-head">',
      '              <div>',
      '                <p class="email-builder-artifact-title">Workspace artifacts</p>',
      '                <div class="email-builder-small">Search durable storage by path, then load HTML, campaign drafts, or audience artifacts.</div>',
      '              </div>',
      '            </div>',
      '            <div class="email-builder-artifact-search">',
      fieldHtml('artifactSearchQuery', 'Artifact path search', state.artifactSearchQuery, 'input'),
      '              <button class="email-builder-button" data-action="search-artifacts">Search</button>',
      '            </div>',
      '            <div class="email-builder-artifact-results" data-role="artifact-results"></div>',
      '            </div>',
      '            <div class="email-builder-row">',
      fieldHtml('threadId', 'TribeX thread ID', state.threadId, 'input'),
      fieldHtml('workspaceId', 'Workspace ID', state.workspaceId, 'input'),
      '            </div>',
      '            <div class="email-builder-row">',
      fieldHtml('organizationId', 'Organization ID', state.organizationId, 'input'),
      fieldHtml('projectId', 'Project ID', state.projectId, 'input'),
      '            </div>',
      '            <div class="email-builder-row">',
      fieldHtml('testTo', 'Test recipient', state.testTo, 'input'),
      fieldHtml('decidrProjectId', 'DecidR project ID', state.decidrProjectId, 'input'),
      '            </div>',
      fieldHtml('decidrDecisionIds', 'DecidR decision IDs', state.decidrDecisionIds, 'input'),
      fieldHtml('audienceText', 'Sample audience JSON', state.audienceText, 'textarea large'),
      '            <div class="email-builder-row">',
      fieldHtml('audienceArtifactPath', 'Audience artifact path', state.audienceArtifactPath, 'input'),
      fieldHtml('audienceArtifactFileId', 'Audience artifact file ID', state.audienceArtifactFileId, 'input'),
      '            </div>',
      '            <div class="email-builder-row">',
      fieldHtml('audienceArtifactFormat', 'Audience artifact format', state.audienceArtifactFormat, 'input'),
      fieldHtml('audienceArtifactSha256', 'Audience artifact sha256', state.audienceArtifactSha256, 'input'),
      '            </div>',
      '          </details>',
      '        </div>',
      '        <div class="email-builder-actions">',
      '          <button class="email-builder-button primary" data-action="save-artifact">Save template</button>',
      '        </div>',
      '      </section>',
      '      <section class="email-builder-computed">',
      '        <div class="email-builder-strip" data-role="validation"></div>',
      '        <div class="email-builder-strip">',
      '          <h3>Variables</h3>',
      '          <div class="email-builder-chip-row" data-role="variables"></div>',
      '        </div>',
      '        <div class="email-builder-strip">',
      '          <h3>Preview</h3>',
      '          <div class="email-builder-preview-title">Subject</div>',
      '          <div class="email-builder-preview-box" data-role="preview-subject"></div>',
      '          <div class="email-builder-preview-title">Plain text preview</div>',
      '          <div class="email-builder-preview-box" data-role="preview-text"></div>',
      '          <div class="email-builder-preview-head">',
      '            <div class="email-builder-preview-title">HTML</div>',
      '            <div class="email-builder-visual-tools">',
      '              <button class="email-builder-button" data-action="toggle-visual-select" data-role="toggle-visual-select" aria-pressed="false">AI edit mode</button>',
      '              <button class="email-builder-button" data-action="toggle-manual-edit" data-role="toggle-manual-edit" aria-pressed="false">Manual edit mode</button>',
      '              <button class="email-builder-button primary" data-action="save-manual-edits" data-role="save-manual-edits" disabled>Save manual edits</button>',
      '              <button class="email-builder-button" data-action="refresh-html-artifact">Refresh artifact</button>',
      '              <button class="email-builder-button primary" data-action="submit-visual-edits">Submit edits</button>',
      '            </div>',
      '          </div>',
      '          <div class="email-builder-preview-frame">',
      '            <iframe class="email-builder-iframe" sandbox="allow-same-origin" data-role="preview-html"></iframe>',
      '            <div class="email-builder-select-surface" data-role="select-surface"></div>',
      '          </div>',
      '          <div class="email-builder-selection-list" data-role="visual-selections"></div>',
      '        </div>',
      '      </section>',
      '    </div>',
      '  </div>',
      '  <div class="email-builder-modal-backdrop" data-role="visual-comment-modal"></div>',
      '</div>',
    ].join('');

    function fieldHtml(name, label, value, kind) {
      var classes = String(kind).indexOf('large') >= 0 ? ' class="large"' : '';
      var textarea = String(kind).indexOf('textarea') >= 0;
      return [
        '<div class="email-builder-field">',
        '<label for="email-builder-' + esc(name) + '">' + esc(label) + '</label>',
        textarea
          ? '<textarea id="email-builder-' + esc(name) + '" data-field="' + esc(name) + '"' + classes + '>' + esc(value) + '</textarea>'
          : '<input id="email-builder-' + esc(name) + '" data-field="' + esc(name) + '" value="' + esc(value) + '"/>',
        '</div>',
      ].join('');
    }

    function selectShell(name, label) {
      return [
        '<div class="email-builder-field">',
        '<label for="email-builder-select-' + esc(name) + '">' + esc(label) + '</label>',
        '<select id="email-builder-select-' + esc(name) + '" data-select="' + esc(name) + '"></select>',
        '</div>',
      ].join('');
    }

    var statusEl = container.querySelector('[data-role="status"]');
    var contextStatusEl = container.querySelector('[data-role="context-status"]');
    var templateStatusEl = container.querySelector('[data-role="template-status"]');
    var validationEl = container.querySelector('[data-role="validation"]');
    var variablesEl = container.querySelector('[data-role="variables"]');
    var subjectEl = container.querySelector('[data-role="preview-subject"]');
    var textEl = container.querySelector('[data-role="preview-text"]');
    var htmlEl = container.querySelector('[data-role="preview-html"]');
    var rootEl = container.querySelector('.email-builder-root');
    var previewFrameEl = container.querySelector('.email-builder-preview-frame');
    var selectSurfaceEl = container.querySelector('[data-role="select-surface"]');
    var visualSelectionsEl = container.querySelector('[data-role="visual-selections"]');
    var visualChatEl = container.querySelector('[data-role="visual-chat"]');
    var visualCommentModalEl = container.querySelector('[data-role="visual-comment-modal"]');
    var promptEl = container.querySelector('[data-role="prompt"]');
    var metricVariablesEl = container.querySelector('[data-role="metric-variables"]');
    var metricAudienceEl = container.querySelector('[data-role="metric-audience"]');
    var metricStateEl = container.querySelector('[data-role="metric-state"]');
    var metricArtifactEl = container.querySelector('[data-role="metric-artifact"]');
    var artifactResultsEl = container.querySelector('[data-role="artifact-results"]');
    var organizationSelectEl = container.querySelector('[data-select="organizationId"]');
    var workspaceSelectEl = container.querySelector('[data-select="workspaceId"]');
    var templateSelectEl = container.querySelector('[data-select="templateArtifact"]');

    Array.prototype.slice.call(container.querySelectorAll('[data-field]')).forEach(function(input) {
      input.addEventListener('input', function() {
        var fieldName = input.getAttribute('data-field');
        state[fieldName] = input.value;
        state.dirty = true;
        if (fieldName === 'htmlTemplate' || fieldName === 'htmlArtifactPath' || fieldName === 'htmlArtifactSha256') {
          state.visualSelections = [];
          state.manualEditMode = false;
          state.manualEditDirty = false;
          state.visualEditStatus = 'Template changed. Select rendered blocks again before submitting visual edits.';
          renderVisualSurfaces();
        }
        if (fieldName === 'organizationId' || fieldName === 'workspaceId') {
          renderContextControls();
        }
        refreshComputed();
      });
    });

    Array.prototype.slice.call(container.querySelectorAll('[data-select]')).forEach(function(select) {
      select.addEventListener('change', function() {
        var name = select.getAttribute('data-select');
        if (name === 'organizationId') {
          state.organizationId = select.value;
          state.workspaceId = '';
          state.workspaceOptions = [];
          state.templateArtifacts = [];
          state.selectedTemplateKey = '';
          state.templateLoadedForKey = '';
          refreshFields(['organizationId', 'workspaceId']);
          renderContextControls();
          runAction(function() {
            return loadWorkspacesForSelectedOrg().then(loadTemplateChoices);
          });
          return;
        }
        if (name === 'workspaceId') {
          state.workspaceId = select.value;
          state.templateArtifacts = [];
          state.selectedTemplateKey = '';
          state.templateLoadedForKey = '';
          refreshField('workspaceId');
          renderContextControls();
          runAction(loadTemplateChoices);
          return;
        }
        if (name === 'templateArtifact') {
          state.selectedTemplateKey = select.value;
          renderContextControls();
        }
      });
    });

    if (templateSelectEl) {
      ['focus', 'pointerdown'].forEach(function(eventName) {
        templateSelectEl.addEventListener(eventName, function() {
          maybeRefreshTemplateChoices();
        });
      });
    }

    Array.prototype.slice.call(container.querySelectorAll('[data-action]')).forEach(function(button) {
      button.addEventListener('click', function() {
        var action = button.getAttribute('data-action');
        if (action === 'resolve-thread') runAction(resolveThread);
        if (action === 'search-artifacts') runAction(searchArtifacts);
        if (action === 'refresh-templates') runAction(loadTemplateChoices);
        if (action === 'load-selected-template') runAction(loadSelectedTemplate);
        if (action === 'create-new-template') createNewTemplate();
        if (action === 'save-artifact') runAction(saveArtifact);
        if (action === 'toggle-visual-select') toggleVisualSelect();
        if (action === 'toggle-manual-edit') toggleManualEditMode();
        if (action === 'save-manual-edits') saveManualPreviewEdits();
        if (action === 'refresh-html-artifact') runAction(refreshCurrentHtmlArtifactFromButton);
        if (action === 'submit-visual-edits') runAction(submitVisualEdits);
        if (action === 'toggle-visual-chat') toggleVisualSelect();
        if (action === 'build-prompt') buildPromptOnly();
        if (action === 'build-campaign-prompt') buildCampaignPromptOnly();
        if (action === 'send-test') runAction(sendTestThroughPersona);
        if (action === 'send-campaign') runAction(sendCampaignThroughPersona);
      });
    });

    artifactResultsEl.addEventListener('click', function(event) {
      var target = event.target && event.target.closest
        ? event.target.closest('[data-artifact-index]')
        : null;
      if (!target) return;
      var index = Number(target.getAttribute('data-artifact-index'));
      if (!Number.isFinite(index)) return;
      runAction(function() {
        return loadArtifact(state.artifactResults[index]);
      });
    });

    if (visualSelectionsEl) {
      visualSelectionsEl.addEventListener('input', function(event) {
        var target = event.target;
        if (!target || !target.matches || !target.matches('[data-selection-request]')) return;
        var id = target.getAttribute('data-selection-request');
        var selection = state.visualSelections.find(function(item) { return item.id === id; });
        if (selection) selection.changeRequest = target.value;
      });
      visualSelectionsEl.addEventListener('click', function(event) {
        var target = event.target && event.target.closest
          ? event.target.closest('[data-remove-selection]')
          : null;
        if (!target) return;
        var id = target.getAttribute('data-remove-selection');
        state.visualSelections = state.visualSelections.filter(function(item) {
          return item.id !== id;
        });
        renderVisualSurfaces();
      });
    }

    if (visualChatEl) {
      visualChatEl.addEventListener('click', function(event) {
        var actionTarget = event.target && event.target.closest
          ? event.target.closest('[data-action]')
          : null;
        if (!actionTarget) return;
        var action = actionTarget.getAttribute('data-action');
        if (action === 'close-visual-chat') disableVisualEditMode();
        if (action === 'remove-visual-message') {
          var id = actionTarget.getAttribute('data-selection-id');
          state.visualSelections = state.visualSelections.filter(function(item) { return item.id !== id; });
          renderVisualSurfaces();
        }
        if (action === 'submit-visual-edits') {
          runAction(submitVisualEdits);
        }
      });
      visualChatEl.addEventListener('input', function(event) {
        var target = event.target;
        if (!target || !target.matches || !target.matches('[data-visual-chat-request]')) return;
        var id = target.getAttribute('data-visual-chat-request');
        var selection = state.visualSelections.find(function(item) { return item.id === id; });
        if (selection) selection.changeRequest = target.value;
        autoGrowTextarea(target);
      });
    }

    if (visualCommentModalEl) {
      visualCommentModalEl.addEventListener('input', function(event) {
        var target = event.target;
        if (!target || !target.matches || !target.matches('[data-role="visual-comment-text"]')) return;
        state.pendingVisualComment = target.value;
        autoGrowTextarea(target);
      });
      visualCommentModalEl.addEventListener('click', function(event) {
        var actionTarget = event.target && event.target.closest
          ? event.target.closest('[data-action]')
          : null;
        if (!actionTarget) return;
        var action = actionTarget.getAttribute('data-action');
        if (action === 'cancel-visual-comment') closeVisualCommentModal();
        if (action === 'add-visual-comment') addPendingVisualComment();
      });
    }

    htmlEl.addEventListener('load', function() {
      attachPreviewSelectionHandlers();
    });

    var selectSurfaceRoot = null;
    if (selectSurfaceEl) {
      selectSurfaceRoot = selectSurfaceEl.shadowRoot || selectSurfaceEl.attachShadow({ mode: 'open' });
      selectSurfaceRoot.addEventListener('click', function(event) {
        if (state.manualEditMode) {
          var link = event.target && event.target.closest ? event.target.closest('a') : null;
          if (link) event.preventDefault();
          return;
        }
        if (!state.visualSelectMode || state.manualEditMode) return;
        event.preventDefault();
        event.stopPropagation();
        var target = event.target && event.target.nodeType === 1 ? event.target : null;
        if (!target || target === selectSurfaceRoot.host) return;
        while (target && target.nodeType === 1 && !visibleText(target) && String(target.outerHTML || '').length <= 24) {
          target = target.parentElement;
        }
        if (target) openVisualCommentModal(target, selectSurfaceEl);
      }, true);
      selectSurfaceRoot.addEventListener('mouseover', function(event) {
        if (!state.visualSelectMode || state.manualEditMode) return;
        var target = event.target && event.target.nodeType === 1 ? event.target : null;
        if (!target || target === selectSurfaceRoot.host) return;
        target.style.outline = '2px solid #818cf8';
        target.style.cursor = 'crosshair';
      }, true);
      selectSurfaceRoot.addEventListener('mouseout', function(event) {
        if (!state.visualSelectMode || state.manualEditMode) return;
        var target = event.target && event.target.nodeType === 1 ? event.target : null;
        if (!target || target === selectSurfaceRoot.host) return;
        target.style.outline = '';
        target.style.cursor = '';
      }, true);
      selectSurfaceRoot.addEventListener('input', function(event) {
        if (!state.manualEditMode) return;
        var target = event.target && event.target.nodeType === 1 ? event.target : null;
        if (!target || !target.matches || !target.matches('[data-manual-editable]')) return;
        state.manualEditDirty = true;
        state.status = 'Manual preview edits pending';
        renderStatus();
        renderVisualSurfaces();
      });
    }

    renderContextControls();
    renderArtifactResults();
    renderVisualSurfaces();
    refreshComputed();
    runAction(discoverContext);

    function runAction(actionFn) {
      Promise.resolve()
        .then(actionFn)
        .catch(showError);
    }

    function setBusy(value, message) {
      state.busy = !!value;
      if (message) state.status = message;
      Array.prototype.slice.call(container.querySelectorAll('button')).forEach(function(button) {
        button.disabled = state.busy;
      });
      renderStatus();
      renderContextControls();
    }

    function renderStatus() {
      var artifact = state.lastArtifact && state.lastArtifact.workspacePath
        ? state.lastArtifact.workspacePath
        : 'Not saved yet';
      var label = state.status || 'Draft artifact';
      var variant = state.busy ? ' busy' : (state.lastArtifact ? ' saved' : '');
      statusEl.innerHTML = [
        '<span class="email-builder-status-pill' + variant + '">' + esc(label) + '</span>',
        '<span class="email-builder-status-path">' + esc(artifact) + '</span>',
      ].join('');
      if (metricArtifactEl) metricArtifactEl.textContent = state.lastArtifact ? 'Saved' : 'Draft';
    }

    function showError(error) {
      state.status = error && error.message ? error.message : String(error);
      renderStatus();
      validationEl.className = 'email-builder-strip email-builder-error';
      validationEl.innerHTML = '<h3>Validation</h3><div class="email-builder-validation-line"><span class="email-builder-dot"></span><span>' + esc(state.status) + '</span></div>';
      if (metricStateEl) {
        metricStateEl.textContent = 'Blocked';
        metricStateEl.className = 'email-builder-stat-value blocked';
      }
    }

    function refreshField(name) {
      var input = container.querySelector('[data-field="' + name + '"]');
      if (input && input.value !== state[name]) input.value = state[name] || '';
    }

    function refreshFields(names) {
      names.forEach(refreshField);
    }

    function client() {
      return window.__tribexAiClient || null;
    }

    function renderContextControls() {
      if (contextStatusEl) {
        contextStatusEl.textContent = state.contextStatus || 'Select an organization.';
      }
      if (templateStatusEl) {
        templateStatusEl.textContent = state.templateStatus || 'Select a workspace to load saved templates.';
      }
      if (organizationSelectEl) {
        var orgOptions = state.orgOptions || [];
        var orgHtml = [optionHtml('', orgOptions.length ? 'Select organization' : 'Loading organizations...', !state.organizationId, false)];
        if (state.organizationId && !orgOptions.some(function(org) { return org.id === state.organizationId; })) {
          orgHtml.push(optionHtml(state.organizationId, state.organizationId + ' (current)', true, false));
        }
        orgOptions.forEach(function(org) {
          orgHtml.push(optionHtml(org.id, orgLabel(org), org.id === state.organizationId, false));
        });
        organizationSelectEl.innerHTML = orgHtml.join('');
        organizationSelectEl.disabled = state.busy;
      }
      if (workspaceSelectEl) {
        var workspaceOptions = state.workspaceOptions || [];
        var workspaceHtml = [optionHtml('', workspaceOptions.length ? 'Select workspace' : 'Workspace resolves after org selection', !state.workspaceId, false)];
        if (state.workspaceId && !workspaceOptions.some(function(workspace) { return workspace.id === state.workspaceId; })) {
          workspaceHtml.push(optionHtml(state.workspaceId, state.workspaceId + ' (current)', true, false));
        }
        workspaceOptions.forEach(function(workspace) {
          workspaceHtml.push(optionHtml(workspace.id, workspaceLabel(workspace), workspace.id === state.workspaceId, false));
        });
        workspaceSelectEl.innerHTML = workspaceHtml.join('');
        workspaceSelectEl.disabled = state.busy || (!state.organizationId && !state.workspaceId);
      }
      if (templateSelectEl) {
        var templateArtifacts = state.templateArtifacts || [];
        var templateHtml = [optionHtml('', templateArtifacts.length ? 'Select template or campaign draft' : 'No saved templates loaded', !state.selectedTemplateKey, false)];
        templateArtifacts.forEach(function(file) {
          var key = artifactKey(file);
          templateHtml.push(optionHtml(key, templateChoiceLabel(file), key === state.selectedTemplateKey, false));
        });
        templateSelectEl.innerHTML = templateHtml.join('');
        templateSelectEl.disabled = state.busy || !state.workspaceId || !templateArtifacts.length;
      }
    }

    function applyThreadContext(thread) {
      var detail = thread && thread.thread ? thread.thread : thread;
      state.workspaceId = firstString([
        detail && detail.workspaceId,
        detail && detail.workspace_id,
        detail && detail.project && detail.project.workspaceId,
      ], state.workspaceId);
      state.projectId = firstString([
        detail && detail.projectId,
        detail && detail.project_id,
        detail && detail.project && detail.project.id,
      ], state.projectId);
      state.organizationId = firstString([
        detail && detail.organizationId,
        detail && detail.organization_id,
        detail && detail.workspace && detail.workspace.organizationId,
      ], state.organizationId);
      refreshFields(['workspaceId', 'projectId', 'organizationId']);
      renderContextControls();
    }

    function discoverContext() {
      var api = client();
      if (!api) {
        state.contextStatus = 'TribeX AI client is unavailable. Open from an authenticated MCPViews AI session.';
        renderContextControls();
        return Promise.resolve();
      }
      setBusy(true, 'Finding organizations');
      var threadPromise = state.threadId.trim() && typeof api.fetchThread === 'function'
        ? api.fetchThread(state.threadId.trim()).then(function(thread) {
            applyThreadContext(thread);
            state.contextStatus = state.organizationId
              ? 'Thread context resolved.'
              : 'Thread resolved. Select an organization.';
          }).catch(function() {
            state.contextStatus = 'Could not resolve thread context. Select an organization.';
          })
        : Promise.resolve();
      return threadPromise
        .then(loadOrganizations)
        .then(loadWorkspacesForSelectedOrg)
        .then(loadTemplateChoices)
        .finally(function() {
          if (state.status === 'Finding organizations') {
            state.status = state.workspaceId
              ? 'Workspace context ready'
              : 'Select org and workspace';
          }
          setBusy(false);
          renderContextControls();
        });
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
      return api.fetchOrganizations().then(function(orgs) {
        state.orgOptions = Array.isArray(orgs) ? orgs : [];
        if (!state.organizationId && state.orgOptions.length === 1) {
          state.organizationId = state.orgOptions[0].id;
          refreshField('organizationId');
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
        renderContextControls();
      });
    }

    function loadWorkspacesForSelectedOrg() {
      var api = client();
      if (!state.organizationId) {
        state.workspaceOptions = [];
        state.templateArtifacts = [];
        state.templateStatus = 'Select an organization first.';
        renderContextControls();
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
        if (!current && state.workspaceOptions.length) {
          state.workspaceId = state.workspaceOptions[0].id;
          state.templateLoadedForKey = '';
          refreshField('workspaceId');
        } else if (!current && state.workspaceId && state.workspaceOptions.length) {
          state.workspaceId = '';
          state.templateLoadedForKey = '';
          refreshField('workspaceId');
        }
        if (state.workspaceId) {
          var selectedWorkspace = state.workspaceOptions.find(function(workspace) { return workspace.id === state.workspaceId; });
          state.contextStatus = selectedWorkspace
            ? 'Using ' + workspaceLabel(selectedWorkspace) + '.'
            : 'Using provided workspace.';
        } else {
          state.contextStatus = state.workspaceOptions.length
            ? 'Select a workspace.'
            : 'No workspaces found for this organization.';
          state.templateStatus = 'Select a workspace to load saved templates.';
        }
        renderContextControls();
      });
    }

    function templateSearchPrefixes() {
      return [
        'email/templates/',
        'email/campaigns/',
        'email/deliverability/templates/',
      ];
    }

    function templateArtifact(file) {
      if (!searchableArtifact(file)) return false;
      var kind = artifactKind(file);
      if (kind === 'html' || kind === 'campaign') return true;
      var path = filePath(file);
      return kind === 'json' && path.indexOf('/audiences/') < 0 && path.indexOf('.audience.') < 0;
    }

    function currentTemplateContextKey() {
      return [state.organizationId.trim(), state.workspaceId.trim()].join(':');
    }

    function maybeRefreshTemplateChoices() {
      if (state.busy || !state.workspaceId.trim()) return;
      var contextKey = currentTemplateContextKey();
      if (state.templateLoadedForKey === contextKey && state.templateArtifacts.length) return;
      runAction(loadTemplateChoices);
    }

    function loadTemplateChoices() {
      var api = client();
      if (!state.workspaceId) {
        state.templateArtifacts = [];
        state.selectedTemplateKey = '';
        state.templateLoadedForKey = '';
        state.templateStatus = state.organizationId
          ? 'Select a workspace to load saved templates.'
          : 'Select an organization to load saved templates.';
        renderContextControls();
        return Promise.resolve();
      }
      if (!api || typeof api.listWorkspaceFiles !== 'function') {
        state.templateLoadedForKey = '';
        state.templateStatus = 'Workspace file search is unavailable in this MCPViews session.';
        renderContextControls();
        return Promise.resolve();
      }
      state.templateStatus = 'Loading saved templates and campaign drafts.';
      renderContextControls();
      var allFiles = [];
      var seen = {};
      var prefixes = templateSearchPrefixes();
      return Promise.all(prefixes.map(function(prefix) {
        return api.listWorkspaceFiles(state.workspaceId.trim(), prefix).then(function(result) {
          (result && result.files || []).forEach(function(file) {
            var key = artifactKey(file);
            if (!key || seen[key]) return;
            seen[key] = true;
            allFiles.push(file);
          });
        }).catch(function() {
          return null;
        });
      })).then(function() {
        state.templateArtifacts = allFiles
          .filter(templateArtifact)
          .sort(function(left, right) {
            return filePath(left).localeCompare(filePath(right));
          })
          .slice(0, 75);
        if (state.selectedTemplateKey && !state.templateArtifacts.some(function(file) { return artifactKey(file) === state.selectedTemplateKey; })) {
          state.selectedTemplateKey = '';
        }
        if (!state.selectedTemplateKey && state.templateArtifacts.length === 1) {
          state.selectedTemplateKey = artifactKey(state.templateArtifacts[0]);
        }
        state.templateStatus = state.templateArtifacts.length
          ? 'Found ' + state.templateArtifacts.length + ' saved template' + (state.templateArtifacts.length === 1 ? '' : 's') + ' or campaign draft' + (state.templateArtifacts.length === 1 ? '' : 's') + '.'
          : 'No saved email templates found. Create new to start a draft.';
        state.templateLoadedForKey = currentTemplateContextKey();
        renderContextControls();
      });
    }

    function selectedWorkspaceContext() {
      var selected = (state.workspaceOptions || []).find(function(workspace) {
        return workspace.id === state.workspaceId;
      });
      return selected || compactObject({
        id: state.workspaceId,
        organizationId: state.organizationId,
        name: 'Email workspace',
      });
    }

    function ensureVisualEditorProject() {
      var api = client();
      if (state.projectId.trim()) {
        return Promise.resolve({
          id: state.projectId.trim(),
          workspaceId: state.workspaceId.trim(),
          organizationId: state.organizationId.trim(),
        });
      }
      if (!state.workspaceId.trim()) {
        throw new Error('Select a workspace before submitting visual edits.');
      }
      if (!api || typeof api.fetchProjects !== 'function') {
        throw new Error('Project lookup is unavailable; open the builder from a TribeX thread or select a project in advanced details.');
      }
      var workspace = selectedWorkspaceContext();
      return api.fetchProjects(workspace).then(function(projects) {
        var list = Array.isArray(projects) ? projects : [];
        var preferred = list.find(function(project) {
          var label = String(project.name || project.title || '').toLowerCase();
          return label.indexOf('email') >= 0 || label.indexOf('campaign') >= 0;
        }) || list[0];
        if (preferred && preferred.id) return preferred;
        if (typeof api.createProject !== 'function') {
          throw new Error('No project exists in this workspace for the visual editor thread.');
        }
        return api.createProject(workspace, 'Email Template Visual Edits');
      }).then(function(project) {
        if (!project || !project.id) throw new Error('Could not resolve a project for the visual editor thread.');
        state.projectId = project.id;
        refreshField('projectId');
        return project;
      });
    }

    function ensureVisualEditorThread() {
      var api = client();
      if (!api || typeof api.sendMessage !== 'function') {
        throw new Error('TribeX AI persona messaging is unavailable in this MCPViews session.');
      }
      if (state.threadId.trim()) return Promise.resolve(state.threadId.trim());
      if (typeof api.createThread !== 'function') {
        throw new Error('Thread creation is unavailable; open the builder from an authenticated TribeX AI thread.');
      }
      state.visualEditStatus = 'Creating an email-template-visual-editor thread for this workspace.';
      renderVisualSurfaces();
      return ensureVisualEditorProject().then(function(project) {
        return api.createThread(
          project.id,
          'Email template visual edits',
          'email-template-visual-editor',
        );
      }).then(function(thread) {
        var threadId = firstString([thread && thread.id, thread && thread.threadId, thread && thread.thread_id], '');
        if (!threadId) throw new Error('Visual editor thread was created without an id.');
        state.threadId = threadId;
        state.visualEditStatus = 'Visual editor thread ready. Submitting the selected edit batch.';
        refreshField('threadId');
        renderVisualSurfaces();
        return threadId;
      });
    }

    function configureVisualEditorRuntime(threadId) {
      var api = client();
      var workspaceId = state.workspaceId.trim();
      if (
        !threadId ||
        !workspaceId ||
        !api ||
        typeof api.configureThreadRuntime !== 'function'
      ) {
        return Promise.resolve(threadId);
      }
      return Promise.resolve(api.configureThreadRuntime(threadId, {
        runtimeSessionBody: {
          deviceKey: 'mcpviews-' + workspaceId,
          label: 'MCPViews Email Builder',
          platform: 'tauri-desktop',
          purpose: 'email-template-visual-editor',
          metadata: {
            client: 'mcpviews-email-deliverability-plugin',
            source: 'visual-edit-submit',
            workspacePath: state.htmlArtifactPath || null,
          },
        },
      })).then(function() {
        return threadId;
      });
    }

    function htmlTemplateBytes() {
      var text = String(state.htmlTemplate || '');
      if (window.TextEncoder) return new TextEncoder().encode(text);
      var bytes = new Uint8Array(text.length);
      for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
      return bytes;
    }

    function ensureHtmlTemplateArtifactForVisualEdit() {
      if (state.htmlArtifactFileId.trim() && state.htmlArtifactSha256.trim()) {
        return Promise.resolve();
      }
      if (!state.workspaceId.trim()) {
        throw new Error('Select a workspace before submitting visual edits.');
      }
      if (
        !window.__tribexAiClient ||
        typeof window.__tribexAiClient.initWorkspaceFileUpload !== 'function' ||
        typeof window.__tribexAiClient.uploadWorkspaceFileToSignedUrl !== 'function'
      ) {
        throw new Error('TribeX AI workspace upload APIs are unavailable in this MCPViews session.');
      }
      validateState(state);
      var path = state.htmlArtifactPath.trim();
      if (!path || !/\.html?$/i.test(path)) {
        path = 'email/templates/' + slugify(state.name || state.templateName || 'email-template') + '-' + timestampId() + '.html';
      }
      var bytes = htmlTemplateBytes();
      var blob = new Blob([bytes], { type: 'text/html' });
      state.visualEditStatus = 'Saving the current HTML as a durable template artifact before submitting visual edits.';
      renderVisualSurfaces();
      return sha256Hex(bytes, '').then(function(hash) {
        return window.__tribexAiClient.initWorkspaceFileUpload(state.workspaceId.trim(), {
          relativePath: path,
          contentType: 'text/html',
          sizeBytes: blob.size,
          source: 'mcpviews-email-template-builder',
          metadata: {
            templateName: state.name || state.templateName,
            sha256: hash || undefined,
          },
        }).then(function(init) {
          return window.__tribexAiClient.uploadWorkspaceFileToSignedUrl(init && init.upload, blob)
            .then(function() {
              var file = init && init.file ? init.file : {};
              var sha = hash || fileChecksum(file);
              state.htmlArtifactPath = filePath(file) || path;
              state.htmlArtifactFileId = firstString([file.id, file.workspaceFileId], state.htmlArtifactFileId);
              state.htmlArtifactSha256 = sha || state.htmlArtifactSha256;
              state.visualSelections = (state.visualSelections || []).map(function(selection) {
                return Object.assign({}, selection, {
                  workspacePath: state.htmlArtifactPath,
                  workspaceFileId: state.htmlArtifactFileId,
                  sha256: state.htmlArtifactSha256,
                });
              });
              refreshFields(['htmlArtifactPath', 'htmlArtifactFileId', 'htmlArtifactSha256']);
              state.visualEditStatus = 'Durable HTML artifact saved. Submitting visual edit batch.';
              renderVisualSurfaces();
            });
        });
      });
    }

    function loadSelectedTemplate() {
      var selected = (state.templateArtifacts || []).find(function(file) {
        return artifactKey(file) === state.selectedTemplateKey;
      });
      if (!selected) {
        throw new Error('Select a saved template or campaign draft first.');
      }
      return loadArtifact(selected);
    }

    function createNewTemplate() {
      state.name = 'New email campaign';
      state.templateKey = '';
      state.templateName = '';
      state.subjectTemplate = 'Hi {{first_name}}, quick note from TribeX';
      state.htmlTemplate = '<p>Hi {{first_name}},</p>\n<p>Thanks for taking a look. We can help {{company}} move faster with a deterministic AI workflow.</p>\n<p>Best,<br/>TribeX</p>';
      syncTextTemplate(state);
      state.htmlArtifactPath = '';
      state.htmlArtifactFileId = '';
      state.htmlArtifactSha256 = '';
      state.audienceText = JSON.stringify([
        {
          email: 'customer@example.com',
          first_name: 'Avery',
          company: 'Northstar',
        },
      ], null, 2);
      state.audienceArtifactPath = '';
      state.audienceArtifactFileId = '';
      state.audienceArtifactFormat = 'json';
      state.audienceArtifactSha256 = '';
      state.lastArtifact = null;
      state.promptText = '';
      state.status = state.workspaceId ? 'New template ready in selected workspace' : 'New template ready; select a workspace before saving';
      state.dirty = true;
      refreshFields([
        'name',
        'templateKey',
        'templateName',
        'subjectTemplate',
        'textTemplate',
        'htmlTemplate',
        'htmlArtifactPath',
        'htmlArtifactFileId',
        'htmlArtifactSha256',
        'audienceText',
        'audienceArtifactPath',
        'audienceArtifactFileId',
        'audienceArtifactFormat',
        'audienceArtifactSha256',
      ]);
      renderContextControls();
      refreshComputed();
    }

    function renderArtifactResults() {
      if (!artifactResultsEl) return;
      var files = state.artifactResults || [];
      if (!files.length) {
        artifactResultsEl.innerHTML = '<div class="email-builder-artifact-empty">' + esc(state.artifactSearchStatus || 'No artifacts loaded yet.') + '</div>';
        return;
      }
      artifactResultsEl.innerHTML = files.map(function(file, index) {
        var kind = artifactKind(file);
        var path = filePath(file);
        var updated = firstString([file.updatedAt, file.lastModifiedAt, file.lastSyncedAt, file.uploadedAt], '');
        var meta = [
          artifactKindLabel(kind),
          formatBytes(file.sizeBytes),
          fileChecksum(file) ? 'sha256 ' + fileChecksum(file).slice(0, 10) : '',
          updated ? 'updated ' + updated : '',
        ].filter(Boolean).join(' · ');
        return [
          '<div class="email-builder-artifact-row">',
          '  <div>',
          '    <div class="email-builder-artifact-path">' + esc(path) + '</div>',
          '    <div class="email-builder-artifact-meta">' + esc(meta) + '</div>',
          '  </div>',
          '  <button class="email-builder-button" data-artifact-index="' + esc(index) + '">Load</button>',
          '</div>',
        ].join('');
      }).join('');
    }

    function renderVisualSurfaces() {
      var selectToggle = container.querySelector('[data-role="toggle-visual-select"]');
      if (selectToggle) {
        selectToggle.classList.toggle('active', state.visualSelectMode);
        selectToggle.setAttribute('aria-pressed', state.visualSelectMode ? 'true' : 'false');
        selectToggle.textContent = state.visualSelectMode ? 'Disable edit mode' : 'AI edit mode';
        selectToggle.title = state.visualSelectMode
          ? 'Disable AI edit mode and close the visual edit chat.'
          : 'Turn on AI edit mode for block selection and persona-assisted edits.';
      }
      var manualToggle = container.querySelector('[data-role="toggle-manual-edit"]');
      if (manualToggle) {
        manualToggle.classList.toggle('active', state.manualEditMode);
        manualToggle.setAttribute('aria-pressed', state.manualEditMode ? 'true' : 'false');
        manualToggle.textContent = state.manualEditMode ? 'Exit manual mode' : 'Manual edit mode';
        manualToggle.title = state.manualEditMode
          ? 'Exit manual text editing without applying additional preview changes.'
          : 'Edit template text directly in the rendered preview.';
      }
      var manualSave = container.querySelector('[data-role="save-manual-edits"]');
      if (manualSave) {
        manualSave.disabled = state.busy || !state.manualEditMode || !state.manualEditDirty;
      }
      renderVisualSelections();
      renderVisualChat();
      renderVisualCommentModal();
    }

    function visualAttachmentLines(selection) {
      return [
        'path ' + (selection.workspacePath || 'unknown'),
        'selector ' + (selection.domPath || selection.selector || 'unknown'),
        'hash ' + (selection.snippetHash || 'unknown'),
        'sha ' + String(selection.sha256 || '').slice(0, 12),
      ];
    }

    function compactVisualAttachmentTitle(selection) {
      var tag = String(selection && selection.tagName ? selection.tagName : 'block').toLowerCase();
      var hash = selection && selection.snippetHash ? String(selection.snippetHash).slice(0, 8) : '';
      return hash ? 'Selection attached · ' + tag + ' · ' + hash : 'Selection attached · ' + tag;
    }

    function autoGrowTextarea(textarea) {
      if (!textarea) return;
      var minHeight = Number(textarea.getAttribute('data-min-height') || 36);
      var maxHeight = Number(textarea.getAttribute('data-max-height') || 140);
      textarea.style.height = minHeight + 'px';
      var nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
      textarea.style.height = nextHeight + 'px';
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }

    function resizeVisualTextareas(root) {
      if (!root || !root.querySelectorAll) return;
      Array.prototype.slice.call(root.querySelectorAll('[data-auto-grow]')).forEach(autoGrowTextarea);
    }

    function renderVisualChat() {
      if (!visualChatEl) return;
      var selections = state.visualSelections || [];
      visualChatEl.classList.toggle('open', state.visualSelectMode);
      visualChatEl.innerHTML = [
        '<div class="email-builder-visual-chat-head">',
        '  <div>',
        '    <p class="email-builder-visual-chat-title">Visual edit chat</p>',
        '    <p class="email-builder-visual-chat-subtitle">Each comment carries a DOM metadata attachment. Submit once when the batch is ready.</p>',
        '  </div>',
        '</div>',
        '<div class="email-builder-visual-chat-body">',
        selections.length
          ? selections.map(function(selection, index) {
              return [
                '<div class="email-builder-visual-message">',
                '  <div class="email-builder-selection-meta">',
                '    <span>Comment ' + esc(index + 1) + ' · ' + esc(selection.tagName || 'block') + '</span>',
                '    <button class="email-builder-button" data-action="remove-visual-message" data-selection-id="' + esc(selection.id) + '">Remove</button>',
                '  </div>',
                '  <textarea class="email-builder-visual-message-textarea" rows="1" data-auto-grow data-min-height="36" data-max-height="140" data-visual-chat-request="' + esc(selection.id) + '" aria-label="Edit visual change request">' + esc(selection.changeRequest || '') + '</textarea>',
                '  <div class="email-builder-visual-attachment">',
                '    <div class="email-builder-visual-attachment-title">' + esc(compactVisualAttachmentTitle(selection)) + '</div>',
                '    <div class="email-builder-selection-text">' + esc(selection.visibleText || selection.outerHTML || 'Selected block') + '</div>',
                '    <details class="email-builder-visual-technical">',
                '      <summary>Technical details</summary>',
                visualAttachmentLines(selection).map(function(line) {
                  return '<div class="email-builder-visual-attachment-line">' + esc(line) + '</div>';
                }).join(''),
                '    </details>',
                '  </div>',
                '</div>',
              ].join('');
            }).join('')
          : '<div class="email-builder-visual-chat-empty">Select a rendered block, add a comment, and it will appear here with its DOM attachment.</div>',
        '</div>',
        '<div class="email-builder-visual-chat-actions">',
        '  <button class="email-builder-button" data-action="close-visual-chat">Disable edit mode</button>',
        '  <button class="email-builder-button primary" data-action="submit-visual-edits"' + (selections.length ? '' : ' disabled') + '>Submit edits</button>',
        '</div>',
      ].join('');
      resizeVisualTextareas(visualChatEl);
    }

    function renderVisualCommentModal() {
      if (!visualCommentModalEl) return;
      var selection = state.pendingVisualSelection;
      visualCommentModalEl.classList.toggle('open', !!selection);
      if (!selection) {
        visualCommentModalEl.innerHTML = '';
        return;
      }
      visualCommentModalEl.innerHTML = [
        '<div class="email-builder-modal" role="dialog" aria-modal="true" aria-label="Add visual edit comment">',
        '  <div class="email-builder-modal-head">',
        '    <p class="email-builder-modal-title">Add a comment for this block</p>',
        '  </div>',
        '  <div class="email-builder-modal-body">',
        '    <div class="email-builder-visual-attachment">',
        '      <div class="email-builder-visual-attachment-title">' + esc(compactVisualAttachmentTitle(selection)) + '</div>',
        '      <div class="email-builder-selection-text">' + esc(selection.visibleText || selection.outerHTML || 'Selected block') + '</div>',
        '      <details class="email-builder-visual-technical">',
        '        <summary>Technical details</summary>',
        visualAttachmentLines(selection).map(function(line) {
          return '<div class="email-builder-visual-attachment-line">' + esc(line) + '</div>';
        }).join(''),
        '      </details>',
        '    </div>',
        '    <textarea data-role="visual-comment-text" rows="1" data-auto-grow data-min-height="48" data-max-height="180" placeholder="Describe what should change in this selected block">' + esc(state.pendingVisualComment || '') + '</textarea>',
        '  </div>',
        '  <div class="email-builder-modal-actions">',
        '    <button class="email-builder-button" data-action="cancel-visual-comment">Cancel</button>',
        '    <button class="email-builder-button primary" data-action="add-visual-comment">Add comment</button>',
        '  </div>',
        '</div>',
      ].join('');
      var textarea = visualCommentModalEl.querySelector('[data-role="visual-comment-text"]');
      if (textarea) setTimeout(function() { autoGrowTextarea(textarea); textarea.focus(); }, 0);
    }

    function renderVisualSelections() {
      if (!visualSelectionsEl) return;
      var canEdit = !!state.htmlTemplate.trim();
      var selections = state.visualSelections || [];
      if (state.manualEditMode) {
        visualSelectionsEl.innerHTML = '<div class="email-builder-small">' + esc(state.manualEditDirty
          ? 'Manual edit mode is active. Click Save manual edits to apply the preview text changes to the HTML template.'
          : 'Manual edit mode is active. Click text in the rendered template to edit it. Placeholder variables remain visible so they are not hardcoded.') + '</div>';
        return;
      }
      var working = state.visualEditInFlight
        ? [
            '<div class="email-builder-ai-working" role="status" aria-live="polite">',
            '  <span class="email-builder-ai-spinner" aria-hidden="true"></span>',
            '  <span>',
            '    <span class="email-builder-ai-working-title">AI visual editor is working</span>',
            '    <span class="email-builder-ai-working-detail"> Applying comments to the durable HTML artifact, then refreshing this preview.</span>',
            '  </span>',
            '</div>',
          ].join('')
        : '';
      var header = [
        working,
        '<div class="email-builder-small">',
        esc(state.visualEditStatus || (canEdit
          ? 'Select rendered blocks in the HTML preview, then add change requests.'
          : 'Load or save an HTML artifact with a SHA before visual edits.')),
        '</div>',
      ].join('');
      if (!selections.length) {
        visualSelectionsEl.innerHTML = header;
        return;
      }
      visualSelectionsEl.innerHTML = header + '<div class="email-builder-small">' +
        esc(selections.length + ' comment' + (selections.length === 1 ? '' : 's') + ' queued in AI edit mode.') +
        '</div>';
    }

    function toggleVisualSelect() {
      if (state.visualSelectMode) {
        disableVisualEditMode();
        return;
      }
      if (state.manualEditMode) disableManualEditMode(false);
      state.visualSelectMode = true;
      state.visualChatOpen = true;
      state.visualEditStatus = 'AI edit mode is on. Click a rendered block to add a comment.';
      htmlEl.classList.toggle('selecting', state.visualSelectMode);
      if (previewFrameEl) previewFrameEl.classList.toggle('selecting', state.visualSelectMode);
      attachPreviewSelectionHandlers();
      renderVisualSurfaces();
    }

    function toggleManualEditMode() {
      if (state.manualEditMode) {
        disableManualEditMode(false);
        return;
      }
      if (!state.htmlTemplate.trim()) {
        state.visualEditStatus = 'Add or load an HTML template before using manual edit mode.';
        renderVisualSurfaces();
        return;
      }
      if (state.visualSelectMode) disableVisualEditMode();
      state.manualEditMode = true;
      state.manualEditDirty = false;
      state.visualEditStatus = 'Manual edit mode is on. Edit rendered text values, then save manual edits.';
      htmlEl.classList.remove('selecting');
      if (previewFrameEl) {
        previewFrameEl.classList.remove('selecting');
        previewFrameEl.classList.add('manual-editing');
      }
      updateSelectSurface(state.htmlTemplate || '<p>No HTML template.</p>');
      renderVisualSurfaces();
    }

    function disableManualEditMode(showStatus) {
      state.manualEditMode = false;
      state.manualEditDirty = false;
      if (previewFrameEl) previewFrameEl.classList.remove('manual-editing');
      if (showStatus !== false) state.visualEditStatus = 'Manual edit mode is off.';
      refreshComputed();
    }

    function saveManualPreviewEdits() {
      if (!state.manualEditMode) return;
      if (!selectSurfaceRoot) throw new Error('Manual edit preview is unavailable.');
      var documentEl = selectSurfaceRoot.querySelector('.email-select-document');
      if (!documentEl) throw new Error('Manual edit document is unavailable.');
      var nextHtml = cleanManualEditableHtml(documentEl);
      if (!nextHtml.trim()) throw new Error('Manual edit result is empty.');
      state.htmlTemplate = nextHtml;
      syncTextTemplate(state);
      state.dirty = true;
      state.manualEditMode = false;
      state.manualEditDirty = false;
      state.visualSelections = [];
      state.visualEditStatus = 'Manual preview edits saved to the HTML template.';
      state.status = 'Manual edits applied';
      if (previewFrameEl) previewFrameEl.classList.remove('manual-editing');
      refreshFields(['htmlTemplate', 'textTemplate']);
      refreshComputed();
    }

    function disableVisualEditMode() {
      state.visualSelectMode = false;
      state.visualChatOpen = false;
      state.pendingVisualSelection = null;
      state.pendingVisualComment = '';
      state.visualEditStatus = 'AI edit mode is off.';
      htmlEl.classList.remove('selecting');
      if (previewFrameEl) previewFrameEl.classList.remove('selecting');
      renderVisualSurfaces();
    }

    function openVisualCommentModal(target, viewportEl) {
      if (!state.htmlTemplate.trim()) {
        state.visualEditStatus = 'Add or load an HTML template before selecting blocks.';
        renderVisualSurfaces();
        return;
      }
      var selection = selectionMetadataFromElement(target, viewportEl || htmlEl, state);
      var duplicate = state.visualSelections.some(function(item) {
        return item.domPath === selection.domPath && item.snippetHash === selection.snippetHash;
      });
      if (duplicate) {
        state.visualChatOpen = true;
        state.visualEditStatus = 'That block already has a comment queued in the visual edit chat.';
        renderVisualSurfaces();
        return;
      }
      state.pendingVisualSelection = selection;
      state.pendingVisualComment = '';
      state.visualEditStatus = 'Selected block ready. Add a comment to attach it to the edit chat.';
      renderVisualSurfaces();
    }

    function closeVisualCommentModal() {
      state.pendingVisualSelection = null;
      state.pendingVisualComment = '';
      state.visualEditStatus = state.visualSelectMode
        ? 'AI edit mode is on. Click a rendered block to add a comment.'
        : 'AI edit mode is off.';
      renderVisualSurfaces();
    }

    function addPendingVisualComment() {
      var comment = String(state.pendingVisualComment || '').trim();
      if (!state.pendingVisualSelection) return;
      if (!comment) {
        state.visualEditStatus = 'Add a comment before attaching this selected block.';
        renderVisualSurfaces();
        return;
      }
      var selection = Object.assign({}, state.pendingVisualSelection, { changeRequest: comment });
      state.visualSelections.push(selection);
      state.pendingVisualSelection = null;
      state.pendingVisualComment = '';
      state.visualChatOpen = true;
      state.visualEditStatus = 'Comment added to the visual edit chat. Select another block or submit the batch.';
      renderVisualSurfaces();
    }

    function attachPreviewSelectionHandlers() {
      var doc;
      try {
        doc = htmlEl.contentDocument || (htmlEl.contentWindow && htmlEl.contentWindow.document);
      } catch {
        state.visualEditStatus = 'Preview DOM is not inspectable in this browser session.';
        renderVisualSurfaces();
        return;
      }
      if (!doc || !doc.body || doc.__emailVisualSelectionAttached) return;
      doc.__emailVisualSelectionAttached = true;
      doc.body.addEventListener('mouseover', function(event) {
        if (!state.visualSelectMode) return;
        var target = event.target && event.target.nodeType === 1 ? event.target : null;
        if (!target || target === doc.body || target === doc.documentElement) return;
        if (doc.__emailHovered && doc.__emailHovered !== target) {
          doc.__emailHovered.style.outline = doc.__emailHovered.__emailPreviousOutline || '';
          doc.__emailHovered.style.cursor = doc.__emailHovered.__emailPreviousCursor || '';
        }
        if (!target.__emailPreviousOutline) target.__emailPreviousOutline = target.style.outline || '';
        if (!target.__emailPreviousCursor) target.__emailPreviousCursor = target.style.cursor || '';
        target.style.outline = '2px solid #818cf8';
        target.style.cursor = 'crosshair';
        doc.__emailHovered = target;
      }, true);
      doc.body.addEventListener('mouseout', function(event) {
        if (!state.visualSelectMode) return;
        var target = event.target && event.target.nodeType === 1 ? event.target : null;
        if (!target || target !== doc.__emailHovered) return;
        target.style.outline = target.__emailPreviousOutline || '';
        target.style.cursor = target.__emailPreviousCursor || '';
        doc.__emailHovered = null;
      }, true);
      doc.body.addEventListener('click', function(event) {
        if (!state.visualSelectMode) return;
        event.preventDefault();
        event.stopPropagation();
        var target = event.target && event.target.nodeType === 1 ? event.target : null;
        if (!target || target === doc.body || target === doc.documentElement) return;
        if (!state.htmlArtifactPath.trim() || !state.htmlArtifactSha256.trim()) {
          state.visualEditStatus = 'This draft will be saved as a durable HTML artifact when you submit edits.';
          renderVisualSurfaces();
        }
        openVisualCommentModal(target, htmlEl);
      }, true);
    }

    function updateSelectSurface(renderedHtml) {
      if (!selectSurfaceRoot) return;
      var manual = !!state.manualEditMode;
      selectSurfaceRoot.innerHTML = [
        '<style>',
        ':host{display:block;height:100%;background:#fff;color:#111827;}',
        '.email-select-document{min-height:100%;padding:12px;background:#fff;font-family:Arial,sans-serif;font-size:14px;line-height:1.45;color:#111827;}',
        '.email-select-document *{box-sizing:border-box;}',
        '.email-select-document.manual-editing [data-manual-editable="true"]{outline:1px dashed rgba(37,99,235,.45);outline-offset:2px;cursor:text;border-radius:3px;}',
        '.email-select-document.manual-editing [data-manual-editable="true"]:hover,.email-select-document.manual-editing [data-manual-editable="true"]:focus{outline:2px solid #2563eb;background:rgba(37,99,235,.08);}',
        '</style>',
        '<div class="email-select-document' + (manual ? ' manual-editing' : '') + '">',
        sanitizePreviewHtml(manual ? state.htmlTemplate : renderedHtml),
        '</div>',
      ].join('');
      configureManualEditableSurface(selectSurfaceRoot.querySelector('.email-select-document'), manual);
    }

    function buildVisualEditPrompt() {
      var requests = (state.visualSelections || []).map(function(selection) {
        return Object.assign({}, selection, {
          changeRequest: String(selection.changeRequest || '').trim(),
        });
      });
      if (!state.htmlArtifactPath.trim()) throw new Error('HTML artifact path is required for visual edits.');
      if (!state.htmlArtifactSha256.trim()) throw new Error('HTML artifact sha256 is required for visual edits.');
      if (!requests.length) throw new Error('Select at least one rendered HTML block first.');
      var missing = requests.filter(function(selection) { return !selection.changeRequest; });
      if (missing.length) throw new Error('Every selected block needs a change request.');
      var payload = {
        targetPersonaKey: 'email-template-visual-editor',
        artifactRef: compactObject({
          source: 'workspace_file',
          format: 'html',
          workspacePath: state.htmlArtifactPath.trim(),
          workspaceFileId: state.htmlArtifactFileId.trim(),
          sha256: state.htmlArtifactSha256.trim(),
        }),
        selections: requests.map(function(selection, index) {
          return compactObject({
            index: index + 1,
            selector: selection.selector,
            domPath: selection.domPath,
            tagName: selection.tagName,
            bounds: selection.bounds,
            visibleText: selection.visibleText,
            outerHTML: selection.outerHTML,
            snippetHash: selection.snippetHash,
            changeRequest: selection.changeRequest,
          });
        }),
        constraints: {
          updateSameWorkspacePath: true,
          expectedSha256: state.htmlArtifactSha256.trim(),
          metadataOnlySelectionContext: true,
          screenshotsIncluded: false,
          forbiddenTools: [
            'email_template_artifact_create',
            'email_campaign_prepare',
            'email_campaign_preview',
            'email_campaign_test_send',
            'email_campaign_review_propose',
            'email_campaign_send_apply',
          ],
        },
      };
      return [
        'Route this request to the plugin-specific system persona with stable key `email-template-visual-editor` when that persona is available.',
        '',
        'Apply a batch visual edit to one existing durable HTML email template artifact.',
        '',
        'Use only these artifact tools:',
        '1. email_template_artifact_search with includeContent=true to read the current artifact.',
        '2. email_template_artifact_update with the exact same workspacePath and expectedSha256.',
        '',
        'Do not call email_template_artifact_create.',
        'Do not create a copy or variant unless the user explicitly asks for one.',
        'Do not call campaign prepare, preview, test send, review, or production send tools.',
        'Preserve safe email HTML: no scripts, event handlers, javascript: URLs, forms, tracking pixels, or remote code.',
        'Use the metadata-only selected block context to target the requested blocks, but update the full HTML artifact once.',
        'Return workspacePath, workspaceFileId, previousSha256, new sha256, variables, and a short edit summary.',
        '',
        'Visual edit payload:',
        '```json',
        JSON.stringify(payload, null, 2),
        '```',
      ].join('\n');
    }

    function resolveCurrentHtmlArtifactFile() {
      var htmlFileId = state.htmlArtifactFileId.trim();
      if (htmlFileId) {
        return Promise.resolve({
          id: htmlFileId,
          relativePath: state.htmlArtifactPath,
          contentType: 'text/html',
          checksum: state.htmlArtifactSha256,
        });
      }
      var path = state.htmlArtifactPath.trim();
      if (!path || !window.__tribexAiClient || typeof window.__tribexAiClient.listWorkspaceFiles !== 'function') {
        return Promise.resolve(null);
      }
      var slashIndex = path.lastIndexOf('/');
      var prefix = slashIndex >= 0 ? path.slice(0, slashIndex + 1) : '';
      return ensureWorkspaceContext()
        .then(function(workspaceId) {
          return window.__tribexAiClient.listWorkspaceFiles(workspaceId, prefix);
        })
        .then(function(result) {
          var list = Array.isArray(result) ? result : (result && result.files || []);
          return list.find(function(file) {
            return filePath(file) === path;
          }) || null;
        })
        .catch(function(error) {
          state.visualEditStatus = error && error.message
            ? 'Could not search for the artifact to refresh: ' + error.message
            : 'Could not search for the artifact to refresh.';
          renderVisualSurfaces();
          return null;
        });
    }

    function refreshCurrentHtmlArtifact(options) {
      options = options || {};
      var previousSha = state.htmlArtifactSha256.trim();
      return resolveCurrentHtmlArtifactFile().then(function(file) {
        if (!file) {
          if (options.showStatus) {
            state.visualEditStatus = 'No durable HTML artifact is selected to refresh.';
            renderVisualSurfaces();
          }
          return false;
        }
        return fetchArtifactText(file);
      }).then(function(result) {
        if (!result) {
          if (options.showStatus) {
            state.visualEditStatus = 'Could not load the selected HTML artifact.';
            renderVisualSurfaces();
          }
          return false;
        }
        var nextSha = result.sha256 || fileChecksum(result.file);
        if ((!nextSha || nextSha === previousSha) && result.text === state.htmlTemplate) {
          if (options.showStatus) {
            state.visualEditStatus = nextSha
              ? 'Artifact is already current at SHA ' + nextSha.slice(0, 12) + '.'
              : 'Artifact is already current.';
            renderVisualSurfaces();
          }
          return false;
        }
        state.htmlTemplate = result.text;
        state.htmlArtifactPath = filePath(result.file) || state.htmlArtifactPath;
        state.htmlArtifactFileId = firstString([result.file.id, result.file.workspaceFileId], state.htmlArtifactFileId);
        state.htmlArtifactSha256 = nextSha;
        state.visualSelections = [];
        state.visualEditInFlight = false;
        state.pendingVisualSelection = null;
        state.pendingVisualComment = '';
        state.visualEditStatus = 'Template refreshed from the updated artifact.';
        state.status = 'Visual edits applied';
        refreshFields(['htmlTemplate', 'htmlArtifactPath', 'htmlArtifactFileId', 'htmlArtifactSha256']);
        refreshComputed();
        return true;
      }).catch(function(error) {
        if (options.showStatus) {
          state.visualEditStatus = error && error.message
            ? 'Could not refresh the updated artifact: ' + error.message
            : 'Could not refresh the updated artifact.';
          renderVisualSurfaces();
        }
        return false;
      });
    }

    function refreshCurrentHtmlArtifactFromButton() {
      state.visualEditStatus = 'Refreshing the durable HTML artifact.';
      renderVisualSurfaces();
      return refreshCurrentHtmlArtifact({ showStatus: true });
    }

    function scheduleVisualEditRefresh(submittedSha) {
      [8000, 20000, 45000].forEach(function(delay) {
        window.setTimeout(function() {
          refreshCurrentHtmlArtifact().then(function(refreshed) {
            var currentSha = state.htmlArtifactSha256.trim();
            if (!refreshed && delay === 45000 && (!submittedSha || currentSha === submittedSha)) {
              state.visualEditStatus = 'Visual edit request submitted. The template has not refreshed yet; reload the saved template after the persona reports the new SHA.';
              renderVisualSurfaces();
            }
          });
        }, delay);
      });
    }

    function submitVisualEdits() {
      if (!window.__tribexAiClient || typeof window.__tribexAiClient.sendMessage !== 'function') {
        throw new Error('TribeX AI persona messaging is unavailable in this MCPViews session.');
      }
      state.visualEditStatus = 'Submitting visual edit request to the email-template-visual-editor persona.';
      renderVisualSurfaces();
      setBusy(true, 'Submitting visual edits');
      var submittedSha = '';
      return ensureHtmlTemplateArtifactForVisualEdit()
        .then(function() {
          submittedSha = state.htmlArtifactSha256.trim();
          var prompt = buildVisualEditPrompt();
          state.promptText = prompt;
          return prompt;
        })
        .then(function(prompt) {
          return ensureVisualEditorThread().then(function(threadId) {
            return configureVisualEditorRuntime(threadId).then(function(configuredThreadId) {
              return {
                prompt: prompt,
                threadId: configuredThreadId,
              };
            });
          });
        })
        .then(function(context) {
          return window.__tribexAiClient.sendMessage(context.threadId, context.prompt, {
            displayPrompt: 'Apply visual edits to ' + (state.htmlArtifactPath || state.name || 'email template') + '.',
            operationId: 'email-template-visual-edit:' + Date.now(),
            clientMessageId: 'email-template-visual-edit:' + Date.now(),
            skillInvocation: {
              key: 'email-template-visual-editor',
              source: 'mcpviews-email-deliverability-plugin',
            },
          });
        })
        .then(function(turn) {
          state.status = 'Visual edit request submitted';
          state.visualEditInFlight = true;
          state.visualEditStatus = 'Visual edit request submitted. The builder will try to refresh the template after the persona updates the artifact.';
          scheduleVisualEditRefresh(submittedSha);
          renderVisualSurfaces();
          refreshComputed();
          if (turn && turn.done && typeof turn.done.then === 'function') {
            turn.done.catch(function(error) {
              state.visualEditInFlight = false;
              state.visualEditStatus = error && error.message
                ? 'Visual editor failed: ' + error.message
                : 'Visual editor failed before updating the template.';
              showError(error);
            }).then(function() {
              return refreshCurrentHtmlArtifact().then(function(refreshed) {
                if (refreshed) return;
                var currentSha = state.htmlArtifactSha256.trim();
                if (submittedSha && currentSha && currentSha !== submittedSha) {
                  state.visualEditInFlight = false;
                  state.visualEditStatus = 'Template refreshed from the updated artifact.';
                  renderVisualSurfaces();
                  return;
                }
                state.visualEditInFlight = false;
                state.visualEditStatus = 'Visual editor finished. The artifact did not refresh automatically yet; use Refresh or reload the saved template if the persona reported a new SHA.';
                renderVisualSurfaces();
              });
            });
          } else {
            state.visualEditInFlight = false;
            renderVisualSurfaces();
          }
        })
        .catch(function(error) {
          state.visualEditInFlight = false;
          throw error;
        })
        .finally(function() {
          setBusy(false);
        });
    }

    function refreshComputed() {
      renderStatus();
      try {
        var validation = validateState(state);
        if (validation.missingVariables.length) {
          validationEl.className = 'email-builder-strip email-builder-warning';
          validationEl.innerHTML = '<h3>Validation</h3><div class="email-builder-validation-line"><span class="email-builder-dot"></span><span>Sample row missing: ' + esc(validation.missingVariables.join(', ')) + '</span></div>';
          if (metricStateEl) {
            metricStateEl.textContent = 'Needs data';
            metricStateEl.className = 'email-builder-stat-value warning';
          }
        } else {
          validationEl.className = 'email-builder-strip email-builder-ok';
          validationEl.innerHTML = '<h3>Validation</h3><div class="email-builder-validation-line"><span class="email-builder-dot"></span><span>Template preview is ready.</span></div>';
          if (metricStateEl) {
            metricStateEl.textContent = 'Ready';
            metricStateEl.className = 'email-builder-stat-value ready';
          }
        }
        if (metricVariablesEl) metricVariablesEl.textContent = String(validation.variables.length);
        if (metricAudienceEl) metricAudienceEl.textContent = String(validation.audience.length);
        variablesEl.innerHTML = validation.variables.length
          ? validation.variables.map(function(name) { return '<span class="email-builder-chip">' + esc(name) + '</span>'; }).join('')
          : '<span class="email-builder-small">No placeholders yet.</span>';
        subjectEl.textContent = validation.preview.subject;
        textEl.textContent = validation.preview.text;
        htmlEl.srcdoc = validation.preview.html
          ? '<!doctype html><html><head><base target="_blank"><style>body{font-family:Arial,sans-serif;font-size:14px;line-height:1.45;color:#111827;padding:12px;}</style></head><body>' + validation.preview.html + '</body></html>'
          : '<!doctype html><html><body style="font-family:Arial,sans-serif;color:#667085;padding:12px;">No HTML template.</body></html>';
        updateSelectSurface(validation.preview.html || '<p>No HTML template.</p>');
        htmlEl.classList.toggle('selecting', state.visualSelectMode);
        if (previewFrameEl) {
          previewFrameEl.classList.toggle('selecting', state.visualSelectMode);
          previewFrameEl.classList.toggle('manual-editing', state.manualEditMode);
        }
        if (promptEl && !state.promptText) promptEl.textContent = '';
        renderVisualSurfaces();
      } catch (error) {
        variablesEl.innerHTML = '<span class="email-builder-small">Variables unavailable until the draft is valid.</span>';
        subjectEl.textContent = '';
        textEl.textContent = '';
        htmlEl.srcdoc = '';
        renderVisualSurfaces();
        validationEl.className = 'email-builder-strip email-builder-error';
        validationEl.innerHTML = '<h3>Validation</h3><div class="email-builder-validation-line"><span class="email-builder-dot"></span><span>' + esc(error.message || String(error)) + '</span></div>';
        if (metricVariablesEl) metricVariablesEl.textContent = '--';
        if (metricAudienceEl) metricAudienceEl.textContent = '--';
        if (metricStateEl) {
          metricStateEl.textContent = 'Blocked';
          metricStateEl.className = 'email-builder-stat-value blocked';
        }
      }
    }

    function resolveThread() {
      if (!state.threadId.trim()) {
        throw new Error('Thread ID is required to resolve workspace context.');
      }
      if (!window.__tribexAiClient || typeof window.__tribexAiClient.fetchThread !== 'function') {
        throw new Error('TribeX AI client is unavailable in this MCPViews session.');
      }
      setBusy(true, 'Resolving thread');
      return window.__tribexAiClient.fetchThread(state.threadId.trim())
        .then(function(thread) {
          applyThreadContext(thread);
          state.status = 'Thread context resolved';
          refreshComputed();
          return loadOrganizations()
            .then(loadWorkspacesForSelectedOrg)
            .then(loadTemplateChoices);
        })
        .finally(function() {
          setBusy(false);
        });
    }

    function ensureWorkspaceContext() {
      if (state.workspaceId.trim()) return Promise.resolve(state.workspaceId.trim());
      if (!state.threadId.trim()) {
        throw new Error('Workspace ID is required before searching artifacts. Open from a thread or resolve a thread first.');
      }
      if (!window.__tribexAiClient || typeof window.__tribexAiClient.fetchThread !== 'function') {
        throw new Error('TribeX AI client is unavailable in this MCPViews session.');
      }
      return window.__tribexAiClient.fetchThread(state.threadId.trim()).then(function(thread) {
        applyThreadContext(thread);
        if (!state.workspaceId.trim()) {
          throw new Error('Could not resolve a workspace for this thread.');
        }
        return state.workspaceId.trim();
      });
    }

    function searchPrefixes(query) {
      var normalized = normalizeWorkspacePath(query);
      if (!normalized || normalized === 'email') return ['email/'];
      if (normalized.indexOf('/') >= 0 && normalized.indexOf('email/') === 0) {
        return [normalized, 'email/'].filter(function(value, index, values) {
          return values.indexOf(value) === index;
        });
      }
      return ['email/'];
    }

    function searchableArtifact(file) {
      var path = filePath(file);
      if (!path || path.indexOf('/.tribex-folder') >= 0 || path.endsWith('/.tribex-folder')) {
        return false;
      }
      if (path.indexOf('email/') === 0) return true;
      var kind = artifactKind(file);
      return kind === 'html' || kind === 'campaign' || kind === 'audience' || kind === 'json';
    }

    function filterArtifacts(files, query) {
      var normalizedQuery = normalizeWorkspacePath(query).toLowerCase();
      return (files || [])
        .filter(searchableArtifact)
        .filter(function(file) {
          if (!normalizedQuery || normalizedQuery === 'email/' || normalizedQuery === 'email') return true;
          return filePath(file).toLowerCase().indexOf(normalizedQuery) >= 0;
        })
        .sort(function(left, right) {
          return filePath(left).localeCompare(filePath(right));
        })
        .slice(0, 50);
    }

    function searchArtifacts() {
      if (!window.__tribexAiClient || typeof window.__tribexAiClient.listWorkspaceFiles !== 'function') {
        throw new Error('TribeX AI workspace file search is unavailable in this MCPViews session.');
      }
      var query = state.artifactSearchQuery.trim() || 'email/';
      setBusy(true, 'Searching workspace artifacts');
      return ensureWorkspaceContext()
        .then(function(workspaceId) {
          var prefixes = searchPrefixes(query);
          var allFiles = [];
          var seen = {};
          function loadPrefix(index) {
            if (index >= prefixes.length) return Promise.resolve();
            return window.__tribexAiClient.listWorkspaceFiles(workspaceId, prefixes[index])
              .then(function(result) {
                (result && result.files || []).forEach(function(file) {
                  var key = firstString([file && file.id], '') || filePath(file);
                  if (!key || seen[key]) return;
                  seen[key] = true;
                  allFiles.push(file);
                });
                var matches = filterArtifacts(allFiles, query);
                if (matches.length || index === prefixes.length - 1) {
                  state.artifactResults = matches;
                  state.artifactSearchStatus = matches.length
                    ? 'Found ' + matches.length + ' artifact' + (matches.length === 1 ? '' : 's') + '.'
                    : 'No email artifacts matched that path. Try email/, email/templates/, email/campaigns/, or email/audiences/.';
                  renderArtifactResults();
                  state.status = matches.length ? 'Artifact search ready' : 'No matching artifacts';
                  refreshComputed();
                  return null;
                }
                return loadPrefix(index + 1);
              });
          }
          return loadPrefix(0);
        })
        .finally(function() {
          setBusy(false);
        });
    }

    function fetchArtifactText(file) {
      if (!file) throw new Error('Select an artifact to load.');
      if (!window.__tribexAiClient ||
        typeof window.__tribexAiClient.getWorkspaceFile !== 'function' ||
        typeof window.__tribexAiClient.fetchSignedFileBytes !== 'function') {
        throw new Error('TribeX AI workspace file download is unavailable in this MCPViews session.');
      }
      return ensureWorkspaceContext()
        .then(function(workspaceId) {
          var fileId = firstString([file.id, file.workspaceFileId], '');
          if (!fileId) throw new Error('Selected artifact is missing a workspace file ID.');
          return window.__tribexAiClient.getWorkspaceFile(workspaceId, fileId)
            .then(function(envelope) {
              var resolvedFile = Object.assign({}, file, envelope && envelope.file ? envelope.file : {});
              return window.__tribexAiClient.fetchSignedFileBytes(envelope && envelope.download)
                .then(function(downloaded) {
                  var bytes = downloaded && downloaded.bytes ? downloaded.bytes : new Uint8Array();
                  return sha256Hex(bytes, fileChecksum(resolvedFile)).then(function(hash) {
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

    function applyDraftToState(draft, sourceFile, sha256) {
      var normalized = normalizeDraftInput(draft);
      var fieldMap = {
        organizationId: normalized.organizationId || normalized.organization_id,
        workspaceId: normalized.workspaceId || normalized.workspace_id,
        projectId: normalized.projectId || normalized.project_id,
        threadId: normalized.threadId || normalized.thread_id,
        name: normalized.name,
        templateKey: normalized.templateKey || normalized.template_key,
        templateName: normalized.templateName || normalized.template_name,
        fromEmail: normalized.fromEmail || normalized.from_email,
        sendingIdentityId: normalized.sendingIdentityId || normalized.sending_identity_id,
        subjectTemplate: normalized.subjectTemplate || normalized.subject_template,
        textTemplate: normalized.textTemplate || normalized.text_template,
        htmlTemplate: normalized.htmlTemplate || normalized.html_template,
        htmlArtifactPath: normalized.htmlArtifactPath,
        htmlArtifactFileId: normalized.htmlArtifactFileId,
        htmlArtifactSha256: normalized.htmlArtifactSha256,
        audienceArtifactPath: normalized.audienceArtifactPath,
        audienceArtifactFileId: normalized.audienceArtifactFileId,
        audienceArtifactFormat: normalized.audienceArtifactFormat,
        audienceArtifactSha256: normalized.audienceArtifactSha256,
        testTo: normalized.testTo || normalized.test_to,
        decidrProjectId: normalized.decidrProjectId || normalized.decidr_project_id,
      };
      Object.keys(fieldMap).forEach(function(key) {
        if (fieldMap[key] !== undefined && fieldMap[key] !== null && fieldMap[key] !== '') {
          state[key] = String(fieldMap[key]);
        }
      });
      if (Array.isArray(normalized.decidrDecisionIds)) {
        state.decidrDecisionIds = normalized.decidrDecisionIds.join(', ');
      } else if (normalized.decidrDecisionIds || normalized.decidr_decision_ids) {
        state.decidrDecisionIds = String(normalized.decidrDecisionIds || normalized.decidr_decision_ids);
      }
      if (normalized.audience || normalized.audienceRows || normalized.sampleAudience) {
        state.audienceText = defaultAudienceText(normalized);
      }
      if (sourceFile && artifactKind(sourceFile) === 'campaign') {
        state.lastArtifact = {
          workspacePath: filePath(sourceFile),
          workspaceFileId: firstString([sourceFile.id, sourceFile.workspaceFileId], ''),
          sha256: sha256,
        };
      }
      state.dirty = true;
      refreshFields([
        'name',
        'organizationId',
        'workspaceId',
        'projectId',
        'threadId',
        'templateKey',
        'templateName',
        'fromEmail',
        'sendingIdentityId',
        'subjectTemplate',
        'textTemplate',
        'htmlTemplate',
        'htmlArtifactPath',
        'htmlArtifactFileId',
        'htmlArtifactSha256',
        'audienceText',
        'audienceArtifactPath',
        'audienceArtifactFileId',
        'audienceArtifactFormat',
        'audienceArtifactSha256',
        'testTo',
        'decidrProjectId',
        'decidrDecisionIds',
      ]);
    }

    function applyAudienceArtifact(file, text, sha256) {
      state.audienceArtifactPath = filePath(file);
      state.audienceArtifactFileId = firstString([file.id, file.workspaceFileId], '');
      state.audienceArtifactSha256 = sha256 || fileChecksum(file);
      state.audienceArtifactFormat = filePath(file).toLowerCase().endsWith('.csv') ? 'csv' : 'json';
      if (state.audienceArtifactFormat === 'json') {
        try {
          var parsed = JSON.parse(text);
          var rows = Array.isArray(parsed)
            ? parsed
            : (isRecord(parsed) && Array.isArray(parsed.rows)
              ? parsed.rows
              : (isRecord(parsed) && Array.isArray(parsed.audience) ? parsed.audience : null));
          if (rows) state.audienceText = JSON.stringify(rows, null, 2);
        } catch {
          // Keep the artifact ref even if the JSON preview cannot be parsed locally.
        }
      }
      refreshFields([
        'audienceText',
        'audienceArtifactPath',
        'audienceArtifactFileId',
        'audienceArtifactFormat',
        'audienceArtifactSha256',
      ]);
    }

    function loadReferencedHtmlTemplate() {
      var htmlFileId = state.htmlArtifactFileId.trim();
      if (!htmlFileId) return Promise.resolve(false);
      return fetchArtifactText({
        id: htmlFileId,
        relativePath: state.htmlArtifactPath,
        contentType: 'text/html',
        checksum: state.htmlArtifactSha256,
      }).then(function(result) {
        state.htmlTemplate = result.text;
        state.htmlArtifactPath = filePath(result.file) || state.htmlArtifactPath;
        state.htmlArtifactFileId = firstString([result.file.id, result.file.workspaceFileId], htmlFileId);
        state.htmlArtifactSha256 = result.sha256 || state.htmlArtifactSha256;
        refreshFields(['htmlTemplate', 'htmlArtifactPath', 'htmlArtifactFileId', 'htmlArtifactSha256']);
        return true;
      }).catch(function() {
        return false;
      });
    }

    function loadArtifact(file) {
      setBusy(true, 'Loading workspace artifact');
      return fetchArtifactText(file)
        .then(function(result) {
          var kind = artifactKind(result.file);
          if (kind === 'html') {
            state.htmlTemplate = result.text;
            state.htmlArtifactPath = filePath(result.file);
            state.htmlArtifactFileId = firstString([result.file.id, result.file.workspaceFileId], '');
            state.htmlArtifactSha256 = result.sha256;
            state.dirty = true;
            refreshFields(['htmlTemplate', 'htmlArtifactPath', 'htmlArtifactFileId', 'htmlArtifactSha256']);
            state.status = 'HTML template artifact loaded';
          } else if (kind === 'audience') {
            applyAudienceArtifact(result.file, result.text, result.sha256);
            state.dirty = true;
            state.status = 'Audience artifact loaded';
          } else {
            var parsed = JSON.parse(result.text);
            var campaignDraft = draftFromCampaignArtifact(parsed, result.file, result.sha256);
            var builderDraft = draftFromBuilderArtifact(parsed);
            if (campaignDraft) {
              applyDraftToState(campaignDraft, result.file, result.sha256);
              return loadReferencedHtmlTemplate().then(function(loadedHtml) {
                state.status = loadedHtml
                  ? 'Campaign draft and HTML template loaded'
                  : 'Campaign draft artifact loaded';
                refreshComputed();
              });
            } else if (builderDraft) {
              applyDraftToState(builderDraft, result.file, result.sha256);
              state.lastArtifact = {
                workspacePath: filePath(result.file),
                workspaceFileId: firstString([result.file.id, result.file.workspaceFileId], ''),
                sha256: result.sha256,
              };
              state.status = 'Template draft artifact loaded';
            } else {
              applyAudienceArtifact(result.file, result.text, result.sha256);
              state.status = 'JSON audience artifact loaded';
            }
          }
          refreshComputed();
        })
        .finally(function() {
          setBusy(false);
        });
    }

    function saveArtifact() {
      if (!state.workspaceId.trim()) {
        throw new Error('Workspace ID is required before saving a TribeX artifact.');
      }
      if (
        !window.__tribexAiClient ||
        typeof window.__tribexAiClient.initWorkspaceFileUpload !== 'function' ||
        typeof window.__tribexAiClient.uploadWorkspaceFileToSignedUrl !== 'function'
      ) {
        throw new Error('TribeX AI workspace upload APIs are unavailable in this MCPViews session.');
      }
      validateState(state);
      setBusy(true, 'Saving workspace artifact');
      var path = 'email/deliverability/templates/' + slugify(state.name || state.templateName) + '-' + timestampId() + '.json';
      var artifactRef = { workspacePath: path };
      var artifact = artifactPayload(state, artifactRef);
      var blob = new Blob([JSON.stringify(artifact, null, 2)], {
        type: 'application/json',
      });
      return window.__tribexAiClient.initWorkspaceFileUpload(state.workspaceId.trim(), {
        relativePath: path,
        contentType: 'application/json',
        sizeBytes: blob.size,
        source: 'mcpviews-email-template-builder',
        metadata: {
          schemaVersion: ARTIFACT_SCHEMA_VERSION,
          templateName: state.name || state.templateName,
        },
      }).then(function(init) {
        return window.__tribexAiClient.uploadWorkspaceFileToSignedUrl(init && init.upload, blob)
          .then(function() {
            state.lastArtifact = {
              workspacePath: path,
              workspaceFileId: init && init.file && init.file.id ? init.file.id : null,
            };
            state.dirty = false;
            state.status = 'Workspace artifact saved';
            refreshComputed();
            return state.lastArtifact;
          });
      }).finally(function() {
        setBusy(false);
      });
    }

    function buildPromptOnly() {
      try {
        var prompt = personaPrompt(state, state.lastArtifact);
        state.promptText = prompt;
        if (promptEl) promptEl.textContent = prompt;
        state.status = 'Persona prompt built';
        renderStatus();
      } catch (error) {
        showError(error);
      }
    }

    function buildCampaignPromptOnly() {
      try {
        var prompt = personaCampaignPrompt(state, state.lastArtifact);
        state.promptText = prompt;
        if (promptEl) promptEl.textContent = prompt;
        state.status = 'Campaign prompt built';
        renderStatus();
      } catch (error) {
        showError(error);
      }
    }

    function ensureSavedArtifact() {
      if (state.lastArtifact && !state.dirty) return Promise.resolve(state.lastArtifact);
      if (!state.workspaceId.trim() && state.threadId.trim()) {
        return resolveThread().then(saveArtifact);
      }
      return saveArtifact();
    }

    function sendTestThroughPersona() {
      if (!state.threadId.trim()) {
        throw new Error('Thread ID is required before asking a persona to send a test email.');
      }
      if (!window.__tribexAiClient || typeof window.__tribexAiClient.sendMessage !== 'function') {
        throw new Error('TribeX AI persona messaging is unavailable in this MCPViews session.');
      }
      validateState(state);
      if (!state.testTo.trim()) throw new Error('Test recipient email is required.');
      setBusy(true, 'Saving and asking persona');
      return ensureSavedArtifact().then(function(artifact) {
        var prompt = personaPrompt(state, artifact);
        state.promptText = prompt;
        if (promptEl) promptEl.textContent = prompt;
        return window.__tribexAiClient.sendMessage(state.threadId.trim(), prompt, {
          displayPrompt: 'Prepare and send one test email for ' + (state.name || state.templateName || 'email template') + '.',
          operationId: 'email-template-test:' + Date.now(),
          clientMessageId: 'email-template-test:' + Date.now(),
        });
      }).then(function() {
        state.status = 'Persona test-send request submitted';
        refreshComputed();
      }).finally(function() {
        setBusy(false);
      });
    }

    function sendCampaignThroughPersona() {
      if (!state.threadId.trim()) {
        throw new Error('Thread ID is required before asking a persona to prepare a campaign.');
      }
      if (!window.__tribexAiClient || typeof window.__tribexAiClient.sendMessage !== 'function') {
        throw new Error('TribeX AI persona messaging is unavailable in this MCPViews session.');
      }
      validateState(state);
      setBusy(true, 'Saving and asking persona');
      return ensureSavedArtifact().then(function(artifact) {
        var prompt = personaCampaignPrompt(state, artifact);
        state.promptText = prompt;
        if (promptEl) promptEl.textContent = prompt;
        return window.__tribexAiClient.sendMessage(state.threadId.trim(), prompt, {
          displayPrompt: 'Prepare approval-gated email campaign for ' + (state.name || state.templateName || 'email campaign') + '.',
          operationId: 'email-campaign-workflow:' + Date.now(),
          clientMessageId: 'email-campaign-workflow:' + Date.now(),
        });
      }).then(function() {
        state.status = 'Persona campaign request submitted';
        refreshComputed();
      }).finally(function() {
        setBusy(false);
      });
    }
  };
})();
