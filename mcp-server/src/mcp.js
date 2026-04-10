import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getPendingIntercept, listPendingIntercepts, resolvePendingIntercept } from './state.js';
import { getTrafficLogs, getAllRules, addRule, removeRule, organizeLogIntoFolder, clearAllTrafficLogs, clearAllRules } from './db.js';
import { sendCdpCommand } from './cdp.js';

function serializeIntercept(intercept) {
  return {
    id: intercept.id,
    phase: intercept.data?.phase ?? intercept.phase,
    tabId: intercept.data?.tabId ?? intercept.tabId,
    resourceType: intercept.data?.resourceType ?? intercept.resourceType,
    url: intercept.data?.url ?? intercept.url,
    method: intercept.data?.method ?? intercept.method,
    requestHeaders: intercept.data?.requestHeaders ?? intercept.requestHeaders,
    requestBody: intercept.data?.requestBody ?? intercept.requestBody,
    responseStatusCode: intercept.data?.responseStatusCode ?? intercept.responseStatusCode,
    responseStatusText: intercept.data?.responseStatusText ?? intercept.responseStatusText,
    responseHeaders: intercept.data?.responseHeaders ?? intercept.responseHeaders,
    responseBody: intercept.data?.responseBody ?? intercept.responseBody,
    createdAt: new Date(intercept.createdAt ?? intercept.timestamp).toISOString(),
    folder: intercept.data?.folder ?? intercept.folder
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

function createMcpServerInstance() {
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
          name: "clear_all_rules",
          description: "Permanently delete ALL Zero-Latency interception rules from the SQLite database.",
          inputSchema: { type: "object", properties: {} }
        },

        {
          name: "browser_execute_cdp",
          description: "Execute a raw Chrome DevTools Protocol (CDP) command on the attached browser tab. Requires Intercept mode to be ON in the extension.",
          inputSchema: {
            type: "object",
            properties: {
              method: { type: "string", description: "CDP method name (e.g. 'Page.navigate')" },
              params: { type: "object", description: "Parameters for the CDP method" },
              tabId: { type: "number", description: "Optional specific tab ID. Omit to use the currently attached tab." }
            },
            required: ["method"]
          }
        },
        {
          name: "browser_navigate",
          description: "Navigate the attached browser tab to a specific URL.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string" }
            },
            required: ["url"]
          }
        },
        {
          name: "browser_evaluate",
          description: "Execute JavaScript in the attached browser tab and return the result.",
          inputSchema: {
            type: "object",
            properties: {
              expression: { type: "string", description: "JavaScript code to evaluate" }
            },
            required: ["expression"]
          }
        },
        {
          name: "browser_screenshot",
          description: "Take a full page screenshot of the attached browser tab.",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },
        {
          name: "browser_click",
          description: "Click an element on the page using a CSS selector.",
          inputSchema: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector of the element to click" }
            },
            required: ["selector"]
          }
        },
        {
          name: "browser_type",
          description: "Type text into an input field on the page using a CSS selector.",
          inputSchema: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector of the input element" },
              text: { type: "string", description: "Text to type" }
            },
            required: ["selector", "text"]
          }
        },

        {
          name: "get_pending_requests",
          description: "List all currently paused browser intercepts. Includes request-phase and response-phase events.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "get_traffic_history",
          description: "List recently logged network requests/responses from SQLite DB. Use filters or light_mode to avoid overwhelming context with massive payloads.",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", description: "Number of recent items to return (default 50, max 100)" },
              folder: { type: "string", description: "Filter by a specific folder/collection name" },
              url_filter: { type: "string", description: "Only return requests where the URL contains this string" },
              method_filter: { type: "string", description: "Only return requests with this HTTP method (e.g. 'POST')" },
              light_mode: { type: "boolean", description: "If true, omits request and response bodies to save context space. Highly recommended for general exploration!" },
              log_id: { type: "string", description: "Fetch the full details of one specific log by its ID." }
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
          name: "clear_traffic_logs",
          description: "Permanently delete ALL traffic history logs from the SQLite database.",
          inputSchema: { type: "object", properties: {} }
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

    if (request.params.name === "clear_all_rules") {
      clearAllRules();
      return { content: [{ type: "text", text: "Successfully deleted all zero-latency rules from the database." }] };
    }


    if (request.params.name === "browser_execute_cdp") {
      const args = request.params.arguments || {};
      try {
        const res = await sendCdpCommand(args.tabId || null, args.method, args.params || {});
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_navigate") {
      const args = request.params.arguments || {};
      try {
        await sendCdpCommand(null, "Page.navigate", { url: args.url });
        return { content: [{ type: "text", text: `Navigating to ${args.url}...` }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_evaluate") {
      const args = request.params.arguments || {};
      try {
        const res = await sendCdpCommand(null, "Runtime.evaluate", { expression: args.expression, returnByValue: true });
        if (res.exceptionDetails) {
           return { isError: true, content: [{ type: "text", text: "Exception: " + res.exceptionDetails.exception.description }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(res.result.value, null, 2) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_screenshot") {
      try {
        const res = await sendCdpCommand(null, "Page.captureScreenshot", { format: "png" });
        return { 
          content: [
            { type: "text", text: "Screenshot captured:" },
            { type: "image", data: res.data, mimeType: "image/png" }
          ] 
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_click") {
      const args = request.params.arguments || {};
      try {
        const expression = `
          (() => {
            const el = document.querySelector(${JSON.stringify(args.selector)});
            if (!el) return { error: 'Element not found' };
            el.scrollIntoView({block: "center", inline: "center"});
            el.click();
            return { ok: true };
          })();
        `;
        const res = await sendCdpCommand(null, "Runtime.evaluate", { expression, returnByValue: true });
        if (res.result?.value?.error) return { isError: true, content: [{ type: "text", text: res.result.value.error }] };
        return { content: [{ type: "text", text: `Clicked ${args.selector}` }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_type") {
      const args = request.params.arguments || {};
      try {
        const expression = `
          (() => {
            const el = document.querySelector('${args.selector.replace(/'/g, "\\'")}');
            if (!el) return { error: 'Element not found' };
            el.value = '${args.text.replace(/'/g, "\\\'")}';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true };
          })();
        `;
        const res = await sendCdpCommand(null, "Runtime.evaluate", { expression, returnByValue: true });
        if (res.result?.value?.error) return { isError: true, content: [{ type: "text", text: res.result.value.error }] };
        return { content: [{ type: "text", text: `Typed into ${args.selector}` }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
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
      const limit = args.limit ? Math.max(1, Math.min(args.limit, 100)) : 50;
      
      // Fetch more initially so we can filter properly before limiting
      let history = getTrafficLogs(1000).map(serializeIntercept);
      
      if (args.log_id) {
        history = history.filter(h => h.id === args.log_id);
      } else {
        if (args.folder) {
          history = history.filter(h => h.folder === args.folder);
        }
        if (args.url_filter) {
          history = history.filter(h => h.url && h.url.includes(args.url_filter));
        }
        if (args.method_filter) {
          history = history.filter(h => h.method && h.method.toUpperCase() === args.method_filter.toUpperCase());
        }
        if (args.light_mode) {
          history = history.map(h => ({
            ...h,
            requestBody: h.requestBody ? `[Omitted in light_mode - Size: ${h.requestBody.length} chars]` : null,
            responseBody: h.responseBody ? `[Omitted in light_mode - Size: ${h.responseBody.length} chars]` : null
          }));
        }
      }
      
      // Slice after filtering
      history = history.slice(0, limit);

      if (history.length === 0) {
        return { content: [{ type: "text", text: "No traffic history available matching filters." }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(history, null, 2) }] };
    }

    if (request.params.name === "organize_traffic_log") {
      const { log_id, folder } = request.params.arguments || {};
      const success = organizeLogIntoFolder(log_id, folder);
      return { content: [{ type: "text", text: success ? `Saved log ${log_id} to folder ${folder}` : `Log not found` }] };
    }

    if (request.params.name === "clear_traffic_logs") {
      clearAllTrafficLogs();
      return { content: [{ type: "text", text: "Successfully deleted all traffic history logs from the database." }] };
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

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        options.signal = controller.signal;
        
        let response;
        try {
          response = await fetch(url, options);
        } finally {
          clearTimeout(timeoutId);
        }
        
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

  return server;
}

export function startMcpServer(app) {
  // 1. STDIO Transport (For Local AI on Mac)
  const stdioServer = createMcpServerInstance();
  const stdioTransport = new StdioServerTransport();
  stdioServer.connect(stdioTransport).then(() => {
    console.error("[MCP] STDIO bridge ready (Local AI)");
  });

  // 2. SSE Transport (For Remote AI on VM)
  let sseServer = null;
  let sseTransport = null;

  app.get("/sse", async (req, res) => {
    if (!global.sseEnabled) {
      res.status(403).json({ error: "Remote AI access (SSE) is disabled in the dashboard." });
      return;
    }
    console.error("[MCP] New SSE connection established (Remote AI)");
    sseServer = createMcpServerInstance();
    sseTransport = new SSEServerTransport("/message", res);
    await sseServer.connect(sseTransport);
  });

  app.post("/message", async (req, res) => {
    if (!global.sseEnabled || !sseTransport) {
      res.status(403).json({ error: "Remote AI access (SSE) is disabled or not connected." });
      return;
    }
    await sseTransport.handlePostMessage(req, res);
  });
}