import test from "node:test";
import assert from "node:assert/strict";
import { handleRpc } from "../src/server.mjs";

test("initializes the MCP server", async () => {
  const response = await handleRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.result.serverInfo.name, "email-deliverability");
});

test("lists template utility tools", async () => {
  const response = await handleRpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  const names = response.body.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, [
    "email-template-builder-open",
    "email-template-payload-validate",
    "email-template-persona-test-prompt",
    "email-campaign-persona-prompt",
    "email-template-persona-revision-prompt",
    "email-template-visual-edit-prompt",
  ]);
});

test("prompt tool schemas allow artifact-backed campaign drafts without raw audience rows", async () => {
  const response = await handleRpc({
    jsonrpc: "2.0",
    id: 22,
    method: "tools/list",
    params: {},
  });
  const tools = Object.fromEntries(
    response.body.result.tools.map((tool) => [tool.name, tool]),
  );
  assert.equal(
    tools["email-campaign-persona-prompt"].inputSchema.required,
    undefined,
  );
  assert.equal(
    tools["email-template-persona-test-prompt"].inputSchema.required,
    undefined,
  );
  assert.ok(
    tools["email-campaign-persona-prompt"].inputSchema.properties
      .campaignPreparePayload,
  );
  assert.ok(
    tools["email-template-persona-test-prompt"].inputSchema.properties
      .audienceArtifactRef,
  );
});

test("validates template payloads through tool calls", async () => {
  const response = await handleRpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "email_deliverability__email-template-payload-validate",
      arguments: {
        subjectTemplate: "Hi {{first_name}}",
        textTemplate: "Body for {{first_name}}",
        audience: [{ email: "test@example.com", first_name: "Avery" }],
      },
    },
  });
  const payload = JSON.parse(response.body.result.content[0].text);
  assert.deepEqual(payload.variables, ["first_name"]);
  assert.equal(payload.preview.subject, "Hi Avery");
});

test("opens builder with normalized runtime campaign draft artifact output", async () => {
  const response = await handleRpc({
    jsonrpc: "2.0",
    id: 33,
    method: "tools/call",
    params: {
      name: "email-template-builder-open",
      arguments: {
        draft: {
          campaignDraftArtifactRef: {
            source: "workspace_file",
            format: "json",
            workspacePath: "email/campaigns/launch.campaign.json",
            workspaceFileId: "file_campaign",
            sha256: "campaign_hash",
          },
          campaignPreparePayload: {
            name: "Launch",
            subjectTemplate: "Hi {{first_name}}",
            textTemplate: "Hello {{first_name}}",
            audienceArtifactRef: {
              source: "workspace_file",
              format: "json",
              workspacePath: "email/audiences/launch.json",
              workspaceFileId: "file_audience",
              sha256: "audience_hash",
            },
          },
        },
      },
    },
  });
  const payload = JSON.parse(response.body.result.content[0].text);
  assert.equal(payload.draft.name, "Launch");
  assert.equal(payload.draft.workspacePath, "email/campaigns/launch.campaign.json");
  assert.equal(payload.draft.audienceArtifactPath, "email/audiences/launch.json");
  assert.equal(payload.draft.audienceArtifactSha256, "audience_hash");
});

test("returns JSON-RPC errors for unsafe prompt payloads", async () => {
  const response = await handleRpc({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "email-template-persona-test-prompt",
      arguments: {
        subjectTemplate: "Hi {{first_name}}",
        textTemplate: "Body for {{missing}}",
        audience: [{ email: "test@example.com", first_name: "Avery" }],
        testTo: "ops@example.com",
      },
    },
  });
  assert.equal(response.body.error.code, -32000);
  assert.match(response.body.error.message, /missing variables/);
});

test("builds approval-gated campaign prompts through tool calls", async () => {
  const response = await handleRpc({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "email-campaign-persona-prompt",
      arguments: {
        subjectTemplate: "Hi {{first_name}}",
        textTemplate: "Body for {{first_name}}",
        htmlTemplate: "<p>{{first_name}}</p>",
        audience: [{ email: "test@example.com", first_name: "Avery" }],
        audienceArtifactPath: "email/audiences/list.csv",
        audienceArtifactFormat: "csv",
      },
    },
  });
  const payload = JSON.parse(response.body.result.content[0].text);
  assert.match(payload.prompt, /email_campaign_review_propose/);
  assert.equal(payload.campaignPayload.audienceArtifactRef.source, "workspace_file");
});

test("builds in-place template revision prompts through tool calls", async () => {
  const response = await handleRpc({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "email-template-persona-revision-prompt",
      arguments: {
        revisionRequest: "Restyle this with the Ivy Energy palette.",
        htmlArtifactPath: "email/templates/chibigen-ai-startup-template.html",
        htmlArtifactFileId: "file_html",
        htmlArtifactSha256: "a".repeat(64),
      },
    },
  });
  const payload = JSON.parse(response.body.result.content[0].text);
  assert.match(payload.prompt, /email_template_artifact_search/);
  assert.match(payload.prompt, /email_template_artifact_update/);
  assert.match(payload.prompt, /Do not call email_template_artifact_create/);
  assert.equal(
    payload.artifactRef.workspacePath,
    "email/templates/chibigen-ai-startup-template.html",
  );
});

test("builds metadata-only visual edit prompts through tool calls", async () => {
  const response = await handleRpc({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "email-template-visual-edit-prompt",
      arguments: {
        htmlArtifactPath: "email/templates/product-launch.html",
        htmlArtifactFileId: "file_html",
        htmlArtifactSha256: "b".repeat(64),
        selections: [
          {
            selector: "body > main:nth-of-type(1) > section:nth-of-type(2)",
            domPath: "body > main:nth-of-type(1) > section:nth-of-type(2)",
            tagName: "section",
            bounds: { x: 12, y: 40, width: 560, height: 120 },
            visibleText: "The proof section",
            outerHTML: "<section><h2>Proof</h2></section>",
            snippetHash: "c".repeat(64),
            changeRequest: "Make this proof section more CFO-oriented.",
          },
        ],
      },
    },
  });
  const payload = JSON.parse(response.body.result.content[0].text);
  assert.equal(payload.targetPersonaKey, "email-template-visual-editor");
  assert.match(payload.prompt, /metadata-only selected block context/);
  assert.match(payload.prompt, /email_template_artifact_update/);
  assert.match(payload.prompt, /Do not call email_template_artifact_create/);
  assert.equal(payload.selections[0].changeRequest, "Make this proof section more CFO-oriented.");
  assert.equal(payload.artifactRef.workspacePath, "email/templates/product-launch.html");
});
