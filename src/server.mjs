import http from "node:http";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  EMAIL_CAMPAIGNS_TOOL_PREFIX,
  EMAIL_PERFORMANCE_TOOL_PREFIX,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  TOOL_PREFIX,
} from "./constants.mjs";
import {
  buildPersonaCampaignPrompt,
  buildPersonaTemplateRevisionPrompt,
  buildPersonaTemplateVisualEditPrompt,
  buildPersonaTestPrompt,
  normalizeDraftInput,
  validateDraft,
} from "./template-engine.mjs";

const TOOL_DEFINITIONS = [
  {
    name: "email-template-builder-open",
    description:
      "Return a lightweight payload for opening the MCPViews email template builder renderer.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        threadId: { type: "string" },
        workspaceId: { type: "string" },
        projectId: { type: "string" },
        organizationId: { type: "string" },
        draft: { type: "object", additionalProperties: true },
      },
    },
  },
  {
    name: "email-campaign-launcher-open",
    description:
      "Return a lightweight payload for opening the MCPViews manual email campaign launcher renderer.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        threadId: { type: "string" },
        workspaceId: { type: "string" },
        projectId: { type: "string" },
        organizationId: { type: "string" },
        draft: { type: "object", additionalProperties: true },
      },
    },
  },
  {
    name: "email-campaign-history-open",
    description:
      "Deprecated compatibility shim for opening the Email Performance dashboard filtered to campaigns.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        threadId: { type: "string" },
        workspaceId: { type: "string" },
        projectId: { type: "string" },
        organizationId: { type: "string" },
        draft: { type: "object", additionalProperties: true },
      },
    },
  },
  {
    name: "email-performance-dashboard-open",
    description:
      "Return a lightweight payload for opening the MCPViews Email Performance dashboard.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        threadId: { type: "string" },
        workspaceId: { type: "string" },
        projectId: { type: "string" },
        organizationId: { type: "string" },
        draft: { type: "object", additionalProperties: true },
      },
    },
  },
  {
    name: "email-template-payload-validate",
    description:
      "Validate explicit email template placeholders against normalized JSON audience rows.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        name: { type: "string" },
        subjectTemplate: { type: "string" },
        textTemplate: { type: "string" },
        htmlTemplate: { type: "string" },
        audience: { type: "array", items: { type: "object" } },
      },
      required: ["subjectTemplate", "textTemplate", "audience"],
    },
  },
  {
    name: "email-template-persona-test-prompt",
    description:
      "Build a safety-scoped prompt that asks a TribeX AI persona to prepare and send exactly one test email.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        name: { type: "string" },
        subjectTemplate: { type: "string" },
        textTemplate: { type: "string" },
        htmlTemplate: { type: "string" },
        htmlTemplateArtifactRef: { type: "object", additionalProperties: true },
        audience: { type: "array", items: { type: "object" } },
        audienceArtifactRef: { type: "object", additionalProperties: true },
        testTo: { type: "string" },
        workspacePath: { type: "string" },
        workspaceFileId: { type: "string" },
        campaignPreparePayload: { type: "object", additionalProperties: true },
      },
    },
  },
  {
    name: "email-campaign-persona-prompt",
    description:
      "Build an approval-gated prompt that asks a TribeX AI persona to prepare, preview, test, request MCPViews approval, and apply a production campaign send only after approval.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        name: { type: "string" },
        subjectTemplate: { type: "string" },
        textTemplate: { type: "string" },
        htmlTemplate: { type: "string" },
        htmlArtifactPath: { type: "string" },
        htmlArtifactFileId: { type: "string" },
        htmlArtifactSha256: { type: "string" },
        htmlTemplateArtifactRef: { type: "object", additionalProperties: true },
        audience: { type: "array", items: { type: "object" } },
        audienceArtifactRef: { type: "object", additionalProperties: true },
        audienceArtifactPath: { type: "string" },
        audienceArtifactFileId: { type: "string" },
        audienceArtifactFormat: { type: "string", enum: ["json", "csv"] },
        audienceArtifactSha256: { type: "string" },
        testTo: { type: "string" },
        workspacePath: { type: "string" },
        workspaceFileId: { type: "string" },
        campaignPreparePayload: { type: "object", additionalProperties: true },
      },
    },
  },
  {
    name: "email-template-persona-revision-prompt",
    description:
      "Build a prompt that asks a TribeX AI persona to revise an existing HTML template artifact in place using artifact search and update tools.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        revisionRequest: { type: "string" },
        searchQuery: { type: "string" },
        htmlArtifactPath: { type: "string" },
        htmlArtifactFileId: { type: "string" },
        htmlArtifactSha256: { type: "string" },
        workspacePath: { type: "string" },
        workspaceFileId: { type: "string" },
        sha256: { type: "string" },
        draft: { type: "object", additionalProperties: true },
      },
      required: ["revisionRequest"],
    },
  },
  {
    name: "email-template-visual-edit-prompt",
    description:
      "Build a batch visual-edit prompt for the plugin-specific email-template-visual-editor persona using metadata-only selected HTML blocks.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        selections: { type: "array", items: { type: "object" }, minItems: 1 },
        htmlArtifactPath: { type: "string" },
        htmlArtifactFileId: { type: "string" },
        htmlArtifactSha256: { type: "string" },
        workspacePath: { type: "string" },
        workspaceFileId: { type: "string" },
        sha256: { type: "string" },
        draft: { type: "object", additionalProperties: true },
      },
      required: ["selections"],
    },
  },
];

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id,
    error: data ? { code, message, data } : { code, message },
  };
}

function toolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? JSON.parse(text) : {};
}

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, mcp-session-id",
  );
}

function normalizeToolName(name) {
  return String(name || "")
    .replace(new RegExp(`^${TOOL_PREFIX}`), "")
    .replace(new RegExp(`^${EMAIL_CAMPAIGNS_TOOL_PREFIX}`), "")
    .replace(new RegExp(`^${EMAIL_PERFORMANCE_TOOL_PREFIX}`), "");
}

function builderPayload(args) {
  const draft = normalizeDraftInput(
    args.draft && typeof args.draft === "object" ? args.draft : {},
  );
  return {
    renderer: "email_template_builder",
    thread_id: args.thread_id || args.threadId || "",
    workspace_id: args.workspace_id || args.workspaceId || "",
    project_id: args.project_id || args.projectId || "",
    organization_id: args.organization_id || args.organizationId || "",
    draft,
  };
}

function launcherPayload(args) {
  const draft = normalizeDraftInput(
    args.draft && typeof args.draft === "object" ? args.draft : {},
  );
  return {
    renderer: "email_campaign_launcher",
    thread_id: args.thread_id || args.threadId || "",
    workspace_id: args.workspace_id || args.workspaceId || "",
    project_id: args.project_id || args.projectId || "",
    organization_id: args.organization_id || args.organizationId || "",
    draft,
  };
}

function historyPayload(args) {
  const draft = args.draft && typeof args.draft === "object" ? args.draft : {};
  return {
    renderer: "email_performance_dashboard",
    thread_id: args.thread_id || args.threadId || "",
    workspace_id: args.workspace_id || args.workspaceId || "",
    project_id: args.project_id || args.projectId || "",
    organization_id: args.organization_id || args.organizationId || "",
    draft: {
      ...draft,
      source: draft.source || "CAMPAIGN",
    },
  };
}

function performancePayload(args) {
  const draft = args.draft && typeof args.draft === "object" ? args.draft : {};
  return {
    renderer: "email_performance_dashboard",
    thread_id: args.thread_id || args.threadId || "",
    workspace_id: args.workspace_id || args.workspaceId || "",
    project_id: args.project_id || args.projectId || "",
    organization_id: args.organization_id || args.organizationId || "",
    draft,
  };
}

async function handleToolCall(name, args = {}) {
  const toolName = normalizeToolName(name);
  if (toolName === "email-template-builder-open") {
    return toolResult(builderPayload(args));
  }
  if (toolName === "email-campaign-launcher-open") {
    return toolResult(launcherPayload(args));
  }
  if (toolName === "email-campaign-history-open") {
    return toolResult(historyPayload(args));
  }
  if (toolName === "email-performance-dashboard-open") {
    return toolResult(performancePayload(args));
  }
  if (toolName === "email-template-payload-validate") {
    return toolResult(validateDraft(args));
  }
  if (toolName === "email-template-persona-test-prompt") {
    return toolResult(
      buildPersonaTestPrompt(args, {
        workspacePath: args.workspacePath,
        workspaceFileId: args.workspaceFileId,
      }),
    );
  }
  if (toolName === "email-campaign-persona-prompt") {
    return toolResult(
      buildPersonaCampaignPrompt(args, {
        workspacePath: args.workspacePath,
        workspaceFileId: args.workspaceFileId,
        audienceArtifactPath: args.audienceArtifactPath,
        audienceArtifactFileId: args.audienceArtifactFileId,
        audienceArtifactFormat: args.audienceArtifactFormat,
        audienceArtifactSha256: args.audienceArtifactSha256,
        htmlArtifactPath: args.htmlArtifactPath,
        htmlArtifactFileId: args.htmlArtifactFileId,
        htmlArtifactSha256: args.htmlArtifactSha256,
      }),
    );
  }
  if (toolName === "email-template-persona-revision-prompt") {
    const draft = args.draft && typeof args.draft === "object" ? args.draft : args;
    return toolResult(
      buildPersonaTemplateRevisionPrompt(draft, {
        revisionRequest: args.revisionRequest,
        searchQuery: args.searchQuery,
        htmlArtifactPath: args.htmlArtifactPath,
        htmlArtifactFileId: args.htmlArtifactFileId,
        htmlArtifactSha256: args.htmlArtifactSha256,
      }),
    );
  }
  if (toolName === "email-template-visual-edit-prompt") {
    return toolResult(
      buildPersonaTemplateVisualEditPrompt(args, {
        htmlArtifactPath: args.htmlArtifactPath,
        htmlArtifactFileId: args.htmlArtifactFileId,
        htmlArtifactSha256: args.htmlArtifactSha256,
      }),
    );
  }
  throw new Error(`Unknown tool: ${name}`);
}

export async function handleRpc(payload) {
  const id = Object.prototype.hasOwnProperty.call(payload, "id")
    ? payload.id
    : null;
  if (payload.method === "initialize") {
    return {
      status: 200,
      headers: { "mcp-session-id": "email-deliverability-local" },
      body: jsonRpcResult(id, {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: {
          name: PLUGIN_NAME,
          version: PLUGIN_VERSION,
        },
      }),
    };
  }
  if (payload.method === "notifications/initialized") {
    return { status: 202, body: null };
  }
  if (payload.method === "tools/list") {
    return {
      status: 200,
      body: jsonRpcResult(id, { tools: TOOL_DEFINITIONS }),
    };
  }
  if (payload.method === "tools/call") {
    const params = payload.params || {};
    try {
      return {
        status: 200,
        body: jsonRpcResult(
          id,
          await handleToolCall(params.name, params.arguments || {}),
        ),
      };
    } catch (error) {
      return {
        status: 200,
        body: jsonRpcError(
          id,
          -32000,
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
  }
  return {
    status: 200,
    body: jsonRpcError(id, -32601, `Method not found: ${payload.method}`),
  };
}

export function createServer() {
  return http.createServer(async (request, response) => {
    setCors(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        server: PLUGIN_NAME,
        version: PLUGIN_VERSION,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/validate") {
      try {
        sendJson(response, 200, validateDraft(await readJson(request)));
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/persona-test-prompt") {
      try {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          buildPersonaTestPrompt(body, {
            workspacePath: body.workspacePath,
            workspaceFileId: body.workspaceFileId,
          }),
        );
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/persona-campaign-prompt") {
      try {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          buildPersonaCampaignPrompt(body, {
            workspacePath: body.workspacePath,
            workspaceFileId: body.workspaceFileId,
            audienceArtifactPath: body.audienceArtifactPath,
            audienceArtifactFileId: body.audienceArtifactFileId,
            audienceArtifactFormat: body.audienceArtifactFormat,
            audienceArtifactSha256: body.audienceArtifactSha256,
            htmlArtifactPath: body.htmlArtifactPath,
            htmlArtifactFileId: body.htmlArtifactFileId,
            htmlArtifactSha256: body.htmlArtifactSha256,
          }),
        );
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/mcp") {
      sendJson(response, 404, { error: "not_found" });
      return;
    }
    try {
      const rpc = await handleRpc(await readJson(request));
      if (!rpc.body) {
        response.writeHead(rpc.status, rpc.headers || {}).end();
        return;
      }
      sendJson(response, rpc.status, rpc.body, rpc.headers || {});
    } catch (error) {
      sendJson(
        response,
        400,
        jsonRpcError(
          null,
          -32700,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.EMAIL_DELIVERABILITY_PLUGIN_PORT || DEFAULT_PORT);
  const host = process.env.EMAIL_DELIVERABILITY_PLUGIN_HOST || DEFAULT_HOST;
  createServer().listen(port, host, () => {
    console.log(`${PLUGIN_NAME} MCP server listening on http://${host}:${port}/mcp`);
  });
}
