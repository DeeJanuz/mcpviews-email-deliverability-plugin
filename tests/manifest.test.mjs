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

test("compat manifest routes campaign history to Email Performance renderer", async () => {
  const manifest = JSON.parse(
    await readFile(join(__dirname, "..", "manifest.json"), "utf8"),
  );
  const performance = manifest.renderer_definitions.find(
    (renderer) => renderer.name === "email_performance_dashboard",
  );

  assert.equal(manifest.renderers["email-campaign-history-open"], "email_performance_dashboard");
  assert.equal(manifest.renderers["email-performance-dashboard-open"], "email_performance_dashboard");
  assert.ok(performance);
  assert.equal(performance.standalone, true);
  assert.equal(performance.standalone_label, "Email Performance");
  assert.deepEqual(performance.tools, [
    "email-campaign-history-open",
    "email-performance-dashboard-open",
  ]);
  assert.match(performance.description, /campaigns and tracked one-off emails/);
  assert.ok(manifest.registry_index.renderer_names.includes("email_performance_dashboard"));
});

test("split manifests expose campaign and performance plugin prefixes", async () => {
  const campaigns = JSON.parse(
    await readFile(join(__dirname, "..", "manifest.email-campaigns.json"), "utf8"),
  );
  const performance = JSON.parse(
    await readFile(join(__dirname, "..", "manifest.email-performance.json"), "utf8"),
  );

  assert.equal(campaigns.name, "email-campaigns");
  assert.equal(campaigns.version, "0.2.0");
  assert.equal(
    campaigns.download_url,
    "https://github.com/DeeJanuz/mcpviews-email-deliverability-plugin/releases/download/0.2.0/email-campaigns.zip",
  );
  assert.equal(campaigns.mcp.tool_prefix, "email_campaigns__");
  assert.ok(campaigns.registry_index.renderer_names.includes("email_template_builder"));
  assert.ok(campaigns.registry_index.renderer_names.includes("email_campaign_launcher"));
  assert.equal(performance.name, "email-performance");
  assert.equal(performance.version, "0.2.0");
  assert.equal(
    performance.download_url,
    "https://github.com/DeeJanuz/mcpviews-email-deliverability-plugin/releases/download/0.2.0/email-performance.zip",
  );
  assert.equal(performance.mcp.tool_prefix, "email_performance__");
  assert.equal(
    performance.renderers["email-performance-dashboard-open"],
    "email_performance_dashboard",
  );
});

test("release automation publishes split plugin zip assets", async () => {
  const buildScript = await readFile(join(__dirname, "..", "build.sh"), "utf8");
  const workflow = await readFile(
    join(__dirname, "..", ".github", "workflows", "release.yml"),
    "utf8",
  );

  assert.match(buildScript, /email-campaigns:manifest\.email-campaigns\.json/);
  assert.match(buildScript, /email-performance:manifest\.email-performance\.json/);
  assert.match(buildScript, /\$\{PLUGIN_NAME\}\.zip/);
  assert.match(workflow, /manifest\.email-campaigns\.json/);
  assert.match(workflow, /manifest\.email-performance\.json/);
  assert.match(workflow, /release\/email-campaigns\.zip/);
  assert.match(workflow, /release\/email-performance\.zip/);
  assert.doesNotMatch(workflow, /release\/email-deliverability\.zip/);
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

test("email performance renderer lists delivery stats and calls platform history APIs", async () => {
  const renderer = await readFile(
    join(__dirname, "..", "renderers", "email-campaign-history.js"),
    "utf8",
  );

  assert.match(renderer, /window\.__renderers\.email_campaign_history/);
  assert.match(renderer, /window\.__renderers\.email_performance_dashboard/);
  assert.match(renderer, /Email Performance/);
  assert.match(renderer, /Refresh Performance/);
  assert.match(renderer, /opens/i);
  assert.match(renderer, /Link clicks/);
  assert.match(renderer, /Source/);
  assert.match(renderer, /Provider/);
  assert.match(renderer, /Bounces/);
  assert.match(renderer, /--glass-bg/);
  assert.match(renderer, /--accent-primary:#818cf8/);
  assert.match(renderer, /selectChevronDark/);
  assert.match(renderer, /prefers-color-scheme:light/);
  assert.match(renderer, /\/api\/mcpviews\/email-deliverability\/campaigns\/history/);
  assert.match(renderer, /\/api\/internal\/runtime\/email-deliverability\/campaigns\/history/);
  assert.match(renderer, /\/api\/mcpviews\/email-performance\/messages\/history/);
  assert.match(renderer, /\/api\/internal\/runtime\/email-performance\/messages\/history/);
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
