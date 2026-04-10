import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getPendingIntercept, listPendingIntercepts, resolvePendingIntercept } from './state.js';
import { getTrafficLogs, getAllRules, addRule, removeRule, organizeLogIntoFolder } from './db.js';

function serializeIntercept(intercept) {
  return {
    id: intercept.id,
    phase: intercept.data?.phase || intercept.phase,
    tabId: intercept.data?.tabId || intercept.tabId,
    resourceType: intercept.data?.resourceType || intercept.resourceType,
    url: intercept.data?.url || intercept.url,
    method: intercept.data?.method || intercept.method,
    requestHeaders: intercept.data?.requestHeaders || intercept.requestHeaders,
    requestBody: intercept.data?.requestBody || intercept.requestBody,
    responseStatusCode: intercept.data?.responseStatusCode || intercept.responseStatusCode,
    responseStatusText: intercept.data?.responseStatusText || intercept.responseStatusText,
    responseHeaders: intercept.data?.responseHeaders || intercept.responseHeaders,
    responseBody: intercept.data?.responseBody || intercept.responseBody,
    createdAt: new Date(intercept.createdAt || intercept.timestamp).toISOString(),
    folder: intercept.data?.folder || intercept.folder
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
    { name: "openclaw-burpsuite-agent", version: "3.0.0" },
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
              folder: { type: "string", description: "Folder/Collection name to group this rule (e.g. 'Firefox', 'Apple')" },
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
          description: "List recently logged network requests/responses from SQLite DB. Useful for analyzing API structure before intercepting.",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", description: "Number of recent items to return (default 50, max 100)" },
              folder: { type: "string", description: "Filter by a specific folder/collection name" }
            }
          }
        },
        {
          name: "organize_traffic_log",
          description: "Save or categorize a specific traffic log into a folder/collection (e.g. 'Firefox', 'Auth').",
          inputSchema: {
            type: "object",
            properties: {
              log_id: { type: "string", description: "The ID of the traffic log to organize" },
              folder: { type: "string", description: "The name of the folder/collection to put it in" }
            },
            required: ["log_id", "folder"]
          }
        },
        {
          name: "replay_request",
          description: "Simulate/Replay a network request directly from the MCP server. You do not need the user to trigger it in the browser! You can freely specify the URL, method, headers, and body.",
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
              modifiedMethod: { type: "string" },
              modifiedUrl: { type: "string" },
              modifiedHeaders: { type: "object" },
              modifiedBody: { type: "string" },
              modifiedStatusCode: { type: "number" },
              modifiedResponseHeaders: { type: "object" },
              modifiedResponseBody: { type: "string" }
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
      return { content: [{ type: "text", text: `Successfully deployed rule: ${rule.name} (ID: ${rule.id}) to folder '${rule.folder}'` }] };
    }

    if (request.params.name === "list_rules") {
      const rules = getAllRules();
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
      let history = getTrafficLogs(limit).map(serializeIntercept);
      
      if (args.folder) {
        history = history.filter(h => h.folder === args.folder);
      }

      if (history.length === 0) {
        return { content: [{ type: "text", text: "No traffic history available." }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(history, null, 2) }] };
    }

    if (request.params.name === "organize_traffic_log") {
      const { log_id, folder } = request.params.arguments || {};
      const success = organizeLogIntoFolder(log_id, folder);
      return { content: [{ type: "text", text: success ? `Saved log ${log_id} to folder ${folder}` : `Log not found` }] };
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
            if (!lowerKey.startsWith(":") && !["host", "content-length", "connection"].includes(lowerKey)) {
              options.headers[key] = value;
            }
          }
        }

        if (body && !["GET", "HEAD"].includes(options.method)) {
          options.body = typeof body === "string" ? body : JSON.stringify(body);
        }

        const response = await fetch(url, options);
        let responseText;
        const contentType = response.headers.get("content-type") || "";
        
        // Prevent crashing the MCP server or returning garbled text on massive binary responses
        if (contentType.includes("image/") || contentType.includes("video/") || contentType.includes("application/zip") || contentType.includes("application/octet-stream")) {
          responseText = `[Binary Data Omitted - Content-Type: ${contentType}]`;
        } else {
          responseText = await response.text();
          // Truncate massively large text files
          if (responseText.length > 50000) {
            responseText = responseText.substring(0, 50000) + "... [Truncated]";
          }
        }

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
        return { isError: true, content: [{ type: "text", text: `Intercept ${args.id} not found or already resolved.` }] };
      }

      const resolved = resolvePendingIntercept(args.id, buildDecision(args));

      if (!resolved) {
        return { isError: true, content: [{ type: "text", text: `Intercept ${args.id} was no longer pending.` }] };
      }

      return { content: [{ type: "text", text: `Resolved ${args.id} (${intercept.data.phase}) with action ${args.action}.` }] };
    }

    throw new Error(`Tool not found: ${request.params.name}`);
  });

  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error("[MCP] STDIO bridge ready");
  });
}