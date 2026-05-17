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
The campaign builder could load artifacts by workspace path, but the first screen still exposed too much low-level workspace/file plumbing. Users opening the builder need a natural first path: pick the organization, choose an existing email template or campaign draft, or start a new one.

#### Decision
Add a guided start panel to `email_template_builder`. The renderer resolves thread context when available, discovers organizations and workspaces through `window.__tribexAiClient`, lists saved email templates and campaign drafts from durable workspace storage, and offers a primary create-new action before the detailed editor controls.

#### Rationale
The org/workspace/template choice is the real task entrypoint. Keeping it inside the renderer avoids new backend endpoints while making the existing artifact search an advanced fallback instead of the main workflow.

#### Consequences
**Positive:**
- The builder opens with a clear "Select org -> Select template -> Create new" flow.
- Existing persona-authored templates and campaign drafts are discoverable without manual file paths.
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
Persona-created HTML templates and campaign drafts live in TribeX AI durable workspace storage. Requiring users to copy `workspacePath`, file IDs, and hashes by hand makes the campaign-builder workflow fragile and too technical.

#### Decision
Add a workspace artifact search/load surface directly inside `email_template_builder`. The renderer uses the existing `window.__tribexAiClient` workspace file APIs to list files under `email/`, filter by path, download selected artifacts through signed file links, and hydrate the builder from HTML template files, campaign draft JSON files, and audience JSON/CSV files.

#### Rationale
The plugin already has authenticated workspace context when opened from a TribeX thread or workspace. Reusing that client keeps artifact discovery local to the user session, avoids adding new backend endpoints, and turns the persona artifact flow into a visible, clickable review path.

#### Consequences
**Positive:**
- Users can search by durable file path instead of manually entering artifact refs.
- Campaign draft artifacts can pull their referenced HTML template for preview when the file ID is present.
- HTML, audience, and campaign refs/hashes remain visible before prepare or approval handoff.

**Negative:**
- Search is scoped to workspace files under `email/`; broader artifact indexing can come later if durable storage grows large.

**Neutral:**
- Production sends remain persona-mediated and approval-gated.

---

### ADR-006: Consume Runtime Draft Artifacts In Campaign Builder
**Date:** 2026-05-17
**Status:** Accepted
**Deciders:** Daenon Janis, Codex

#### Context
TribeX AI now exposes sandbox-write-gated persona runtime tools that create rich HTML template artifacts and campaign draft artifacts in durable workspace storage. The MCPViews campaign builder needs to open those tool outputs directly, not force users to retype artifact refs or reconstruct prepare payloads by hand.

#### Decision
Normalize `email_template_artifact_create` and `email_campaign_draft_artifact_create` outputs inside the plugin. The builder accepts nested `campaignPreparePayload`, `campaignDraftArtifactRef`, `htmlTemplateArtifactRef`, and `audienceArtifactRef`, displays their workspace paths and hashes, and generates the existing approval-gated persona prompt from those immutable refs.

#### Rationale
The runtime tools are the artifact authoring layer, while the plugin is the visual review and handoff layer. Keeping normalization in the plugin lets persona-created drafts flow into the same UI used for manual campaign review without giving the plugin production-send authority.

#### Consequences
**Positive:**
- Persona-authored HTML and campaign drafts open cleanly in the campaign builder.
- Artifact-backed sends keep audience and HTML refs/hashes visible before approval.
- Production send controls remain human gated through platform tools.

**Negative:**
- The builder must tolerate artifact-backed campaigns that do not include raw audience rows.

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
