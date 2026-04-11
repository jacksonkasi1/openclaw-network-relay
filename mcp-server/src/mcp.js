import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getPendingIntercept, listPendingIntercepts, resolvePendingIntercept } from './state.js';
import { getTrafficLogs, getAllRules, addRule, removeRule, organizeLogIntoFolder, clearAllTrafficLogs, clearAllRules, executeRawQuery } from './db.js';
import { sendCdpCommand } from './cdp.js';
import { MCP_TOOLS } from './tools.js';


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
      tools: MCP_TOOLS
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {


    if (request.params.name === "db_sql_query") {
      const args = request.params.arguments || {};
      try {
        const rows = executeRawQuery(args.query);
        if (rows.length === 0) {
          return { content: [{ type: "text", text: "No rows matched your query." }] };
        }
        
        // Let's cap the stringified output size just to be safe so we don't blow up the LLM
        let stringified = JSON.stringify(rows, null, 2);
        if (stringified.length > 200000) {
          return { content: [{ type: "text", text: stringified.substring(0, 200000) + "\n\n[...RESULTS TRUNCATED TO SAVE CONTEXT WINDOW. ADD 'LIMIT' OR FILTER TO YOUR SQL QUERY...]\n" }] };
        }
        
        return { content: [{ type: "text", text: stringified }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: "SQL Error: " + e.message }] };
      }
    }
  
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


    if (request.params.name === "browser_extract_dom") {
      const args = request.params.arguments || {};
      try {
        let expression = '';
        if (args.format === 'html') {
          expression = 'document.documentElement.outerHTML';
        } else if (args.format === 'text') {
          expression = 'document.body.innerText';
        } else if (args.format === 'markdown') {
          expression = `
            (() => {
              let interactiveId = 1;
              window.__openclawInteractables = new Map();
              
              function walk(node) {
                if (node.nodeType === Node.TEXT_NODE) {
                  return node.textContent.trim() ? node.textContent.trim() + ' ' : '';
                }
                if (node.nodeType !== Node.ELEMENT_NODE) return '';
                
                const style = window.getComputedStyle(node);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return '';
                
                const tag = node.tagName.toLowerCase();
                if (['script', 'style', 'noscript', 'svg', 'canvas', 'img', 'video', 'audio'].includes(tag)) return '';

                let out = '';
                
                const isInteractive = tag === 'a' || tag === 'button' || tag === 'input' || tag === 'textarea' || node.onclick != null || node.getAttribute('role') === 'button';
                let currentId = null;
                
                if (isInteractive) {
                  currentId = interactiveId++;
                  window.__openclawInteractables.set(currentId, node);
                  out += \`[ID:\${currentId} \${tag.toUpperCase()} \`;
                }

                if (tag === 'input' || tag === 'textarea') {
                   const type = node.type || 'text';
                   const placeholder = node.placeholder || '';
                   const val = node.value || '';
                   out += \`type="\${type}" \${placeholder ? 'placeholder="'+placeholder+'" ' : ''}value="\${val}"] \`;
                   return out; // Inputs rarely have text children we care about
                }

                for (const child of node.childNodes) {
                  out += walk(child);
                }

                if (isInteractive) {
                  if (tag === 'a' && node.href) out += \` (href: \${node.href})\`;
                  out += '] ';
                }
                
                if (['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'li', 'ul', 'ol', 'form', 'tr'].includes(tag)) {
                  out = '\\n' + out.trim() + '\\n';
                }
                
                return out;
              }
              const result = walk(document.body).replace(/\\n\\s*\\n/g, '\\n').trim();
              return result;
            })();
          `;
        }

        const res = await sendCdpCommand(null, "Runtime.evaluate", { expression, returnByValue: true });
        if (res.exceptionDetails) {
           return { isError: true, content: [{ type: "text", text: "Exception: " + res.exceptionDetails.exception.description }] };
        }
        
        let output = res.result.value || "";
        if (typeof output === 'string' && output.length > 100000) {
           output = output.substring(0, 100000) + "\n\n[...TRUNCATED AT 100KB TO SAVE LLM CONTEXT WINDOW...]";
        }

        return { content: [{ type: "text", text: output }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_inject_payload") {
      const args = request.params.arguments || {};
      try {
        const res = await sendCdpCommand(null, "Runtime.evaluate", { expression: args.payload, returnByValue: true });
        if (res.exceptionDetails) {
           return { isError: true, content: [{ type: "text", text: "Exception: " + res.exceptionDetails.exception.description }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(res.result.value, null, 2) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }


    if (request.params.name === "browser_new_tab") {
      const args = request.params.arguments || {};
      try {
        const res = await sendCdpCommand(null, "Target.createTarget", { url: args.url });
        return { content: [{ type: "text", text: "Successfully created new tab and attached to it. Target ID: " + res.targetId + " Tab ID: " + res.tabId }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_close_tab") {
      const args = request.params.arguments || {};
      try {
        await sendCdpCommand(null, "Target.closeTarget", { tabId: args.tabId });
        return { content: [{ type: "text", text: "Successfully closed tab." }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_switch_tab") {
      const args = request.params.arguments || {};
      try {
        await sendCdpCommand(null, "Target.activateTarget", { tabId: args.tabId });
        return { content: [{ type: "text", text: "Successfully focused tab." }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_list_tabs") {
      try {
        const res = await sendCdpCommand(null, "Target.getTabs", {});
        const tabs = res.tabs.map(t => ({ id: t.id, windowId: t.windowId, title: t.title, url: t.url, active: t.active, status: t.status }));
        return { content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }] };
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
        const res = await sendCdpCommand(null, "Runtime.evaluate", { expression: args.expression, returnByValue: true, awaitPromise: true });
        if (res.exceptionDetails) {
           return { isError: true, content: [{ type: "text", text: "Exception: " + res.exceptionDetails.exception.description }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(res.result.value, null, 2) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_screenshot") {
      const args = request.params.arguments || {};
      try {
        if (args.annotate) {
          const drawExpression = `
            (() => {
              if (!window.__openclawInteractables) return { error: "No elements mapped! You must run browser_extract_dom (format: markdown) first before requesting an annotated screenshot." };
              
              // Remove any existing overlays just in case
              document.querySelectorAll('.openclaw-som-overlay').forEach(e => e.remove());
              
              for (const [id, node] of window.__openclawInteractables.entries()) {
                const rect = node.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                
                const overlay = document.createElement('div');
                overlay.className = 'openclaw-som-overlay';
                overlay.style.position = 'absolute';
                overlay.style.top = (window.scrollY + rect.top) + 'px';
                overlay.style.left = (window.scrollX + rect.left) + 'px';
                overlay.style.width = rect.width + 'px';
                overlay.style.height = rect.height + 'px';
                overlay.style.border = '2px solid red';
                overlay.style.zIndex = '2147483647';
                overlay.style.pointerEvents = 'none';
                
                const label = document.createElement('div');
                label.textContent = id;
                label.style.position = 'absolute';
                label.style.top = '-16px';
                label.style.left = '-2px';
                label.style.backgroundColor = 'red';
                label.style.color = 'white';
                label.style.fontSize = '12px';
                label.style.fontWeight = 'bold';
                label.style.padding = '1px 4px';
                label.style.borderRadius = '2px';
                
                overlay.appendChild(label);
                document.body.appendChild(overlay);
              }
              return { ok: true };
            })();
          `;
          
          const drawRes = await sendCdpCommand(null, "Runtime.evaluate", { expression: drawExpression, returnByValue: true });
          if (drawRes.result?.value?.error) {
            return { isError: true, content: [{ type: "text", text: drawRes.result.value.error }] };
          }
        }
        
        // Wait a tiny bit for rendering
        await new Promise(r => setTimeout(r, 100));

        const res = await sendCdpCommand(null, "Page.captureScreenshot", { format: "png" });
        
        if (args.annotate) {
          const eraseExpression = `document.querySelectorAll('.openclaw-som-overlay').forEach(e => e.remove());`;
          await sendCdpCommand(null, "Runtime.evaluate", { expression: eraseExpression });
        }

        return { 
          content: [
            { type: "text", text: "Screenshot captured" + (args.annotate ? " with Set-of-Mark annotations" : "") + ":" },
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
            let el;
            if (${JSON.stringify(args.id)} != null && window.__openclawInteractables) {
               el = window.__openclawInteractables.get(Number(${JSON.stringify(args.id)}));
            } else if (${JSON.stringify(args.selector)}) {
               el = document.querySelector(${JSON.stringify(args.selector)});
            }
            if (!el) return { error: 'Element not found! Did you run browser_extract_dom first?' };
            el.scrollIntoView({block: "center", inline: "center"});
            el.click();
            return { ok: true };
          })();
        `;
        const res = await sendCdpCommand(null, "Runtime.evaluate", { expression, returnByValue: true });
        if (res.result?.value?.error) return { isError: true, content: [{ type: "text", text: res.result.value.error }] };
        return { content: [{ type: "text", text: `Clicked element successfully.` }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_type") {
      const args = request.params.arguments || {};
      try {
        const expression = `
          (() => {
            let el;
            if (${JSON.stringify(args.id)} != null && window.__openclawInteractables) {
               el = window.__openclawInteractables.get(Number(${JSON.stringify(args.id)}));
            } else if (${JSON.stringify(args.selector)}) {
               el = document.querySelector(${JSON.stringify(args.selector)});
            }
            if (!el) return { error: 'Element not found! Did you run browser_extract_dom first?' };
            el.scrollIntoView({block: "center", inline: "center"});
            el.focus();
            el.value = ${JSON.stringify(args.text)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true };
          })();
        `;
        const res = await sendCdpCommand(null, "Runtime.evaluate", { expression, returnByValue: true });
        if (res.result?.value?.error) return { isError: true, content: [{ type: "text", text: res.result.value.error }] };
        return { content: [{ type: "text", text: `Typed text successfully.` }] };
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