import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAudienceFilter,
  buildFilteredAudienceArtifact,
  buildFilteredAudienceUploadMetadata,
  collectAudienceFieldPaths,
  parseAudienceRowsByFormat,
} from "../src/audience-filter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("filters CSV audience rows deterministically from headers", () => {
  const rows = parseAudienceRowsByFormat(
    "email,first_name,plan,score\navery@example.com,Avery,pro,12\nblake@example.com,Blake,free,3\ncasey@example.com,Casey,pro,7\n",
    "csv",
  );
  const result = applyAudienceFilter(rows, {
    combine: "all",
    predicates: [
      { mode: "include", fieldPath: "plan", operator: "equals", value: "pro" },
      { mode: "exclude", fieldPath: "score", operator: "lt", value: 10 },
    ],
  });

  assert.deepEqual(result.counts, {
    source: 3,
    filtered: 1,
    excluded: 2,
    invalid: 0,
  });
  assert.equal(result.rows[0].email, "avery@example.com");
  assert.deepEqual(result.fieldPaths, ["email", "first_name", "plan", "score"]);
  assert.equal(result.filterHash.length, 64);
});

test("filters JSON audiences by stable nested object paths", () => {
  const rows = parseAudienceRowsByFormat(
    JSON.stringify({
      rows: [
        {
          email: "avery@example.com",
          company: { plan: "pro", seats: 12 },
          region: "west",
        },
        {
          email: "blake@example.com",
          company: { plan: "free", seats: 2 },
          region: "east",
        },
        {
          email: "casey@example.com",
          company: { plan: "pro", seats: "n/a" },
          region: "west",
        },
      ],
    }),
    "json",
  );
  const result = applyAudienceFilter(rows, {
    combine: "all",
    predicates: [
      {
        mode: "include",
        fieldPath: "company.plan",
        operator: "in",
        value: ["pro", "enterprise"],
      },
      {
        mode: "include",
        fieldPath: "company.seats",
        operator: "gte",
        value: 10,
      },
    ],
  });

  assert.deepEqual(collectAudienceFieldPaths(rows), [
    "company.plan",
    "company.seats",
    "email",
    "region",
  ]);
  assert.deepEqual(result.counts, {
    source: 3,
    filtered: 1,
    excluded: 1,
    invalid: 1,
  });
  assert.equal(result.rows[0].email, "avery@example.com");
  assert.deepEqual(result.invalidRows, [
    { index: 2, reason: "invalid_predicate_value" },
  ]);
});

test("parses JSON audience rows from candidate dataset containers", () => {
  const rows = parseAudienceRowsByFormat(
    JSON.stringify({
      generatedAt: "2026-05-18T00:00:00.000Z",
      candidates: [
        { email: "avery@example.com", stage: "screen" },
        { email: "blake@example.com", stage: "skip" },
      ],
    }),
    "json",
  );

  assert.deepEqual(rows, [
    { email: "avery@example.com", stage: "screen" },
    { email: "blake@example.com", stage: "skip" },
  ]);
});

test("filters non-recipient research rows before platform recipient validation", () => {
  const rows = parseAudienceRowsByFormat(
    JSON.stringify({
      candidates: [
        { candidateId: "a", status: "active" },
        { candidateId: "b", status: "archived" },
      ],
    }),
    "json",
  );
  const result = applyAudienceFilter(rows, {
    combine: "all",
    predicates: [
      { mode: "exclude", fieldPath: "status", operator: "equals", value: "archived" },
    ],
  });

  assert.deepEqual(result.counts, {
    source: 2,
    filtered: 1,
    excluded: 1,
    invalid: 0,
  });
  assert.equal(result.rows[0].candidateId, "a");
});

test("builds filtered audience artifacts with source refs, filter hashes, and counts", () => {
  const sourceArtifactRef = {
    source: "workspace_file",
    format: "csv",
    workspacePath: "email/audiences/clients.csv",
    workspaceFileId: "file_source",
    sha256: "source_hash",
  };
  const filterSpec = {
    combine: "all",
    predicates: [
      { mode: "include", fieldPath: "plan", operator: "equals", value: "pro" },
    ],
  };
  const counts = {
    source: 2,
    filtered: 1,
    excluded: 1,
    invalid: 0,
  };
  const artifact = buildFilteredAudienceArtifact({
    name: "Pro clients",
    sourceArtifactRef,
    filterSpec,
    filterHash: "filter_hash",
    counts,
    rows: [{ email: "avery@example.com", plan: "pro" }],
    fieldPaths: ["email", "plan"],
    createdAt: "2026-05-18T00:00:00.000Z",
  });
  const metadata = buildFilteredAudienceUploadMetadata({
    name: "Pro clients",
    sourceArtifactRef,
    filterSpec,
    filterHash: "filter_hash",
    counts,
  });

  assert.equal(artifact.schemaVersion, "tribex.emailFilteredAudience.v1");
  assert.equal(artifact.rowCount, 1);
  assert.deepEqual(artifact.sourceArtifactRef, sourceArtifactRef);
  assert.deepEqual(artifact.audienceFilterSpec, filterSpec);
  assert.equal(artifact.audienceFilterHash, "filter_hash");
  assert.deepEqual(artifact.counts, counts);
  assert.deepEqual(artifact.metadata.fieldPaths, ["email", "plan"]);
  assert.deepEqual(metadata.audienceFilterCounts, counts);
});

test("manual campaign test audience fixture supports nested metadata and opt-out filters", async () => {
  const fixture = await readFile(
    join(
      __dirname,
      "..",
      "fixtures",
      "email",
      "audiences",
      "manual-campaign-test-audience.json",
    ),
    "utf8",
  );
  const rows = parseAudienceRowsByFormat(fixture, "json");

  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((row) => [row.email, row.first_name, row.last_name]),
    [
      ["daenonjjanis@gmail.com", "Daenon1", "Janis1"],
      ["deej@ludflow.com", "Daenon2", "Janis2"],
      ["daenonjanis8@gmail.com", "Daenon3", "Janis3"],
      ["sorenofdawn@gmail.com", "Daenon4", "Janis4"],
    ],
  );

  const fieldPaths = collectAudienceFieldPaths(rows);
  assert.ok(fieldPaths.includes("company"));
  assert.ok(fieldPaths.includes("custom_note"));
  assert.ok(fieldPaths.includes("metadata.crm.lifecycle_stage"));
  assert.ok(fieldPaths.includes("metadata.score"));
  assert.ok(fieldPaths.includes("consent.emailOptOut"));
  assert.ok(fieldPaths.includes("consent.optOutRequired"));

  const result = applyAudienceFilter(rows, {
    combine: "all",
    predicates: [
      {
        mode: "include",
        fieldPath: "metadata.cohort",
        operator: "in",
        value: ["alpha", "beta"],
      },
      {
        mode: "include",
        fieldPath: "metadata.score",
        operator: "gte",
        value: 85,
      },
      {
        mode: "include",
        fieldPath: "consent.emailOptOut",
        operator: "equals",
        value: false,
      },
      {
        mode: "include",
        fieldPath: "consent.optOutRequired",
        operator: "equals",
        value: true,
      },
    ],
  });

  assert.deepEqual(result.counts, {
    source: 4,
    filtered: 3,
    excluded: 1,
    invalid: 0,
  });
  assert.deepEqual(
    result.rows.map((row) => row.email),
    ["daenonjjanis@gmail.com", "deej@ludflow.com", "sorenofdawn@gmail.com"],
  );
});
