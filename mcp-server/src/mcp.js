import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getPendingIntercept, listPendingIntercepts, resolvePendingIntercept } from './state.js';

function serializeIntercept(intercept) {
  return {
    id: intercept.id,
    phase: intercept.data.phase,
    tabId: intercept.data.tabId,
    resourceType: intercept.data.resourceType,
    url: intercept.data.url,
    method: intercept.data.method,
    requestHeaders: intercept.data.requestHeaders,
    requestBody: intercept.data.requestBody,
    responseStatusCode: intercept.data.responseStatusCode,
    responseStatusText: intercept.data.responseStatusText,
    responseHeaders: intercept.data.responseHeaders,
    responseBody: intercept.data.responseBody,
    createdAt: new Date(intercept.createdAt).toISOString(),
  };
}

function buildDecision(args) {
  return {
    action: args.action,
    modifiedMethod: args.modifiedMethod,
    modifiedUrl: args.modifiedUrl,
    modifiedHeaders: args.modifiedHeaders,
    modifiedBody: args.modifiedBody,
    modifiedStatusCode: args.modifiedStatusCode,
    modifiedResponseHeaders: args.modifiedResponseHeaders,
    modifiedResponseBody: args.modifiedResponseBody,
  };
}

export function startMcpServer() {
  const server = new Server(
    { name: "openclaw-burpsuite-agent", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_pending_requests",
          description: "List all currently paused browser intercepts. Includes request-phase and response-phase events.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "resolve_request",
          description: "Resolve one paused intercept by forwarding it, dropping it, or modifying the request/response payload.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "The paused intercept ID" },
              action: { type: "string", enum: ["forward", "drop", "modify"], description: "How to continue the intercept" },
              modifiedMethod: { type: "string", description: "Optional replacement request method for request-phase intercepts" },
              modifiedUrl: { type: "string", description: "Optional replacement request URL for request-phase intercepts" },
              modifiedHeaders: { type: "object", description: "Optional replacement request headers object" },
              modifiedBody: { type: "string", description: "Optional replacement request body" },
              modifiedStatusCode: { type: "number", description: "Optional replacement response status code for response-phase intercepts" },
              modifiedResponseHeaders: { type: "object", description: "Optional replacement response headers object" },
              modifiedResponseBody: { type: "string", description: "Optional replacement response body" }
            },
            required: ["id", "action"]
          }
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "get_pending_requests") {
      const pending = listPendingIntercepts().map(serializeIntercept);

      if (pending.length === 0) {
        return { content: [{ type: "text", text: "No pending requests at the moment." }] };
      }

      return { content: [{ type: "text", text: JSON.stringify(pending, null, 2) }] };
    }

    if (request.params.name === "resolve_request") {
      const args = request.params.arguments || {};
      const intercept = getPendingIntercept(args.id);

      if (!intercept) {
        return {
          isError: true,
          content: [{ type: "text", text: `Intercept ${args.id} not found or already resolved.` }],
        };
      }

      const resolved = resolvePendingIntercept(args.id, buildDecision(args));

      if (!resolved) {
        return {
          isError: true,
          content: [{ type: "text", text: `Intercept ${args.id} was no longer pending.` }],
        };
      }

      return {
        content: [{ type: "text", text: `Resolved ${args.id} (${intercept.data.phase}) with action ${args.action}.` }],
      };
    }

    throw new Error(`Tool not found: ${request.params.name}`);
  });

  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error("[MCP] STDIO bridge ready");
  });
}
