import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getPendingIntercept, listPendingIntercepts, resolvePendingIntercept, getTrafficHistory, getRules, addRule, removeRule, clearRules } from './state.js';

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
          name: "add_rule",
          description: "Deploy a Zero-Latency Interception Rule. Pushes a rule to the browser extension that executes instantly without pausing the browser. Use this to auto-mock endpoints or bypass paywalls.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Readable name for this rule" },
              urlPattern: { type: "string", description: "Substring match for the URL (e.g. '/api/checkout')" },
              method: { type: "string", description: "HTTP method to match (e.g. 'POST', 'GET'). Optional." },
              phase: { type: "string", enum: ["request", "response", "both"], description: "Which phase this rule applies to" },
              action: { type: "string", enum: ["modify", "drop", "forward"], description: "What to do instantly when matched" },
              modifiedMethod: { type: "string" },
              modifiedUrl: { type: "string" },
              modifiedHeaders: { type: "object" },
              modifiedBody: { type: "string" },
              modifiedStatusCode: { type: "number" },
              modifiedResponseHeaders: { type: "object" },
              modifiedResponseBody: { type: "string" }
            },
            required: ["name", "urlPattern", "phase", "action"]
          }
        },
        {
          name: "list_rules",
          description: "List all currently deployed Zero-Latency rules.",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "remove_rule",
          description: "Remove a specific deployed rule by its ID.",
          inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
        },
        {
          name: "get_pending_requests",
          description: "List all currently paused browser intercepts. Includes request-phase and response-phase events.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "get_traffic_history",
          description: "List recently logged network requests/responses (both Listen and Intercept modes). Useful for analyzing API structure before intercepting.",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", description: "Number of recent items to return (default 50, max 100)" }
            }
          }
        },
        {
          name: "replay_request",
          description: "Simulate/Replay a network request directly from the MCP server, exactly like Burp Suite's Repeater. You do not need the user to trigger it in the browser! You can freely specify the URL, method, headers, and body.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "The full URL to send the request to" },
              method: { type: "string", description: "HTTP method (GET, POST, PUT, etc.)" },
              headers: { type: "object", description: "HTTP headers object (including Cookies, Authorization, etc.)" },
              body: { type: "string", description: "Stringified request body (optional)" }
            },
            required: ["url", "method"]
          }
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

    if (request.params.name === "add_rule") {
      const args = request.params.arguments || {};
      const rule = addRule(args);
      return { content: [{ type: "text", text: `Successfully deployed rule: ${rule.name} (ID: ${rule.id})` }] };
    }

    if (request.params.name === "list_rules") {
      const rules = getRules();
      if (rules.length === 0) return { content: [{ type: "text", text: "No rules currently deployed." }] };
      return { content: [{ type: "text", text: JSON.stringify(rules, null, 2) }] };
    }

    if (request.params.name === "remove_rule") {
      const { id } = request.params.arguments || {};
      const removed = removeRule(id);
      return { content: [{ type: "text", text: removed ? `Rule ${id} removed.` : `Rule ${id} not found.` }] };
    }

    if (request.params.name === "get_pending_requests") {
      const pending = listPendingIntercepts().map(serializeIntercept);

      if (pending.length === 0) {
        return { content: [{ type: "text", text: "No pending requests at the moment." }] };
      }

      return { content: [{ type: "text", text: JSON.stringify(pending, null, 2) }] };
    }

    if (request.params.name === "get_traffic_history") {
      const args = request.params.arguments || {};
      const limit = args.limit ? Math.min(args.limit, 100) : 50;
      const history = getTrafficHistory().slice(-limit).map(item => serializeIntercept({ id: item.id, data: item, createdAt: item.recordedAt }));

      if (history.length === 0) {
        return { content: [{ type: "text", text: "No traffic history available yet." }] };
      }

      return { content: [{ type: "text", text: JSON.stringify(history, null, 2) }] };
    }

    if (request.params.name === "replay_request") {
      const args = request.params.arguments || {};
      const { url, method, headers, body } = args;

      try {
        const options = {
          method: method ? method.toUpperCase() : "GET",
          headers: {}
        };

        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            const lowerKey = key.toLowerCase();
            // Don't forward pseudo-headers or headers that break native fetch
            if (!lowerKey.startsWith(":") && !["host", "content-length", "connection"].includes(lowerKey)) {
              options.headers[key] = value;
            }
          }
        }

        if (body && !["GET", "HEAD"].includes(options.method)) {
          options.body = typeof body === "string" ? body : JSON.stringify(body);
        }

        const response = await fetch(url, options);
        const responseText = await response.text();
        const responseHeaders = Object.fromEntries(response.headers.entries());

        const result = {
          request: { url, method: options.method, headers: options.headers, body: options.body },
          response: { status: response.status, statusText: response.statusText, headers: responseHeaders, body: responseText }
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error replaying request: ${err.message}` }] };
      }
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
