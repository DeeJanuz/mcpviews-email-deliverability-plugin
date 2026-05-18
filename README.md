# MCPViews Email Deliverability Plugin

First staged implementation for deterministic email template and campaign drafting in MCPViews.

## What This Slice Does

- Opens an `email_template_builder` renderer for template drafting.
- Extracts `{{variable}}` placeholders using the same grammar as `tribe-x-ai`.
- Validates a normalized JSON sample audience.
- Renders deterministic subject, text, and sandboxed HTML previews.
- Saves a portable JSON draft artifact to TribeX AI durable workspace storage when opened with a workspace id or resolvable thread id.
- Shows a guided start flow: select a TribeX organization, resolve/select a workspace, then load a saved template/campaign draft or create a new draft.
- Keeps the default editor focused on template creation: name, key, subject, HTML source, variables, large HTML preview, and save.
- Derives the plain text body deterministically from the HTML template; personas do not need to author a separate text template.
- Opens campaign draft outputs created by TribeX runtime tools:
  - `email_template_artifact_create`
  - `email_template_artifact_search`
  - `email_template_artifact_update`
  - `email_campaign_draft_artifact_create`
- Treats those runtime artifact tools as sandbox-write-gated; personas must have brokered `sandbox_fs_write` plus the specific email artifact grant.
- Shows workspace artifact refs and hashes for HTML templates, audience files, and campaign drafts.
- Searches TribeX AI durable workspace storage by path under `email/` and loads HTML template, audience, or campaign draft artifacts into the builder.
- Asks a TribeX AI persona to run exactly one test-send flow through:
  - `email_campaign_prepare`
  - `email_campaign_preview`
  - `email_campaign_test_send`
- Builds approval-gated campaign handoff prompts that require:
  - `email_campaign_review_propose`
  - accepted MCPViews review
  - `email_campaign_send_apply`
- Builds template revision prompts that pass the selected HTML artifact ref and instruct personas to search/read the existing template, then update the same workspace path with an expected SHA-256 guard.
- Provides AI edit mode for rendered HTML blocks:
  - select blocks in the preview;
  - attach compact DOM metadata and a comment;
  - submit one batch prompt to the plugin-specific `email-template-visual-editor` persona.
- Provides manual edit mode for direct rendered-text edits, then regenerates the plain text body deterministically from the updated HTML.

Production send execution remains human gated. The plugin never sends production email directly.

Campaign sender, audience, DecidR, artifact hash, and persona handoff details are intentionally kept out of the default template-editing view. They remain platform concerns for the campaign workflow rather than primary fields for template creation.

## Run Locally

```bash
npm run check
npm test
node src/server.mjs
```

The local MCP endpoint is:

```text
http://127.0.0.1:4885/mcp
```

Install `manifest.json` in MCPViews as a local plugin while developing.

## Renderer Payload

Use `push_content` with `tool_name: "email_template_builder"`:

```json
{
  "thread_id": "thread_id_optional",
  "workspace_id": "workspace_id_optional",
  "draft": {
    "name": "Renewal notice",
    "fromEmail": "hello@example.com",
    "subjectTemplate": "Hi {{first_name}}",
    "textTemplate": "Hello {{first_name}}",
    "audience": [
      {
        "email": "customer@example.com",
        "first_name": "Avery"
      }
    ],
    "testTo": "operator@example.com"
  }
}
```

The test-send action requires both a thread id and workspace id. If only a thread id is supplied, the renderer attempts to resolve the workspace from the TribeX AI thread before saving.

The renderer and persona prompt tools also accept the output of `email_campaign_draft_artifact_create` as `draft`; they normalize the nested `campaignPreparePayload`, `campaignDraftArtifactRef`, `htmlTemplateArtifactRef`, and `audienceArtifactRef` into campaign builder fields without requiring raw audience rows.

## Guided Start Flow

When the builder opens inside an authenticated MCPViews AI session, it uses `window.__tribexAiClient` to discover available organizations. If it has a thread id, it first resolves the thread to its organization, workspace, and project context. The first visible controls are:

1. Select org.
2. Select a saved template or campaign draft.
3. Create new.

Saved template choices are loaded from durable workspace storage under:

- `email/templates/`
- `email/campaigns/`
- `email/deliverability/templates/`

The lower workspace artifact search remains available for targeted path lookup, but the guided picker is the primary workflow.

## Workspace Artifact Search

When opened with a `workspace_id`, or with a `thread_id` that can resolve to a workspace, the builder can search durable workspace files by path. Use the Workspace artifacts search box with paths such as:

- `email/`
- `email/templates/`
- `email/campaigns/`
- `email/audiences/`
- `email/templates/my-template.html`

Loading an HTML artifact fills the HTML editor and preserves its workspace ref/hash for prepare. Loading a campaign draft JSON artifact fills the campaign fields and attempts to pull the referenced HTML template for preview. Loading an audience artifact fills the audience ref fields and previews JSON rows when possible.

## Latest Dev Smoke

On 2026-05-17, after deploying the TribeX AI dev runtime and control plane, a fresh MCPViews thread named `Email revision smoke` validated the in-place template revision workflow:

- `email_template_artifact_create` created `email/templates/codex-in-place-revision-smoke.html`.
- `email_template_artifact_update` revised the same path with an expected SHA-256 guard.
- `email_template_artifact_search` returned exactly one match for that path with the updated SHA.

The preserved path was `email/templates/codex-in-place-revision-smoke.html`; the SHA advanced from `e697ee7753a0d9395928f3aa059bcd84104ed53a602e079685351ecf5cddbf79` to `79f1e40b1dc68bd133fbeed8fd2fb0d63670c0bc6361073ed89fe9ea40025bd0`.

The older `Test2` thread retained stale desktop relay catalog bearer metadata after deployment, so use a fresh authenticated MCPViews AI thread when validating a newly deployed runtime.

## 2026-05-18 Visual Builder Update

The builder now includes a first local slice of the visual HTML editing workflow:

- `email-template-visual-edit-prompt` builds metadata-only visual edit prompts for the stable `email-template-visual-editor` persona.
- AI edit mode opens a fixed left edit drawer, queues block comments, keeps technical DOM details collapsed by default, and submits one persona-mediated edit batch.
- Manual edit mode lets users edit text directly in the rendered preview, save those edits back into the HTML source, and sync the plain text preview automatically.
- Visual edits remain same-path and SHA-guarded. The persona is instructed to use artifact search/update tools and avoid campaign send tools.

Validation for this slice:

```bash
node --check renderers/email-template-builder.js
npm test
```
