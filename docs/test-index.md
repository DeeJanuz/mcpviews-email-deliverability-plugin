# Test Suite Documentation

> **TEMPLATE:** This is a starter template. Content will be populated by the documentation updater agent after commits.

**Maintained by:** Documentation agent (automated)

This document maps all test files to their corresponding source code and describes what each test covers. Use this index to avoid duplicate test creation and identify testing gaps.

---

## Unit Tests

- `tests/template-engine.test.mjs` covers deterministic placeholder extraction, rendering, missing-variable blocking, one-row test campaign payload construction, artifact-backed campaign payloads, runtime campaign draft artifact normalization, draft artifact metadata, single-test prompt safety wording, and approval-gated campaign prompt wording.
- `tests/server.test.mjs` covers the local MCP initialize/tools-list flow, prompt schemas for artifact-backed drafts without raw audience rows, prefixed tool-call normalization, renderer payload normalization for runtime draft artifacts, validation output, campaign prompt tool output, and JSON-RPC error behavior for unsafe prompt payloads.
- `node --check renderers/email-template-builder.js` covers renderer syntax for the browser-side guided org/workspace/template picker, simplified template editor, deterministic HTML-to-text preview flow, large HTML preview, and advanced artifact search/load flow.

---

## Integration Tests

_(No tests yet. Tests will be documented here as they are created.)_

---

## E2E Tests

### Manual Dev Smoke

- 2026-05-17 MCPViews authenticated thread `Email revision smoke` validated the deployed TribeX AI dev runtime plus installed plugin path for template artifact revisions. The seeded `email-campaign-draft-tester` persona created `email/templates/codex-in-place-revision-smoke.html`, updated the same workspace path with an expected SHA-256 guard, and searched for the artifact by path. The search returned one match with the updated SHA `79f1e40b1dc68bd133fbeed8fd2fb0d63670c0bc6361073ed89fe9ea40025bd0`.
- The same smoke confirmed the plugin/persona path did not send a test email or production campaign. It exercised artifact create/update/search only.
- Older MCPViews threads can retain stale desktop relay bearer metadata after a dev deploy; fresh authenticated threads should be used for post-deploy plugin/runtime smoke validation.

### Pre-Commit Check

- 2026-05-17 `npm test` passed with 18 tests.
- 2026-05-17 `npm run check` passed for `src/*.mjs` and `tests/*.mjs`.
