# Architecture Decision Records (ADRs)

**Manually maintained by developers when making significant architectural decisions.**

This document records important architectural decisions, their context, and rationale.

---

## How to Use ADRs

When making a significant architectural decision:
1. Add a new entry below
2. Use the template format
3. Document context, decision, and consequences
4. Update status if decision is superseded

---

## ADR Template

```markdown
## ADR-XXX: [Decision Title]
**Date:** YYYY-MM-DD
**Status:** [Proposed | Accepted | Deprecated | Superseded by ADR-YYY]
**Deciders:** [Names or roles]

### Context
[What is the issue we're facing? What factors influence this decision?]

### Decision
[What did we decide? State clearly.]

### Rationale
[Why did we make this decision? What were the alternatives?]

### Consequences
**Positive:**
- [Good outcomes from this decision]

**Negative:**
- [Drawbacks or trade-offs]

**Neutral:**
- [Other changes or effects]
```

---

## Active Decisions

### ADR-013: Split Campaign Authoring And Performance Analytics Plugins
**Date:** 2026-05-25
**Status:** Accepted
**Deciders:** Daenon Janis, Codex

#### Context
The original `email-deliverability` plugin combined template authoring, campaign launch, and campaign history into one public install surface. Email analytics now needs to cover both campaign sends and tracked one-off messages, while campaign authoring still owns template and audience workflow tools.

#### Decision
Publish two public manifests from this repository:

- `email-campaigns` exposes the template builder and manual campaign launcher with the `email_campaigns__` tool prefix.
- `email-performance` exposes the read-only `email_performance_dashboard` with the `email_performance__` tool prefix.

The legacy `email-deliverability` manifest remains a deprecated compatibility shim for existing installs. Release packaging must create separate `email-campaigns.zip` and `email-performance.zip` assets for the shared split version.

#### Rationale
Separate manifests make the installed tool surface clearer and let analytics evolve without expanding the campaign-authoring plugin. Keeping the compatibility shim protects existing local installs while new installs can choose the narrower plugin they actually need.

#### Consequences
**Positive:**
- MCPViews users see clearer plugin names and tool prefixes.
- Campaign workflow tools and performance analytics can be installed independently.
- The release workflow validates that split manifest versions stay in sync.

**Negative:**
- Build and release automation must produce multiple zip assets from one repository.

**Neutral:**
- The local MCP bridge still serves all tools from one server during development.

---

### ADR-012: Campaign History As A Read-Only Renderer
**Date:** 2026-05-19
**Status:** Accepted
**Deciders:** Daenon Janis, Codex
**DecidR / GitHub Log:** `DeeJanuz/tribe-x-ai#1`

#### Context
Manual campaign scheduling now creates database-backed campaign records, but users still need an operational history view after sends are queued. Status refresh belongs in the launcher, while cross-campaign analytics needs a separate surface with opens, opt-outs, link clicks, bounces, and send timing.

#### Decision
Add `email_campaign_history` as a standalone, read-only MCPViews renderer. The renderer loads campaign history through platform-owned database APIs, presents roll-up stats and per-campaign details, and never mutates sends or artifacts. The launcher status step gets an explicit Refresh Status action for the current campaign.

#### Rationale
Keeping history separate from launching prevents the approval/scheduling workflow from becoming crowded while still giving campaign operators the stats they need after a send. Reading from platform APIs keeps analytics consistent with the database audit trail and future provider event ingestion.

#### Consequences
**Positive:**
- Campaign operators can refresh current send status and review historical stats without raw support payloads.
- Engagement metrics have stable UI slots before provider open/click/bounce tracking is expanded.
- The renderer remains safe to open broadly because it is read-only.

**Negative:**
- The renderer depends on platform history aggregation APIs in addition to the existing status endpoint.

**Neutral:**
- Opens, clicks, and bounces are surfaced from recorded events or campaign metadata when available.

---

### ADR-011: Human-Centered Manual Campaign Launcher
**Date:** 2026-05-19
**Status:** Accepted
**Deciders:** Daenon Janis, Codex
**DecidR Decision:** `cmpcpcizd0001jo04ehszu2mr`

#### Context
The manual campaign launcher added direct artifact-backed campaign execution, but its default flow still exposed implementation details: object IDs, hashes, approval tokens, durable storage paths, raw platform responses, and dense workflow tabs. The target user is a non-technical HR manager who needs to pick a template, choose an audience, filter people, test the message, approve it, and schedule send without handling platform credentials or storage syntax.

#### Decision
Adopt the shared MCPViews renderer standard in `mcpviews/docs/human-centered-renderer-ux-principles.md` for the manual campaign launcher. The default UI will use a guided wizard, browser-style file/folder choices, in-flow approval, and support-details disclosure for raw diagnostics. Approval tokens remain backend-owned: scheduling from the plugin UI is the manual approval event, and manual apply sends only campaign and schedule data.

#### Rationale
The launcher should map to the manager's business task, not the platform's internal model. Recognition-based artifact pickers, one obvious next action, and progressive disclosure reduce errors and training burden while preserving the audit trail required for production email sends.

#### Consequences
**Positive:**
- Users no longer need to type approval tokens, object IDs, hashes, or durable storage paths.
- Filtered audience rows remain temporary unless the user explicitly saves a renamed artifact.
- Production send authority remains in the TribeX platform while the UI stays approachable.

**Negative:**
- The renderer has to maintain a richer wizard state and file-browser save surface.
- The platform must distinguish manual plugin approval from persona-mediated MCPViews review approval.

**Neutral:**
- The existing persona-fed route keeps its approval-token compatibility.

---

### ADR-009: Simplify Template Editing And Derive Plain Text
**Date:** 2026-05-17
**Status:** Accepted
**Deciders:** Daenon Janis, Codex

#### Context
The email builder exposed campaign execution plumbing directly in the template-editing flow: sender IDs, DecidR IDs, artifact hashes, audience JSON, persona prompts, and production handoff controls. This made simple template creation feel noisy and forced personas to author both HTML and plain text bodies.

#### Decision
Keep the default renderer focused on template creation: org/workspace selection, saved template selection, template name/key, subject, HTML source, variables, deterministic plain text preview, large HTML preview, and save. Move sender, audience, DecidR, artifact hash, and persona handoff fields behind advanced details or into later campaign workflow surfaces. Generate the plain text body deterministically from the HTML template.

#### Rationale
The primary user job at this stage is authoring and previewing an email template. Campaign execution details are still important, but they should not dominate the template editor. Deriving text from HTML reduces duplicated authoring work and keeps the prepare payload deterministic.

#### Consequences
**Positive:**
- The first-view editor is much easier to scan.
- Plain text is always synchronized with HTML.
- The HTML preview has enough room to inspect real email layouts.

**Negative:**
- Users who need raw artifact IDs or campaign handoff controls must open advanced details or move into the campaign workflow.

**Neutral:**
- Production sends remain persona-mediated and approval-gated.

---

### ADR-008: Guided Organization And Template Start Flow
**Date:** 2026-05-17
**Status:** Accepted
**Deciders:** Daenon Janis, Codex

#### Context
The campaign builder could load artifacts by workspace path, but the first screen still exposed too much low-level workspace/file plumbing. Users opening the builder need a natural first path: pick the organization, choose an existing email template, or start a new one. Campaign drafts are now resumed from database records after prepare, not from durable draft artifacts.

#### Decision
Add a guided start panel to `email_template_builder`. The renderer resolves thread context when available, discovers organizations and workspaces through `window.__tribexAiClient`, lists saved email templates from durable workspace storage, and offers a primary create-new action before the detailed editor controls.

#### Rationale
The org/workspace/template choice is the real task entrypoint. Keeping it inside the renderer avoids new backend endpoints while making the existing artifact search an advanced fallback instead of the main workflow.

#### Consequences
**Positive:**
- The builder opens with a clear "Select org -> Select template -> Create new" flow.
- Existing persona-authored templates are discoverable without manual file paths.
- Prepared campaign drafts are discoverable in the campaign launcher once the platform prepare step creates a database record.
- Thread-launched builder sessions can resolve the org/workspace automatically.

**Negative:**
- The renderer now depends more visibly on `window.__tribexAiClient` organization/workspace APIs.

**Neutral:**
- Production sends remain persona-mediated and approval-gated.

---

### ADR-010: In-Place Persona Revisions For Template Artifacts
**Date:** 2026-05-17
**Status:** Accepted
**Deciders:** Daenon Janis, Codex
**DecidR Decision:** `cmpacfa5c0005ld04o6ojc7iq`

#### Context
The first email drafting smoke test created `email/templates/chibigen-ai-startup-template.html`, then a follow-up revision request produced a second file instead of modifying the original. The persona had create-first instructions and no explicit revision prompt that preserved the selected artifact path/hash.

#### Decision
Add a template revision prompt helper that passes the selected HTML artifact ref to the persona and requires `email_template_artifact_search` plus `email_template_artifact_update` for revisions. Revision prompts must preserve the same `workspacePath`, use the current SHA-256 as `expectedSha256`, and forbid `email_template_artifact_create` unless the user explicitly asks for a copy or variant.

#### Rationale
The plugin is the visual selection surface, so it should hand the persona the exact durable artifact identity. The runtime remains responsible for read/update safety and HTML validation, while MCPViews avoids prompting users to copy paths and hashes by hand.

#### Consequences
**Positive:**
- Follow-up edits can update the original template artifact instead of creating confusing duplicate files.
- The selected artifact path, file id, and hash travel together in the persona prompt.
- Hash guards reduce accidental stale overwrites.

**Negative:**
- A persona still needs the runtime `email_template_artifact_search` and `email_template_artifact_update` grants to perform the edit.

**Neutral:**
- Creating new template variants remains available when explicitly requested.

---

### ADR-007: Search And Load Durable Email Artifacts
**Date:** 2026-05-17
**Status:** Accepted
**Deciders:** Daenon Janis, Codex

#### Context
Persona-created HTML templates and audience inputs live in TribeX AI durable workspace storage, while prepared campaign drafts live in the platform database. Requiring users to copy `workspacePath`, file IDs, hashes, or campaign IDs by hand makes the campaign-builder workflow fragile and too technical.

#### Decision
Add a workspace artifact search/load surface directly inside `email_template_builder`. The renderer uses the existing `window.__tribexAiClient` workspace file APIs to list files under `email/`, filter by path, download selected artifacts through signed file links, and hydrate the builder from HTML template files and audience JSON/CSV files. Prepared campaign drafts are loaded through the campaign launcher database draft library.

#### Rationale
The plugin already has authenticated workspace context when opened from a TribeX thread or workspace. Reusing that client keeps artifact discovery local to the user session, avoids adding new backend endpoints, and turns the persona artifact flow into a visible, clickable review path.

#### Consequences
**Positive:**
- Users can search by durable file path instead of manually entering artifact refs.
- Template and audience artifacts stay visible before prepare or approval handoff.
- Prepared campaign drafts can be reopened from the database-backed draft library once `email_campaign_prepare` succeeds.

**Negative:**
- Search is scoped to workspace files under `email/`; broader artifact indexing can come later if durable storage grows large.

**Neutral:**
- Production sends remain persona-mediated and approval-gated.

---

### ADR-006: Consume Runtime Prepare Payloads In Campaign Builder
**Date:** 2026-05-17
**Status:** Superseded by database-backed campaign drafts
**Deciders:** Daenon Janis, Codex

#### Context
TribeX AI exposes sandbox-write-gated persona runtime tools that create rich HTML template artifacts in durable workspace storage, while campaign drafts now live as platform database records after `email_campaign_prepare` succeeds. The MCPViews campaign builder needs to open durable template/audience inputs and database-backed prepared drafts without forcing users to retype artifact refs or reconstruct prepare payloads by hand.

#### Decision
Normalize `email_template_artifact_create` outputs and runtime `campaignPreparePayload` objects inside the plugin. The builder accepts `htmlTemplateArtifactRef` and `audienceArtifactRef`, displays their workspace paths and hashes, and uses `email_campaign_prepare` as the single boundary that creates a drafted campaign database item. Prepared drafts are reopened from the campaign library instead of from `email/campaigns/*.campaign.json`.

#### Rationale
The runtime tools are the template/audience authoring layer, while the platform database owns prepared campaign state. Keeping normalization in the plugin lets persona-created inputs flow into the same UI used for manual campaign review without giving the plugin production-send authority or maintaining duplicate campaign draft artifacts.

#### Consequences
**Positive:**
- Persona-authored HTML and audience inputs open cleanly in the campaign builder.
- Prepared campaigns become durable database drafts as soon as step 4/prepare succeeds.
- Reopening a draft resumes from the platform campaign record rather than a stale artifact snapshot.
- Production send controls remain human gated through platform tools.

**Negative:**
- The builder must tolerate prepared campaign records that do not include raw audience rows.

**Neutral:**
- Inline draft editing remains supported for smoke testing and manual workflows.

---

### ADR-005: Extend Template Builder Into Approval-Gated Campaign Builder
**Date:** 2026-05-17
**Status:** Accepted
**Deciders:** Daenon Janis, Codex

#### Context
The plugin started as a deterministic template builder for a single persona-mediated test send. V1 now needs the same renderer to support full campaigns: sender identity, rich HTML preview, audience CSV/JSON source, prepare, preview, test, MCPViews approval, send apply, and status. Production delivery still belongs in `tribe-x-ai`.

#### Decision
Extend `email_template_builder` into the campaign builder instead of creating a separate renderer. The plugin keeps editable drafts and sample previews in MCPViews, saves portable workspace artifacts, and generates exact persona prompts/tool payloads. Full campaign prompts require the persona to call prepare, preview, optional test send, `email_campaign_review_propose`, and then `email_campaign_send_apply` only after accepted MCPViews approval.

#### Rationale
One renderer keeps template drafting, variable validation, HTML preview, audience source configuration, and approval handoff in one operational surface. Personas still use the platform tools for canonical campaign freezes and production sends, so provider secrets and mutable send state never move into the plugin.

#### Consequences
**Positive:**
- Inline and artifact-backed campaign workflows use the same preview and prompt-generation surface.
- Production sends remain approval-gated and persona-mediated.
- Future CRM exports can feed the same audience artifact fields.

**Negative:**
- The renderer has more controls and must keep prompt wording strict.
- The plugin still depends on a live TribeX thread/workspace for save-plus-persona flows.

**Neutral:**
- The initial one-recipient test prompt remains available for smoke testing.

---

### ADR-004: Persona-Mediated Test Sends
**Date:** 2026-05-16
**Status:** Accepted
**Deciders:** Daenon Janis, Codex

#### Context
The first plugin slice needs a usable template-building interface that can store user-authored artifacts in TribeX AI durable workspace storage and trigger one test email. The canonical campaign ledger, sender verification, deterministic campaign preparation, and Cloudflare Email Service send path already live in `tribe-x-ai`.

#### Decision
The MCPViews plugin renderer will save portable JSON template drafts to TribeX AI workspace files through the existing `window.__tribexAiClient` workspace upload API. It will not call internal campaign send endpoints directly. For a test send, it will generate and submit a persona prompt that instructs the TribeX AI runtime to call `email_campaign_prepare`, `email_campaign_preview`, and `email_campaign_test_send` for exactly one audience row.

#### Rationale
This keeps the plugin focused on user-facing drafting and preview while leaving security-sensitive send behavior inside the approved platform service. It also preserves deterministic campaign preparation: the persona receives exact JSON payloads and is explicitly forbidden from using production send tools in this slice.

#### Consequences
**Positive:**
- Reuses the platform ledger, domain verification, suppression checks, and DecidR audit path.
- Keeps production send controls out of the initial plugin renderer.
- Produces durable workspace artifacts that future CRM workflows can reuse.

**Negative:**
- The renderer needs an active TribeX AI thread and workspace context for the full save-plus-test workflow.
- Backend template listing/version history is deferred until a later integration slice.

**Neutral:**
- The local MCP utility server remains useful for validation and prompt generation, but the rich user workflow primarily lives in the custom renderer.

---

### ADR-001: Adopt Hexagonal Architecture (Ports & Adapters)
**Date:** 2025-09-30
**Status:** Accepted
**Deciders:** Architecture Team

#### Context
We need an architecture pattern that:
- Keeps business logic isolated from frameworks
- Makes code testable
- Allows swapping infrastructure components
- Supports SOLID principles

#### Decision
Adopt Hexagonal Architecture (Ports & Adapters) pattern with:
- **Domain Layer:** Pure business logic, no dependencies
- **Application Layer:** Use cases coordinating domain objects
- **Adapter Layer:** Infrastructure implementations (DB, APIs, etc.)
- **Dependency Inversion:** All dependencies point inward toward domain

#### Rationale
**Alternatives considered:**
1. **MVC** - Too coupled to web framework, hard to test business logic
2. **Clean Architecture** - Similar to Hexagonal but more layers, added complexity
3. **Transaction Script** - Too simple, doesn't scale as complexity grows

**Why Hexagonal:**
- Clear separation of concerns
- Domain layer is framework-agnostic
- Easy to test (mock at adapter boundaries)
- Supports DDD if needed
- Aligns with SOLID principles (especially DIP)

#### Consequences
**Positive:**
- Business logic is pure and testable
- Easy to swap databases or frameworks
- Clear architectural boundaries
- Better separation of concerns

**Negative:**
- More initial boilerplate
- Steeper learning curve for new developers
- More files and folders

**Neutral:**
- Need to document patterns clearly
- Team training required

---

### ADR-002: Use TypeScript for Type Safety
**Date:** 2025-09-30
**Status:** Accepted
**Deciders:** Development Team

#### Context
We need strong type safety to:
- Catch errors at compile time
- Improve IDE autocomplete
- Document interfaces clearly
- Reduce runtime errors

#### Decision
Use TypeScript for all application code with strict mode enabled.

#### Rationale
**Alternatives:**
1. **JavaScript with JSDoc** - Types not enforced, easy to ignore
2. **Flow** - Less ecosystem support, smaller community

**Why TypeScript:**
- Industry standard
- Excellent IDE support
- Strong type checking
- Large ecosystem
- Interfaces document contracts

#### Consequences
**Positive:**
- Catch errors at compile time
- Better refactoring confidence
- Self-documenting code
- Improved developer experience

**Negative:**
- Build step required
- Longer initial development time
- Generic/complex types can be confusing

**Neutral:**
- Team needs TypeScript training
- Need to maintain tsconfig.json

---

### ADR-003: Test-Driven Development with Layer-Based Strategy
**Date:** 2025-09-30
**Status:** Accepted
**Deciders:** Development Team

#### Context
We need a testing strategy that:
- Ensures code quality
- Provides confidence for refactoring
- Aligns with Hexagonal Architecture
- Balances speed and coverage

#### Decision
Adopt TDD with layer-based testing:
- **Domain:** Pure unit tests (50% of tests)
- **Application:** Integration tests with mocked ports (30%)
- **Adapters:** Integration tests with real systems (15%)
- **E2E:** Critical path tests (5%)

#### Rationale
**Why layer-based:**
- Aligns with architecture boundaries
- Tests what matters (business logic heavily tested)
- Fast feedback (most tests are fast unit tests)
- Mock only at boundaries (more confidence)

**Alternatives considered:**
1. **Test Pyramid** - Good, but doesn't leverage DIP advantages
2. **All E2E** - Slow, hard to debug, brittle
3. **All Unit** - Misses integration issues

#### Consequences
**Positive:**
- Fast test suite (most tests are unit)
- High confidence from integration tests
- Clear testing strategy per layer
- Regression protection

**Negative:**
- Requires discipline to maintain
- Need test helpers (fakes, builders)
- Integration tests need test infrastructure

**Neutral:**
- TDD adds upfront time but saves debugging time
- Need team training on patterns

---

## Superseded Decisions

<!-- Deprecated or superseded decisions are moved here -->

---

## Decision Status Definitions

- **Proposed:** Under discussion, not yet decided
- **Accepted:** Decision made and being implemented
- **Deprecated:** No longer relevant, but kept for historical context
- **Superseded:** Replaced by a newer decision (link to new ADR)

---

## Changelog

| Date | ADR | Change | Author |
|------|-----|--------|--------|
| 2025-09-30 | ADR-001 | Initial: Hexagonal Architecture | System |
| 2025-09-30 | ADR-002 | Initial: TypeScript adoption | System |
| 2025-09-30 | ADR-003 | Initial: TDD strategy | System |
