import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("manifest exposes manual email campaign launcher as standalone Email Campaigns renderer", async () => {
  const manifest = JSON.parse(
    await readFile(join(__dirname, "..", "manifest.json"), "utf8"),
  );
  const launcher = manifest.renderer_definitions.find(
    (renderer) => renderer.name === "email_campaign_launcher",
  );

  assert.equal(manifest.renderers["email-campaign-launcher-open"], "email_campaign_launcher");
  assert.ok(launcher);
  assert.equal(launcher.standalone, true);
  assert.equal(launcher.standalone_label, "Email Campaigns");
  assert.deepEqual(launcher.tools, ["email-campaign-launcher-open"]);
  assert.doesNotMatch(launcher.data_hint, /fromEmail|sendingIdentityId/);
  assert.ok(manifest.registry_index.renderer_names.includes("email_campaign_launcher"));
});

test("manifest publishes a versioned release download URL", async () => {
  const manifest = JSON.parse(
    await readFile(join(__dirname, "..", "manifest.json"), "utf8"),
  );

  assert.equal(manifest.version, "0.1.1");
  assert.equal(
    manifest.download_url,
    "https://github.com/DeeJanuz/mcpviews-email-deliverability-plugin/releases/download/0.1.1/email-deliverability.zip",
  );
});

test("manifest exposes campaign history as standalone Campaign History renderer", async () => {
  const manifest = JSON.parse(
    await readFile(join(__dirname, "..", "manifest.json"), "utf8"),
  );
  const history = manifest.renderer_definitions.find(
    (renderer) => renderer.name === "email_campaign_history",
  );

  assert.equal(manifest.renderers["email-campaign-history-open"], "email_campaign_history");
  assert.ok(history);
  assert.equal(history.standalone, true);
  assert.equal(history.standalone_label, "Campaign History");
  assert.deepEqual(history.tools, ["email-campaign-history-open"]);
  assert.match(history.description, /opens, opt-outs, link clicks, bounces, send times/);
  assert.ok(manifest.registry_index.renderer_names.includes("email_campaign_history"));
});

test("campaign launcher renderer exposes context discovery, database draft open, and detail helpers", async () => {
  const renderer = await readFile(
    join(__dirname, "..", "renderers", "email-campaign-launcher.js"),
    "utf8",
  );

  assert.match(renderer, /data-select="organizationId"/);
  assert.match(renderer, /data-select="workspaceId"/);
  assert.match(renderer, /fetchOrganizations/);
  assert.match(renderer, /fetchWorkspaces/);
  assert.match(renderer, /Drafted campaign/);
  assert.match(renderer, /Open Draft/);
  assert.match(renderer, /Refresh Drafts/);
  assert.doesNotMatch(renderer, /Clone Draft/);
  assert.doesNotMatch(renderer, /Open Prepared/);
  assert.doesNotMatch(renderer, /campaignDraftRef/);
  assert.match(renderer, /Create Folder/);
  assert.match(renderer, /temporary_inline_prepare/);
  assert.match(renderer, /email-launcher-stepper/);
  assert.match(renderer, /Support details/);
  assert.match(renderer, /data-role="save-dialog"/);
  assert.match(renderer, /data-role="workflow-body"/);
  assert.match(renderer, /Auto-fill Details/);
  assert.match(renderer, /Review Summary/);
  assert.match(renderer, /Scheduling from this plugin UI approves the send/);
  assert.match(renderer, /Refresh Status/);
  assert.match(renderer, /refresh-status/);
  assert.match(renderer, /hydratePreparedCampaignStatus/);
  assert.match(renderer, /wizardStepForPreparedCampaign/);
  assert.match(renderer, /templateVersion\.textTemplate/);
  assert.match(renderer, /labelWithTip/);
  assert.doesNotMatch(renderer, /push_review/);
  assert.doesNotMatch(renderer, /backendCallback/);
  assert.doesNotMatch(renderer, /data-field="fromEmail"/);
  assert.doesNotMatch(renderer, /data-field="sendingIdentityId"/);
  assert.doesNotMatch(renderer, /data-role="review-token-input"/);
  assert.doesNotMatch(renderer, /data-field="saveFolder"/);
  assert.doesNotMatch(renderer, /data-field="newFolderPath"/);
});

test("campaign history renderer lists delivery stats and calls platform history API", async () => {
  const renderer = await readFile(
    join(__dirname, "..", "renderers", "email-campaign-history.js"),
    "utf8",
  );

  assert.match(renderer, /window\.__renderers\.email_campaign_history/);
  assert.match(renderer, /Campaign History/);
  assert.match(renderer, /Refresh History/);
  assert.match(renderer, /opens/i);
  assert.match(renderer, /Link clicks/);
  assert.match(renderer, /Opt outs/);
  assert.match(renderer, /Bounces/);
  assert.match(renderer, /--glass-bg/);
  assert.match(renderer, /--accent-primary:#818cf8/);
  assert.match(renderer, /selectChevronDark/);
  assert.match(renderer, /prefers-color-scheme:light/);
  assert.match(renderer, /\/api\/mcpviews\/email-deliverability\/campaigns\/history/);
  assert.match(renderer, /\/api\/internal\/runtime\/email-deliverability\/campaigns\/history/);
});

test("campaign launcher auto-loads the Campaign Library after workspace context is selected", async () => {
  const renderer = await readFile(
    join(__dirname, "..", "renderers", "email-campaign-launcher.js"),
    "utf8",
  );

  assert.match(renderer, /function loadWorkspaceScopedResources\(\)/);
  assert.match(renderer, /if \(state\.workspaceId\) return loadWorkspaceScopedResources\(\);/);
  assert.match(renderer, /if \(state\.workspaceId\) runAction\('load-workspace-resources'\);/);
  assert.match(renderer, /if \(action === 'load-workspace-resources'\) promise = loadWorkspaceScopedResources\(\);/);
  assert.match(renderer, /return listPreparedCampaigns\(\);/);
  assert.doesNotMatch(renderer, /state\.workspaceId && typeof api\.listWorkspaceFiles === 'function'/);
});
