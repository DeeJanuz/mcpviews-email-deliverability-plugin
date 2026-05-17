import { createHash } from "node:crypto";

export const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z_][a-zA-Z0-9_.-]*)\s*}}/g;
export const ARTIFACT_SCHEMA_VERSION = "tribex.emailTemplateDraft.v1";

export function extractTemplateVariables(...templates) {
  const names = new Set();
  for (const template of templates) {
    if (!template) continue;
    for (const match of String(template).matchAll(PLACEHOLDER_PATTERN)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeArtifactRef(value, fallbackFormat) {
  if (!isRecord(value)) return null;
  const workspacePath =
    stringValue(value.workspacePath) || stringValue(value.relativePath);
  const workspaceFileId =
    stringValue(value.workspaceFileId) || stringValue(value.fileId);
  const sha256 = stringValue(value.sha256).replace(/^sha256:/i, "");
  const format = stringValue(value.format) || fallbackFormat || undefined;
  if (!workspacePath && !workspaceFileId) return null;
  return dropUndefined({
    source: value.source || "workspace_file",
    format,
    workspacePath,
    workspaceFileId,
    sha256,
    sizeBytes: value.sizeBytes,
  });
}

function refFromDraftFields(draft, prefix, fallbackFormat) {
  const workspacePath = stringValue(draft[`${prefix}Path`]);
  const workspaceFileId = stringValue(draft[`${prefix}FileId`]);
  const sha256 = stringValue(draft[`${prefix}Sha256`]);
  const format = stringValue(draft[`${prefix}Format`]) || fallbackFormat;
  if (!workspacePath && !workspaceFileId) return null;
  return dropUndefined({
    source: "workspace_file",
    format,
    workspacePath,
    workspaceFileId,
    sha256,
  });
}

function setNestedValue(target, path, value) {
  const segments = String(path || "").split(".").filter(Boolean);
  let current = target;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }
    if (!isRecord(current[segment])) current[segment] = {};
    current = current[segment];
  });
}

function syntheticAudienceRow(variables, sampleVariables) {
  const row = {
    email: "preview@example.com",
    emailAddress: "preview@example.com",
  };
  const samples = isRecord(sampleVariables) ? sampleVariables : {};
  for (const variable of variables) {
    const sample = readTemplateVariable(samples, variable);
    setNestedValue(row, variable, scalarTemplateValue(sample) ?? `[${variable}]`);
  }
  return row;
}

export function normalizeDraftInput(input) {
  const raw = isRecord(input) ? input : {};
  const prepare = isRecord(raw.campaignPreparePayload)
    ? raw.campaignPreparePayload
    : {};
  const metadata = isRecord(prepare.metadata) ? prepare.metadata : {};
  const htmlRef =
    normalizeArtifactRef(raw.htmlTemplateArtifactRef, "html") ||
    normalizeArtifactRef(prepare.htmlTemplateArtifactRef, "html") ||
    normalizeArtifactRef(metadata.htmlTemplateArtifactRef, "html") ||
    normalizeArtifactRef(raw.artifactRef, "html");
  const audienceRef =
    normalizeArtifactRef(raw.audienceArtifactRef, "json") ||
    normalizeArtifactRef(prepare.audienceArtifactRef, "json") ||
    normalizeArtifactRef(metadata.audienceArtifactRef, "json");
  const campaignDraftRef =
    normalizeArtifactRef(raw.campaignDraftArtifactRef, "json") ||
    normalizeArtifactRef(metadata.campaignDraftArtifactRef, "json");
  const merged = dropUndefined({
    ...raw,
    ...prepare,
    testTo: raw.testTo ?? prepare.testTo,
    sampleVariables: raw.sampleVariables ?? metadata.sampleVariables,
    htmlTemplateArtifactRef: htmlRef,
    audienceArtifactRef: audienceRef,
    campaignDraftArtifactRef: campaignDraftRef,
    htmlArtifactPath: htmlRef?.workspacePath ?? raw.htmlArtifactPath,
    htmlArtifactFileId: htmlRef?.workspaceFileId ?? raw.htmlArtifactFileId,
    htmlArtifactSha256: htmlRef?.sha256 ?? raw.htmlArtifactSha256,
    audienceArtifactPath:
      audienceRef?.workspacePath ?? raw.audienceArtifactPath,
    audienceArtifactFileId:
      audienceRef?.workspaceFileId ?? raw.audienceArtifactFileId,
    audienceArtifactFormat:
      audienceRef?.format ?? raw.audienceArtifactFormat ?? "json",
    audienceArtifactSha256:
      audienceRef?.sha256 ?? raw.audienceArtifactSha256,
    workspacePath:
      campaignDraftRef?.workspacePath ?? raw.workspacePath ?? raw.relativePath,
    workspaceFileId:
      campaignDraftRef?.workspaceFileId ?? raw.workspaceFileId ?? raw.fileId,
    workspaceSha256:
      campaignDraftRef?.sha256 ?? raw.workspaceSha256 ?? raw.sha256,
  });
  delete merged.campaignPreparePayload;
  return merged;
}

function readTemplateVariable(variables, path) {
  const segments = String(path || "").split(".");
  let current = variables;
  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function scalarTemplateValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

export function renderDeterministicTemplate(input) {
  const unresolved = new Set();
  const template = String(input?.template ?? "");
  const variables = isRecord(input?.variables) ? input.variables : {};
  const rendered = template.replace(PLACEHOLDER_PATTERN, (placeholder, variableName) => {
    const value = scalarTemplateValue(readTemplateVariable(variables, variableName));
    if (value == null) {
      unresolved.add(variableName);
      return placeholder;
    }
    return value;
  });
  return {
    rendered,
    unresolved: [...unresolved].sort(),
  };
}

export function parseAudienceRows(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (Array.isArray(parsed)) return parsed;
  if (isRecord(parsed) && Array.isArray(parsed.audience)) return parsed.audience;
  if (isRecord(parsed) && Array.isArray(parsed.rows)) return parsed.rows;
  throw new Error("Audience must be a JSON array, or an object with audience or rows.");
}

function rowEmail(row) {
  if (!isRecord(row)) return "";
  const value = row.email ?? row.emailAddress ?? row.email_address;
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDecisionIds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 25);
}

export function validateDraft(input) {
  const draft = normalizeDraftInput(input);
  const variables = extractTemplateVariables(
    draft.subjectTemplate,
    draft.textTemplate,
    draft.htmlTemplate,
  );
  const audienceArtifactRef =
    normalizeArtifactRef(draft.audienceArtifactRef, "json") ||
    refFromDraftFields(draft, "audienceArtifact", "json");
  const hasAudienceInput =
    draft.audience !== undefined ||
    draft.audienceText !== undefined ||
    draft.sampleAudience !== undefined;
  const audience = hasAudienceInput
    ? parseAudienceRows(draft.audience ?? draft.audienceText ?? draft.sampleAudience)
    : audienceArtifactRef
      ? [syntheticAudienceRow(variables, draft.sampleVariables)]
      : [];
  if (!audience.length) {
    throw new Error("Audience must include at least one sample row.");
  }
  const invalidRows = audience
    .map((row, index) => ({ index, email: rowEmail(row) }))
    .filter((row) => !row.email);
  if (invalidRows.length) {
    throw new Error("Every audience row must include email, emailAddress, or email_address.");
  }
  const firstRow = isRecord(audience[0]) ? audience[0] : {};
  const subjectPreview = renderDeterministicTemplate({
    template: draft.subjectTemplate,
    variables: firstRow,
  });
  const textPreview = renderDeterministicTemplate({
    template: draft.textTemplate,
    variables: firstRow,
  });
  const htmlPreview = draft.htmlTemplate
    ? renderDeterministicTemplate({
        template: draft.htmlTemplate,
        variables: firstRow,
      })
    : { rendered: "", unresolved: [] };
  const missingVariables = [
    ...new Set([
      ...subjectPreview.unresolved,
      ...textPreview.unresolved,
      ...htmlPreview.unresolved,
    ]),
  ].sort();

  return {
    variables,
    audience,
    audienceArtifactRef,
    artifactBackedAudience: !hasAudienceInput && Boolean(audienceArtifactRef),
    selectedAudienceRow: firstRow,
    missingVariables,
    preview: {
      subject: subjectPreview.rendered,
      text: textPreview.rendered,
      html: htmlPreview.rendered,
    },
  };
}

function dropUndefined(value) {
  if (Array.isArray(value)) return value.map(dropUndefined);
  if (!isRecord(value)) return value;
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested === undefined || nested === "") continue;
    out[key] = dropUndefined(nested);
  }
  return out;
}

export function buildCampaignPayload(input, options = {}) {
  const draft = normalizeDraftInput(input);
  const validation = validateDraft(draft);
  const testOnly = options.testOnly !== false;
  const useAudienceArtifact =
    Boolean(options.audienceArtifactRef || draft.audienceArtifactRef || draft.audienceArtifactPath);
  const useHtmlArtifact =
    Boolean(options.htmlTemplateArtifactRef || draft.htmlTemplateArtifactRef || draft.htmlArtifactPath);
  const audience = useAudienceArtifact
    ? undefined
    : testOnly
      ? [validation.selectedAudienceRow]
      : validation.audience;
  const variables = validation.variables;
  const providedAudienceRef =
    normalizeArtifactRef(options.audienceArtifactRef, options.audienceArtifactFormat) ||
    normalizeArtifactRef(draft.audienceArtifactRef, draft.audienceArtifactFormat) ||
    refFromDraftFields(draft, "audienceArtifact", "json");
  const providedHtmlRef =
    normalizeArtifactRef(options.htmlTemplateArtifactRef, "html") ||
    normalizeArtifactRef(draft.htmlTemplateArtifactRef, "html") ||
    refFromDraftFields(draft, "htmlArtifact", "html");
  const audienceArtifactRef = useAudienceArtifact
    ? dropUndefined({
        ...(providedAudienceRef ?? {}),
        source: providedAudienceRef?.source || "workspace_file",
        format:
          providedAudienceRef?.format ||
          draft.audienceArtifactFormat ||
          options.audienceArtifactFormat ||
          "json",
        workspacePath:
          providedAudienceRef?.workspacePath ||
          options.audienceArtifactPath ||
          draft.audienceArtifactPath ||
          options.workspacePath,
        workspaceFileId:
          providedAudienceRef?.workspaceFileId ||
          options.audienceArtifactFileId ||
          draft.audienceArtifactFileId ||
          options.workspaceFileId,
        sha256:
          providedAudienceRef?.sha256 ||
          options.audienceArtifactSha256 ||
          draft.audienceArtifactSha256,
      })
    : {
        source: "mcpviews-email-deliverability-plugin",
        workspacePath: options.workspacePath,
        workspaceFileId: options.workspaceFileId,
      };
  const htmlTemplateArtifactRef = useHtmlArtifact
    ? dropUndefined({
        ...(providedHtmlRef ?? {}),
        source: providedHtmlRef?.source || "workspace_file",
        format: providedHtmlRef?.format || "html",
        workspacePath:
          providedHtmlRef?.workspacePath || options.htmlArtifactPath || draft.htmlArtifactPath,
        workspaceFileId:
          providedHtmlRef?.workspaceFileId || options.htmlArtifactFileId || draft.htmlArtifactFileId,
        sha256:
          providedHtmlRef?.sha256 || options.htmlArtifactSha256 || draft.htmlArtifactSha256,
      })
    : undefined;

  return dropUndefined({
    name: String(draft.name || draft.templateName || "Email template test").trim(),
    sendingIdentityId: draft.sendingIdentityId,
    fromEmail: draft.fromEmail,
    templateKey: draft.templateKey,
    templateName: draft.templateName || draft.name,
    subjectTemplate: draft.subjectTemplate,
    textTemplate: draft.textTemplate,
    htmlTemplate: useHtmlArtifact ? undefined : draft.htmlTemplate || undefined,
    htmlTemplateArtifactRef,
    audience,
    audienceArtifactRef,
    decidrProjectId: draft.decidrProjectId,
    decidrDecisionIds: normalizeDecisionIds(draft.decidrDecisionIds),
    metadata: {
      source: "mcpviews-email-deliverability-plugin",
      stage: testOnly ? "template-test" : "campaign-draft",
      artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
      variables,
      workspacePath: options.workspacePath,
      workspaceFileId: options.workspaceFileId,
      audienceArtifactRef,
      htmlTemplateArtifactRef,
      campaignDraftArtifactRef: draft.campaignDraftArtifactRef,
    },
    maxRecipients: testOnly ? 1 : undefined,
  });
}

export function stableJsonStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
    .join(",")}}`;
}

export function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function buildDraftArtifact(input, options = {}) {
  const draft = normalizeDraftInput(input);
  const validation = validateDraft(draft);
  const campaignPayload = buildCampaignPayload(draft, {
    testOnly: true,
    workspacePath: options.workspacePath,
    workspaceFileId: options.workspaceFileId,
  });
  const contentHash = sha256Hex(
    stableJsonStringify({
      subjectTemplate: draft.subjectTemplate,
      textTemplate: draft.textTemplate,
      htmlTemplate: draft.htmlTemplate || null,
      audience: validation.audience,
      fromEmail: draft.fromEmail || null,
      sendingIdentityId: draft.sendingIdentityId || null,
    }),
  );

  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    source: "mcpviews-email-deliverability-plugin",
    createdAt: options.createdAt || new Date().toISOString(),
    contentHash,
    context: dropUndefined({
      organizationId: options.organizationId || draft.organizationId,
      workspaceId: options.workspaceId || draft.workspaceId,
      projectId: options.projectId || draft.projectId,
      threadId: options.threadId || draft.threadId,
    }),
    template: dropUndefined({
      name: draft.name || draft.templateName,
      key: draft.templateKey,
      fromEmail: draft.fromEmail,
      sendingIdentityId: draft.sendingIdentityId,
      subjectTemplate: draft.subjectTemplate,
      textTemplate: draft.textTemplate,
      htmlTemplate: draft.htmlTemplate || undefined,
      variables: validation.variables,
    }),
    sampleAudience: validation.audience,
    preview: validation.preview,
    personaTest: {
      testTo: draft.testTo || "",
      campaignPayload,
      tools: [
        "email_campaign_prepare",
        "email_campaign_preview",
        "email_campaign_test_send",
      ],
      forbiddenTools: [
        "email_campaign_review_propose",
        "email_campaign_send_apply",
      ],
    },
    campaignWorkflow: {
      testTo: draft.testTo || "",
      campaignPayload: buildCampaignPayload(draft, {
        testOnly: false,
        workspacePath: options.workspacePath,
        workspaceFileId: options.workspaceFileId,
      }),
      tools: [
        "email_campaign_prepare",
        "email_campaign_preview",
        "email_campaign_test_send",
        "email_campaign_review_propose",
        "email_campaign_send_apply",
        "email_campaign_status",
      ],
      approvalRequired: true,
    },
    provenance: dropUndefined({
      workspacePath: options.workspacePath,
      workspaceFileId: options.workspaceFileId,
    }),
  };
}

export function buildPersonaTestPrompt(input, options = {}) {
  const draft = normalizeDraftInput(input);
  const validation = validateDraft(draft);
  if (validation.missingVariables.length) {
    throw new Error(
      `Sample row is missing variables: ${validation.missingVariables.join(", ")}`,
    );
  }
  const testTo = typeof draft.testTo === "string" ? draft.testTo.trim() : "";
  if (!testTo) {
    throw new Error("A test recipient email is required.");
  }
  const campaignPayload = buildCampaignPayload(draft, {
    testOnly: true,
    workspacePath: options.workspacePath,
    workspaceFileId: options.workspaceFileId,
  });
  const prompt = [
    "Prepare exactly one deterministic email campaign snapshot and send exactly one test email.",
    "",
    "Use only these email deliverability tools in this order:",
    "1. email_campaign_prepare with the JSON payload below.",
    "2. email_campaign_preview with the returned campaignId and limit 1.",
    `3. email_campaign_test_send with the returned campaignId and testTo ${JSON.stringify(testTo)}.`,
    "",
    "Do not call email_campaign_review_propose.",
    "Do not call email_campaign_send_apply.",
    "Do not send a production campaign.",
    "Do not modify the templates, audience row, sender, or test recipient after preparation.",
    "",
    options.workspacePath
      ? `Workspace draft artifact: ${options.workspacePath}`
      : "Workspace draft artifact: not provided.",
    "",
    "email_campaign_prepare payload:",
    "```json",
    JSON.stringify(campaignPayload, null, 2),
    "```",
    "",
    "After the tool calls, summarize the campaignId, snapshotHash if present, preview count, and test-send result. Do not include raw rendered body content in the summary.",
  ].join("\n");

  return {
    prompt,
    campaignPayload,
    testTo,
    variables: validation.variables,
    preview: validation.preview,
  };
}

export function buildPersonaCampaignPrompt(input, options = {}) {
  const draft = normalizeDraftInput(input);
  const validation = validateDraft(draft);
  if (validation.missingVariables.length) {
    throw new Error(
      `Sample row is missing variables: ${validation.missingVariables.join(", ")}`,
    );
  }
  const testTo = typeof draft.testTo === "string" ? draft.testTo.trim() : "";
  const campaignPayload = buildCampaignPayload(draft, {
    testOnly: false,
    workspacePath: options.workspacePath,
    workspaceFileId: options.workspaceFileId,
    audienceArtifactPath: options.audienceArtifactPath,
    audienceArtifactFileId: options.audienceArtifactFileId,
    audienceArtifactFormat: options.audienceArtifactFormat,
    audienceArtifactSha256: options.audienceArtifactSha256,
    htmlArtifactPath: options.htmlArtifactPath,
    htmlArtifactFileId: options.htmlArtifactFileId,
    htmlArtifactSha256: options.htmlArtifactSha256,
  });
  const prompt = [
    "Prepare a deterministic email campaign from the payload below, preview it, send one test email if testTo is provided, then open an MCPViews approval review for production send.",
    "",
    "Use these email deliverability tools in order:",
    "1. email_campaign_prepare with the JSON payload below.",
    "2. email_campaign_preview with the returned campaignId and limit 3.",
    testTo
      ? `3. email_campaign_test_send with the returned campaignId and testTo ${JSON.stringify(testTo)}.`
      : "3. Skip email_campaign_test_send because no testTo was provided.",
    "4. email_campaign_review_propose with the campaignId.",
    "5. Wait for the MCPViews review to be accepted before calling email_campaign_send_apply.",
    "6. After accepted approval only, call email_campaign_send_apply with confirmed=true and the accepted reviewSessionId.",
    "7. Call email_campaign_status and summarize redacted counts, artifact refs, and hashes.",
    "",
    "Do not modify templates, sender, audience, artifact refs, or hashes after preparation.",
    "Do not include raw rendered body content or recipient emails in the final summary.",
    "",
    options.workspacePath
      ? `Workspace draft artifact: ${options.workspacePath}`
      : "Workspace draft artifact: not provided.",
    "",
    "email_campaign_prepare payload:",
    "```json",
    JSON.stringify(campaignPayload, null, 2),
    "```",
  ].join("\n");

  return {
    prompt,
    campaignPayload,
    testTo,
    variables: validation.variables,
    preview: validation.preview,
  };
}

export function buildPersonaTemplateRevisionPrompt(input, options = {}) {
  const raw = isRecord(input) ? input : {};
  const draft = normalizeDraftInput(input);
  const revisionRequest = stringValue(
    options.revisionRequest || raw.revisionRequest || raw.prompt,
  );
  const artifactPath = stringValue(
    options.htmlArtifactPath || draft.htmlArtifactPath || raw.workspacePath,
  );
  const artifactFileId = stringValue(
    options.htmlArtifactFileId || draft.htmlArtifactFileId || raw.workspaceFileId,
  );
  const artifactSha256 = stringValue(
    options.htmlArtifactSha256 || draft.htmlArtifactSha256 || raw.sha256,
  ).replace(/^sha256:/i, "");
  const searchQuery =
    stringValue(options.searchQuery || raw.searchQuery) ||
    artifactPath.split("/").pop() ||
    draft.name ||
    draft.templateName ||
    "";
  if (!revisionRequest) {
    throw new Error("A revisionRequest is required.");
  }
  if (!artifactPath && !searchQuery) {
    throw new Error(
      "A selected template artifact path or search query is required for revision.",
    );
  }
  const artifactRef = dropUndefined({
    source: "workspace_file",
    format: "html",
    workspacePath: artifactPath,
    workspaceFileId: artifactFileId,
    sha256: artifactSha256,
  });
  const prompt = [
    "Revise an existing durable HTML email template artifact in place.",
    "",
    "Use only these artifact tools for the revision:",
    "1. email_template_artifact_search to find and read the current template artifact. Use includeContent=true.",
    "2. email_template_artifact_update with the same workspacePath and the current sha256 as expectedSha256.",
    "",
    "Do not call email_template_artifact_create unless the user explicitly asks for a copy or new variant.",
    "Do not create a new file path for a revision.",
    "Do not call campaign prepare, preview, test send, review, or send tools.",
    "Return the workspacePath, workspaceFileId, previousSha256, new sha256, variables, and a short summary of the edits.",
    "",
    "Revision request:",
    revisionRequest,
    "",
    artifactPath || artifactFileId || artifactSha256
      ? "Selected template artifact ref:"
      : "No exact artifact ref was provided; search for the template first.",
    artifactPath || artifactFileId || artifactSha256
      ? "```json"
      : "",
    artifactPath || artifactFileId || artifactSha256
      ? JSON.stringify(artifactRef, null, 2)
      : "",
    artifactPath || artifactFileId || artifactSha256
      ? "```"
      : "",
    "",
    "Suggested search:",
    "```json",
    JSON.stringify(
      dropUndefined({
        query: searchQuery,
        prefix: artifactPath
          ? artifactPath.split("/").slice(0, -1).join("/") || "email/templates"
          : "email/templates",
        includeContent: true,
        limit: 10,
      }),
      null,
      2,
    ),
    "```",
  ].filter((line) => line !== "").join("\n");

  return {
    prompt,
    artifactRef,
    revisionRequest,
    searchQuery,
  };
}

export function slugify(value) {
  const slug = String(value || "email-template")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "email-template";
}
