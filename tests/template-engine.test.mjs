import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCampaignPayload,
  buildDraftArtifact,
  buildPersonaCampaignPrompt,
  buildPersonaTemplateRevisionPrompt,
  buildPersonaTestPrompt,
  extractTemplateVariables,
  normalizeDraftInput,
  renderDeterministicTemplate,
  validateDraft,
} from "../src/template-engine.mjs";

const baseDraft = {
  name: "Renewal notice",
  fromEmail: "hello@example.com",
  subjectTemplate: "Hi {{first_name}}, {{company.name}} renewal",
  textTemplate: "Hello {{ first_name }}, your renewal is {{renewal_date}}.",
  htmlTemplate: "<p>Hello {{first_name}}</p>",
  audience: [
    {
      email: "customer@example.com",
      first_name: "Avery",
      renewal_date: "June 1",
      company: { name: "Northstar" },
    },
  ],
  testTo: "ops@example.com",
};

test("extracts placeholders with the platform grammar", () => {
  assert.deepEqual(
    extractTemplateVariables("{{first_name}} {{ company.name }} {{bad space}} {{_ok-1}}"),
    ["_ok-1", "company.name", "first_name"],
  );
});

test("renders scalar values deterministically and reports unresolved variables", () => {
  const rendered = renderDeterministicTemplate({
    template: "Hello {{first_name}}, paid={{paid}}, missing={{missing}}",
    variables: { first_name: "Avery", paid: true },
  });
  assert.equal(rendered.rendered, "Hello Avery, paid=true, missing={{missing}}");
  assert.deepEqual(rendered.unresolved, ["missing"]);
});

test("validates audience rows and previews the first row", () => {
  const result = validateDraft(baseDraft);
  assert.deepEqual(result.variables, ["company.name", "first_name", "renewal_date"]);
  assert.deepEqual(result.missingVariables, []);
  assert.equal(result.preview.subject, "Hi Avery, Northstar renewal");
});

test("blocks persona prompt generation when the sample row is missing variables", () => {
  assert.throws(
    () =>
      buildPersonaTestPrompt({
        ...baseDraft,
        audience: [{ email: "customer@example.com", first_name: "Avery" }],
      }),
    /missing variables: company\.name, renewal_date/,
  );
});

test("builds a one-recipient campaign payload for persona test sends", () => {
  const payload = buildCampaignPayload({
    ...baseDraft,
    audience: [
      ...baseDraft.audience,
      { email: "second@example.com", first_name: "Blake", renewal_date: "July 1", company: { name: "Southstar" } },
    ],
  });
  assert.equal(payload.maxRecipients, 1);
  assert.equal(payload.audience.length, 1);
  assert.equal(payload.metadata.stage, "template-test");
});

test("builds an artifact-backed campaign payload for approval-gated sends", () => {
  const payload = buildCampaignPayload(
    {
      ...baseDraft,
      audienceArtifactPath: "email/audiences/renewal.csv",
      audienceArtifactFormat: "csv",
      htmlArtifactPath: "email/templates/renewal.html",
      htmlArtifactSha256: "html_hash",
    },
    { testOnly: false },
  );
  assert.equal(payload.maxRecipients, undefined);
  assert.equal(payload.audience, undefined);
  assert.equal(payload.audienceArtifactRef.source, "workspace_file");
  assert.equal(payload.audienceArtifactRef.format, "csv");
  assert.equal(payload.htmlTemplate, undefined);
  assert.equal(payload.htmlTemplateArtifactRef.workspacePath, "email/templates/renewal.html");
});

test("builds a workspace artifact with provenance and forbidden production tools", () => {
  const artifact = buildDraftArtifact(baseDraft, {
    workspaceId: "workspace_1",
    workspacePath: "email/deliverability/templates/renewal.json",
  });
  assert.equal(artifact.schemaVersion, "tribex.emailTemplateDraft.v1");
  assert.equal(artifact.context.workspaceId, "workspace_1");
  assert.equal(artifact.personaTest.forbiddenTools.includes("email_campaign_send_apply"), true);
  assert.equal(artifact.campaignWorkflow.approvalRequired, true);
  assert.equal(typeof artifact.contentHash, "string");
});

test("builds a safety-scoped persona prompt", () => {
  const result = buildPersonaTestPrompt(baseDraft, {
    workspacePath: "email/deliverability/templates/renewal.json",
  });
  assert.match(result.prompt, /email_campaign_prepare/);
  assert.match(result.prompt, /email_campaign_test_send/);
  assert.match(result.prompt, /Do not call email_campaign_send_apply/);
  assert.equal(result.campaignPayload.audience.length, 1);
});

test("builds an approval-gated campaign persona prompt", () => {
  const result = buildPersonaCampaignPrompt(
    {
      ...baseDraft,
      audienceArtifactPath: "email/audiences/renewal.json",
    },
    {
      workspacePath: "email/deliverability/templates/renewal.json",
    },
  );
  assert.match(result.prompt, /email_campaign_review_propose/);
  assert.match(result.prompt, /Wait for the MCPViews review to be accepted/);
  assert.match(result.prompt, /email_campaign_send_apply/);
  assert.equal(result.campaignPayload.audience, undefined);
  assert.equal(result.campaignPayload.audienceArtifactRef.source, "workspace_file");
});

test("builds an in-place template revision prompt with artifact hash guard", () => {
  const result = buildPersonaTemplateRevisionPrompt({
    revisionRequest: "Restyle with Ivy Energy colors.",
    htmlArtifactPath: "email/templates/chibigen-ai-startup-template.html",
    htmlArtifactFileId: "file_html",
    htmlArtifactSha256: "a".repeat(64),
  });

  assert.match(result.prompt, /email_template_artifact_search/);
  assert.match(result.prompt, /email_template_artifact_update/);
  assert.match(result.prompt, /same workspacePath/);
  assert.match(result.prompt, /expectedSha256/);
  assert.equal(
    result.artifactRef.workspacePath,
    "email/templates/chibigen-ai-startup-template.html",
  );
});

test("normalizes runtime campaign draft artifact output for approval-gated prompts", () => {
  const runtimeDraft = {
    campaignDraftArtifactRef: {
      source: "workspace_file",
      format: "json",
      workspacePath: "email/campaigns/renewal.campaign.json",
      workspaceFileId: "file_campaign",
      sha256: "campaign_hash",
    },
    campaignPreparePayload: {
      name: "Renewal notice",
      fromEmail: "hello@example.com",
      subjectTemplate: "Hi {{first_name}}",
      textTemplate: "Hello {{first_name}}",
      htmlTemplateArtifactRef: {
        source: "workspace_file",
        format: "html",
        workspacePath: "email/templates/renewal.html",
        workspaceFileId: "file_html",
        sha256: "html_hash",
      },
      audienceArtifactRef: {
        source: "workspace_file",
        format: "json",
        workspacePath: "email/audiences/renewal.audience.json",
        workspaceFileId: "file_audience",
        sha256: "audience_hash",
      },
    },
  };

  const normalized = normalizeDraftInput(runtimeDraft);
  assert.equal(normalized.workspacePath, "email/campaigns/renewal.campaign.json");
  assert.equal(normalized.htmlArtifactPath, "email/templates/renewal.html");
  assert.equal(normalized.audienceArtifactPath, "email/audiences/renewal.audience.json");

  const validation = validateDraft(runtimeDraft);
  assert.equal(validation.artifactBackedAudience, true);
  assert.deepEqual(validation.missingVariables, []);

  const result = buildPersonaCampaignPrompt(runtimeDraft, {
    workspacePath: normalized.workspacePath,
  });
  assert.equal(result.campaignPayload.audience, undefined);
  assert.equal(
    result.campaignPayload.audienceArtifactRef.workspacePath,
    "email/audiences/renewal.audience.json",
  );
  assert.equal(
    result.campaignPayload.htmlTemplateArtifactRef.workspacePath,
    "email/templates/renewal.html",
  );
  assert.match(result.prompt, /email_campaign_review_propose/);
});
