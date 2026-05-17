<!-- mcpviews-rules-version: 12 -->

# MCPViews Session Startup

IMPORTANT: At the start of every conversation, chat session, interaction, project, folder, or task, call the `init_session` MCP tool with `agent_type: "codex"` before choosing other MCP, app, plugin, or skill workflows.

This is a global Codex rule. It applies across every workspace, including DecidR, LudFlow, Notion, Stripe, and local coding tasks. Initialize MCPViews first so the current renderer definitions, plugin rules, auth status, org tokens, and available tools are loaded before interpreting the user's request.
