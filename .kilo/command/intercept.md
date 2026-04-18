---
description: Start an interception review loop for OpenClaw traffic
agent: openclaw-interceptor
---
Use the OpenClaw MCP tools to inspect paused browser traffic.

Workflow:
1. Call `get_pending_requests` immediately.
2. If there are pending intercepts, analyze them and resolve each one.
3. Keep responses concise and action-oriented.

User request: $ARGUMENTS
