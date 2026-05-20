import { createHash } from "node:crypto";

export const FILTERED_AUDIENCE_SCHEMA_VERSION = "tribex.emailFilteredAudience.v1";

const FILTER_OPERATORS = new Set([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "in",
  "not_in",
  "exists",
  "not_exists",
  "gt",
  "gte",
  "lt",
  "lte",
]);

const FILTER_MODES = new Set(["include", "exclude"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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

export function csvRowsFromText(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(text || "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  if (quoted) {
    throw new Error("CSV audience artifact has an unterminated quoted field.");
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((candidate) =>
    candidate.some((value) => String(value || "").trim().length > 0),
  );
}

export function parseCsvAudienceRows(text) {
  const rows = csvRowsFromText(text);
  if (rows.length < 2) {
    throw new Error("CSV audience artifact must include a header row and at least one data row.");
  }
  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => !header)) {
    throw new Error("CSV audience artifact headers must be non-empty.");
  }
  const seen = new Set();
  for (const header of headers) {
    if (seen.has(header)) {
      throw new Error(`CSV audience artifact has duplicate header: ${header}.`);
    }
    seen.add(header);
  }
  return rows.slice(1).map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? "";
    });
    return record;
  });
}

export function parseJsonAudienceRows(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (Array.isArray(parsed)) return parsed;
  if (isRecord(parsed)) {
    const preferredKeys = ["audience", "rows", "candidates", "items", "data", "records", "clients"];
    for (const key of preferredKeys) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
    const arrayKey = Object.keys(parsed).sort().find((key) => Array.isArray(parsed[key]));
    if (arrayKey) return parsed[arrayKey];
  }
  throw new Error(
    "JSON audience artifact must be an array, or an object with an audience-like array such as audience, rows, candidates, items, data, records, or clients.",
  );
}

export function parseAudienceRowsByFormat(value, format = "json") {
  const normalizedFormat = String(format || "json").trim().toLowerCase();
  const rows = normalizedFormat === "csv"
    ? parseCsvAudienceRows(value)
    : parseJsonAudienceRows(value);
  return rows.map((row, index) => {
    if (!isRecord(row)) {
      throw new Error(`Audience row ${index + 1} must be an object.`);
    }
    return row;
  });
}

function isScalarFilterValue(value) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function collectPathsFromRecord(record, prefix, paths) {
  for (const key of Object.keys(record).sort()) {
    const value = record[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (isScalarFilterValue(value)) {
      paths.add(path);
      continue;
    }
    if (isRecord(value)) {
      collectPathsFromRecord(value, path, paths);
    }
  }
}

export function collectAudienceFieldPaths(rows) {
  const paths = new Set();
  for (const row of rows) {
    if (isRecord(row)) {
      collectPathsFromRecord(row, "", paths);
    }
  }
  return [...paths].sort();
}

export function readFieldPath(row, fieldPath) {
  const segments = String(fieldPath || "").split(".").filter(Boolean);
  let current = row;
  for (const segment of segments) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { exists: false, value: undefined };
    }
    current = current[segment];
  }
  return { exists: true, value: current };
}

function normalizePredicateValue(value, operator) {
  if (operator === "in" || operator === "not_in") {
    if (Array.isArray(value)) return value.map((item) => String(item));
    return String(value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value;
}

export function normalizeFilterSpec(spec = {}) {
  const raw = isRecord(spec) ? spec : {};
  const combine = raw.combine === "any" ? "any" : "all";
  const predicates = Array.isArray(raw.predicates) ? raw.predicates : [];
  return {
    combine,
    predicates: predicates
      .map((predicate) => {
        if (!isRecord(predicate)) return null;
        const operator = stringValue(predicate.operator) || "equals";
        const fieldPath = stringValue(predicate.fieldPath || predicate.field);
        const mode = FILTER_MODES.has(predicate.mode) ? predicate.mode : "include";
        if (!FILTER_OPERATORS.has(operator)) return null;
        if (!fieldPath && operator !== "exists" && operator !== "not_exists") return null;
        return dropUndefined({
          mode,
          fieldPath,
          operator,
          value: normalizePredicateValue(predicate.value, operator),
        });
      })
      .filter(Boolean),
  };
}

function toComparableString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}

function compareNumbers(actual, expected, operator) {
  const left = Number(actual);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return { matched: false, invalid: true };
  }
  if (operator === "gt") return { matched: left > right, invalid: false };
  if (operator === "gte") return { matched: left >= right, invalid: false };
  if (operator === "lt") return { matched: left < right, invalid: false };
  return { matched: left <= right, invalid: false };
}

function evaluatePredicate(row, predicate) {
  const field = readFieldPath(row, predicate.fieldPath);
  if (predicate.operator === "exists") {
    return { matched: field.exists && field.value !== undefined, invalid: false };
  }
  if (predicate.operator === "not_exists") {
    return { matched: !field.exists || field.value === undefined, invalid: false };
  }
  if (!field.exists || field.value === undefined) {
    return { matched: false, invalid: false };
  }

  if (["gt", "gte", "lt", "lte"].includes(predicate.operator)) {
    return compareNumbers(field.value, predicate.value, predicate.operator);
  }

  const actual = toComparableString(field.value);
  const expected = toComparableString(predicate.value);
  if (predicate.operator === "equals") return { matched: actual === expected, invalid: false };
  if (predicate.operator === "not_equals") return { matched: actual !== expected, invalid: false };
  if (predicate.operator === "contains") return { matched: actual.includes(expected), invalid: false };
  if (predicate.operator === "not_contains") return { matched: !actual.includes(expected), invalid: false };
  if (predicate.operator === "in") {
    const expectedValues = Array.isArray(predicate.value)
      ? predicate.value.map(toComparableString)
      : [];
    return { matched: expectedValues.includes(actual), invalid: false };
  }
  if (predicate.operator === "not_in") {
    const expectedValues = Array.isArray(predicate.value)
      ? predicate.value.map(toComparableString)
      : [];
    return { matched: !expectedValues.includes(actual), invalid: false };
  }
  return { matched: false, invalid: true };
}

function rowPassesFilter(row, normalizedSpec) {
  if (!isRecord(row)) {
    return { passes: false, invalid: true, reason: "row_not_object" };
  }
  if (!normalizedSpec.predicates.length) {
    return { passes: true, invalid: false, reason: "" };
  }
  const evaluations = normalizedSpec.predicates.map((predicate) => {
    const evaluated = evaluatePredicate(row, predicate);
    return {
      invalid: evaluated.invalid,
      passes: predicate.mode === "exclude" ? !evaluated.matched : evaluated.matched,
    };
  });
  if (evaluations.some((evaluation) => evaluation.invalid)) {
    return { passes: false, invalid: true, reason: "invalid_predicate_value" };
  }
  const passes = normalizedSpec.combine === "any"
    ? evaluations.some((evaluation) => evaluation.passes)
    : evaluations.every((evaluation) => evaluation.passes);
  return { passes, invalid: false, reason: passes ? "" : "filtered_out" };
}

export function applyAudienceFilter(rows, spec = {}) {
  const normalizedSpec = normalizeFilterSpec(spec);
  const filteredRows = [];
  const invalidRows = [];
  rows.forEach((row, index) => {
    const result = rowPassesFilter(row, normalizedSpec);
    if (result.invalid) {
      invalidRows.push({ index, reason: result.reason });
      return;
    }
    if (result.passes) filteredRows.push(row);
  });
  return {
    filterSpec: normalizedSpec,
    filterHash: sha256Hex(stableJsonStringify(normalizedSpec)),
    rows: filteredRows,
    fieldPaths: collectAudienceFieldPaths(rows),
    counts: {
      source: rows.length,
      filtered: filteredRows.length,
      excluded: rows.length - filteredRows.length - invalidRows.length,
      invalid: invalidRows.length,
    },
    invalidRows,
  };
}

export function buildFilteredAudienceArtifact(input) {
  const filterSpec = normalizeFilterSpec(input?.filterSpec);
  const rows = Array.isArray(input?.rows) ? input.rows : [];
  const counts = isRecord(input?.counts)
    ? input.counts
    : {
        source: rows.length,
        filtered: rows.length,
        excluded: 0,
        invalid: 0,
      };
  const filterHash =
    stringValue(input?.filterHash) || sha256Hex(stableJsonStringify(filterSpec));
  const sourceArtifactRef = isRecord(input?.sourceArtifactRef)
    ? dropUndefined(input.sourceArtifactRef)
    : {};
  return {
    schemaVersion: FILTERED_AUDIENCE_SCHEMA_VERSION,
    source: "mcpviews-email-deliverability-plugin",
    createdAt: input?.createdAt || new Date().toISOString(),
    name: stringValue(input?.name) || "Filtered audience",
    rowCount: rows.length,
    sourceArtifactRef,
    audienceFilterSpec: filterSpec,
    audienceFilterHash: filterHash,
    counts: dropUndefined({
      source: counts.source,
      filtered: counts.filtered,
      excluded: counts.excluded,
      invalid: counts.invalid,
    }),
    rows,
    metadata: dropUndefined({
      kind: "email-campaign-filtered-audience",
      sourceArtifactRef,
      audienceFilterSpec: filterSpec,
      audienceFilterHash: filterHash,
      audienceFilterCounts: counts,
      fieldPaths: Array.isArray(input?.fieldPaths) ? input.fieldPaths : undefined,
    }),
  };
}

export function buildFilteredAudienceUploadMetadata(input) {
  return dropUndefined({
    kind: "email-campaign-filtered-audience",
    name: stringValue(input?.name) || "Filtered audience",
    sourceArtifactRef: isRecord(input?.sourceArtifactRef)
      ? input.sourceArtifactRef
      : undefined,
    audienceFilterSpec: normalizeFilterSpec(input?.filterSpec),
    audienceFilterHash:
      stringValue(input?.filterHash) ||
      sha256Hex(stableJsonStringify(normalizeFilterSpec(input?.filterSpec))),
    audienceFilterCounts: isRecord(input?.counts) ? input.counts : undefined,
  });
}
