import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  getPendingIntercept,
  listPendingIntercepts,
  resolvePendingIntercept,
} from "./state.js";
import {
  getTrafficLogs,
  getAllRules,
  addRule,
  removeRule,
  organizeLogIntoFolder,
  clearAllTrafficLogs,
  clearAllRules,
  executeRawQuery,
} from "./db.js";
import { sendCdpCommand, cdpEvents } from "./cdp.js";
import { MCP_TOOLS } from "./tools.js";

// ─── Module-level state for new tools ────────────────────────────────────────
let lastDomSnapshot = null; // for browser_dom_diff
const logBuffer = []; // for browser_get_console_logs (CDP Log.entryAdded events)
let logDomainEnabled = false;

const NOISE_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "googlesyndication.com",
  "facebook.net",
  "facebook.com/tr",
  "hotjar.com",
  "clarity.ms",
  "mixpanel.com",
  "segment.io",
  "segment.com",
  "amplitude.com",
  "fullstory.com",
  "intercom.io",
  "intercom.com",
  "datadoghq.com",
  "newrelic.com",
  "nr-data.net",
  "rollbar.com",
  "sentry.io",
  "bugsnag.com",
  "logrocket.com",
  "mouseflow.com",
  "heapanalytics.com",
  "crazyegg.com",
  "optimizely.com",
  "launchdarkly.com",
  "analytics.twitter.com",
  "ads.linkedin.com",
  "snap.licdn.com",
  "bat.bing.com",
  "connect.facebook.net",
  "cdn.branch.io",
  "cdn.mxpnl.com",
  "cdn.segment.com",
  "cdn.amplitude.com",
];

const KEY_MAP = {
  Enter: { code: "Enter", windowsVirtualKeyCode: 13 },
  Tab: { code: "Tab", windowsVirtualKeyCode: 9 },
  Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
  Backspace: { code: "Backspace", windowsVirtualKeyCode: 8 },
  Delete: { code: "Delete", windowsVirtualKeyCode: 46 },
  ArrowUp: { code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowDown: { code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { code: "ArrowRight", windowsVirtualKeyCode: 39 },
  Space: { code: "Space", windowsVirtualKeyCode: 32, text: " " },
  Home: { code: "Home", windowsVirtualKeyCode: 36 },
  End: { code: "End", windowsVirtualKeyCode: 35 },
  PageUp: { code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: { code: "PageDown", windowsVirtualKeyCode: 34 },
  F1: { code: "F1", windowsVirtualKeyCode: 112 },
  F5: { code: "F5", windowsVirtualKeyCode: 116 },
  F12: { code: "F12", windowsVirtualKeyCode: 123 },
};

const DEVICE_PRESETS = {
  "iPhone 15": {
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    mobile: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  "iPhone SE": {
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    mobile: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  "Pixel 8": {
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    mobile: true,
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  },
  "Samsung Galaxy S24": {
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
    mobile: true,
    ua: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  },
  "iPad Pro": {
    width: 1024,
    height: 1366,
    deviceScaleFactor: 2,
    mobile: true,
    ua: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  reset: {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
    ua: "",
  },
};

const FUZZ_PAYLOADS = {
  sqli_basic: [
    "'",
    '"',
    "' OR '1'='1",
    "' OR 1=1--",
    "'; DROP TABLE users--",
    "1 UNION SELECT null--",
    "admin'--",
    "' AND SLEEP(5)--",
    "1; WAITFOR DELAY '0:0:5'--",
    "' HAVING 1=1--",
    "' OR 'x'='x",
    '" OR "x"="x',
  ],
  xss_basic: [
    "<script>alert(1)</script>",
    '"><script>alert(1)</script>',
    "'><script>alert(1)</script>",
    "';alert(1)//",
    "<img src=x onerror=alert(1)>",
    "<svg onload=alert(1)>",
    "<iframe src=javascript:alert(1)>",
    "{{7*7}}",
    "${7*7}",
    "<body onload=alert(1)>",
  ],
  path_traversal: [
    "../etc/passwd",
    "../../etc/passwd",
    "../../../etc/passwd",
    "..%2F..%2Fetc%2Fpasswd",
    "....//....//etc/passwd",
    "%2e%2e%2f%2e%2e%2f",
    "..%5c..%5c",
    "/etc/passwd",
    "C:\\Windows\\System32\\drivers\\etc\\hosts",
    "....\\\\....\\\\etc\\\\passwd",
  ],
  nosqli_basic: [
    '{"$gt": ""}',
    '{"$ne": null}',
    '{"$regex": ".*"}',
    "' || '1'=='1",
    '{"$where": "1==1"}',
    '{$gt: ""}',
    "[$ne]=1",
    '{"$gt":""}',
  ],
  template_injection: [
    "{{7*7}}",
    "${7*7}",
    "<%= 7*7 %>",
    "#{7*7}",
    "*{7*7}",
    "{{config}}",
    "{{self.__dict__}}",
    '${T(java.lang.Runtime).getRuntime().exec("id")}',
  ],
};

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
    responseStatusCode:
      intercept.data?.responseStatusCode ?? intercept.responseStatusCode,
    responseStatusText:
      intercept.data?.responseStatusText ?? intercept.responseStatusText,
    responseHeaders:
      intercept.data?.responseHeaders ?? intercept.responseHeaders,
    responseBody: intercept.data?.responseBody ?? intercept.responseBody,
    createdAt: new Date(
      intercept.createdAt ?? intercept.timestamp,
    ).toISOString(),
    folder: intercept.data?.folder ?? intercept.folder,
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
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: MCP_TOOLS,
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "db_sql_query") {
      const args = request.params.arguments || {};
      try {
        const rows = executeRawQuery(args.query);
        if (rows.length === 0) {
          return {
            content: [{ type: "text", text: "No rows matched your query." }],
          };
        }

        // Let's cap the stringified output size just to be safe so we don't blow up the LLM
        let stringified = JSON.stringify(rows, null, 2);
        if (stringified.length > 200000) {
          return {
            content: [
              {
                type: "text",
                text:
                  stringified.substring(0, 200000) +
                  "\n\n[...RESULTS TRUNCATED TO SAVE CONTEXT WINDOW. ADD 'LIMIT' OR FILTER TO YOUR SQL QUERY...]\n",
              },
            ],
          };
        }

        return { content: [{ type: "text", text: stringified }] };
      } catch (e) {
        return {
          isError: true,
          content: [{ type: "text", text: "SQL Error: " + e.message }],
        };
      }
    }

    if (request.params.name === "add_rule") {
      const args = request.params.arguments || {};
      const rule = addRule(args);
      return {
        content: [
          {
            type: "text",
            text: `Successfully deployed rule: ${rule.name} (ID: ${rule.id}) to folder '${rule.folder}'`,
          },
        ],
      };
    }

    if (request.params.name === "list_rules") {
      const rules = getAllRules();
      if (rules.length === 0)
        return {
          content: [{ type: "text", text: "No rules currently deployed." }],
        };
      return {
        content: [{ type: "text", text: JSON.stringify(rules, null, 2) }],
      };
    }

    if (request.params.name === "remove_rule") {
      const { id } = request.params.arguments || {};
      const removed = removeRule(id);
      return {
        content: [
          {
            type: "text",
            text: removed ? `Rule ${id} removed.` : `Rule ${id} not found.`,
          },
        ],
      };
    }

    if (request.params.name === "clear_all_rules") {
      clearAllRules();
      return {
        content: [
          {
            type: "text",
            text: "Successfully deleted all zero-latency rules from the database.",
          },
        ],
      };
    }

    if (request.params.name === "browser_execute_cdp") {
      const args = request.params.arguments || {};
      try {
        const res = await sendCdpCommand(
          args.tabId || null,
          args.method,
          args.params || {},
        );
        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_extract_dom") {
      const args = request.params.arguments || {};
      try {
        let expression = "";
        if (args.format === "html") {
          expression = "document.documentElement.outerHTML";
        } else if (args.format === "text") {
          expression = "document.body.innerText";
        } else if (args.format === "markdown") {
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

        const res = await sendCdpCommand(null, "Runtime.evaluate", {
          expression,
          returnByValue: true,
        });
        if (res.exceptionDetails) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "Exception: " + res.exceptionDetails.exception.description,
              },
            ],
          };
        }

        let output = res.result.value || "";
        if (typeof output === "string" && output.length > 100000) {
          output =
            output.substring(0, 100000) +
            "\n\n[...TRUNCATED AT 100KB TO SAVE LLM CONTEXT WINDOW...]";
        }

        return { content: [{ type: "text", text: output }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_inject_payload") {
      const args = request.params.arguments || {};
      try {
        const res = await sendCdpCommand(null, "Runtime.evaluate", {
          expression: args.payload,
          returnByValue: true,
        });
        if (res.exceptionDetails) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "Exception: " + res.exceptionDetails.exception.description,
              },
            ],
          };
        }
        return {
          content: [
            { type: "text", text: JSON.stringify(res.result.value, null, 2) },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_new_tab") {
      const args = request.params.arguments || {};
      try {
        const res = await sendCdpCommand(null, "Target.createTarget", {
          url: args.url,
        });
        return {
          content: [
            {
              type: "text",
              text:
                "Successfully created new tab and attached to it. Target ID: " +
                res.targetId +
                " Tab ID: " +
                res.tabId,
            },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_close_tab") {
      const args = request.params.arguments || {};
      try {
        await sendCdpCommand(null, "Target.closeTarget", { tabId: args.tabId });
        return {
          content: [{ type: "text", text: "Successfully closed tab." }],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_switch_tab") {
      const args = request.params.arguments || {};
      try {
        await sendCdpCommand(null, "Target.activateTarget", {
          tabId: args.tabId,
        });
        return {
          content: [{ type: "text", text: "Successfully focused tab." }],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_list_tabs") {
      try {
        const res = await sendCdpCommand(null, "Target.getTabs", {});
        const tabs = res.tabs.map((t) => ({
          id: t.id,
          windowId: t.windowId,
          title: t.title,
          url: t.url,
          active: t.active,
          status: t.status,
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_navigate") {
      const args = request.params.arguments || {};
      try {
        await sendCdpCommand(null, "Page.navigate", { url: args.url });
        return {
          content: [{ type: "text", text: `Navigating to ${args.url}...` }],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_evaluate") {
      const args = request.params.arguments || {};
      try {
        const res = await sendCdpCommand(null, "Runtime.evaluate", {
          expression: args.expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (res.exceptionDetails) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "Exception: " + res.exceptionDetails.exception.description,
              },
            ],
          };
        }
        return {
          content: [
            { type: "text", text: JSON.stringify(res.result.value, null, 2) },
          ],
        };
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

          const drawRes = await sendCdpCommand(null, "Runtime.evaluate", {
            expression: drawExpression,
            returnByValue: true,
          });
          if (drawRes.result?.value?.error) {
            return {
              isError: true,
              content: [{ type: "text", text: drawRes.result.value.error }],
            };
          }
        }

        // Wait a tiny bit for rendering
        await new Promise((r) => setTimeout(r, 100));

        const res = await sendCdpCommand(null, "Page.captureScreenshot", {
          format: "png",
        });

        if (args.annotate) {
          const eraseExpression = `document.querySelectorAll('.openclaw-som-overlay').forEach(e => e.remove());`;
          await sendCdpCommand(null, "Runtime.evaluate", {
            expression: eraseExpression,
          });
        }

        return {
          content: [
            {
              type: "text",
              text:
                "Screenshot captured" +
                (args.annotate ? " with Set-of-Mark annotations" : "") +
                ":",
            },
            { type: "image", data: res.data, mimeType: "image/png" },
          ],
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
        const res = await sendCdpCommand(null, "Runtime.evaluate", {
          expression,
          returnByValue: true,
        });
        if (res.result?.value?.error)
          return {
            isError: true,
            content: [{ type: "text", text: res.result.value.error }],
          };
        return {
          content: [{ type: "text", text: `Clicked element successfully.` }],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_upload_file") {
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
            if (!el) return { error: 'Element not found!' };
            return el;
          })();
        `;
        const res = await sendCdpCommand(null, "Runtime.evaluate", {
          expression,
          returnByValue: false,
        });
        if (res.result?.value?.error)
          return {
            isError: true,
            content: [{ type: "text", text: res.result.value.error }],
          };
        if (!res.result?.objectId)
          return {
            isError: true,
            content: [
              { type: "text", text: "Could not get objectId for element." },
            ],
          };

        const path = await import("path");
        const huntingDir = path.resolve(process.cwd(), "../hunting");
        const filePath = path.resolve(huntingDir, args.filename);

        await sendCdpCommand(null, "DOM.enable", {});
        await sendCdpCommand(null, "DOM.setFileInputFiles", {
          files: [filePath],
          objectId: res.result.objectId,
        });

        return {
          content: [
            { type: "text", text: `Successfully uploaded file: ${filePath}` },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_download_file") {
      const args = request.params.arguments || {};
      try {
        const path = await import("path");
        const huntingDir = path.resolve(process.cwd(), "../hunting");

        // Use Page.setDownloadBehavior
        await sendCdpCommand(null, "Page.setDownloadBehavior", {
          behavior: "allow",
          downloadPath: huntingDir,
        });

        // Click the element
        const expression = `
          (() => {
            let el;
            if (${JSON.stringify(args.id)} != null && window.__openclawInteractables) {
               el = window.__openclawInteractables.get(Number(${JSON.stringify(args.id)}));
            } else if (${JSON.stringify(args.selector)}) {
               el = document.querySelector(${JSON.stringify(args.selector)});
            }
            if (!el) return { error: 'Element not found!' };
            el.click();
            return { ok: true };
          })();
        `;
        const res = await sendCdpCommand(null, "Runtime.evaluate", {
          expression,
          returnByValue: true,
        });
        if (res.result?.value?.error)
          return {
            isError: true,
            content: [{ type: "text", text: res.result.value.error }],
          };

        return {
          content: [
            {
              type: "text",
              text: `Download triggered. Files will be saved to: ${huntingDir}`,
            },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_get_cookies") {
      try {
        const res = await sendCdpCommand(null, "Network.getCookies", {});
        return {
          content: [
            { type: "text", text: JSON.stringify(res.cookies || [], null, 2) },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_set_cookies") {
      const args = request.params.arguments || {};
      try {
        if (!args.cookies || !Array.isArray(args.cookies)) {
          return {
            isError: true,
            content: [
              { type: "text", text: "Invalid cookies array provided." },
            ],
          };
        }
        await sendCdpCommand(null, "Network.setCookies", {
          cookies: args.cookies,
        });
        return {
          content: [{ type: "text", text: "Cookies set successfully." }],
        };
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
        const res = await sendCdpCommand(null, "Runtime.evaluate", {
          expression,
          returnByValue: true,
        });
        if (res.result?.value?.error)
          return {
            isError: true,
            content: [{ type: "text", text: res.result.value.error }],
          };
        return {
          content: [{ type: "text", text: `Typed text successfully.` }],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "get_pending_requests") {
      const pending = listPendingIntercepts().map(serializeIntercept);
      if (pending.length === 0) {
        return {
          content: [
            { type: "text", text: "No pending requests at the moment." },
          ],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(pending, null, 2) }],
      };
    }

    if (request.params.name === "get_traffic_history") {
      const args = request.params.arguments || {};
      const limit = args.limit ? Math.max(1, Math.min(args.limit, 100)) : 50;

      // Fetch more initially so we can filter properly before limiting
      let history = getTrafficLogs(1000).map(serializeIntercept);

      if (args.log_id) {
        history = history.filter((h) => h.id === args.log_id);
      } else {
        if (args.folder) {
          history = history.filter((h) => h.folder === args.folder);
        }
        if (args.url_filter) {
          history = history.filter(
            (h) => h.url && h.url.includes(args.url_filter),
          );
        }
        if (args.method_filter) {
          history = history.filter(
            (h) =>
              h.method &&
              h.method.toUpperCase() === args.method_filter.toUpperCase(),
          );
        }
        if (args.skip_noise) {
          history = history.filter(
            (h) =>
              !NOISE_DOMAINS.some((domain) => h.url && h.url.includes(domain)),
          );
        }
        if (args.light_mode) {
          history = history.map((h) => ({
            ...h,
            requestBody: h.requestBody
              ? `[Omitted in light_mode - Size: ${h.requestBody.length} chars]`
              : null,
            responseBody: h.responseBody
              ? `[Omitted in light_mode - Size: ${h.responseBody.length} chars]`
              : null,
          }));
        }
      }

      // Slice after filtering
      history = history.slice(0, limit);

      if (history.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No traffic history available matching filters.",
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(history, null, 2) }],
      };
    }

    if (request.params.name === "organize_traffic_log") {
      const { log_id, folder } = request.params.arguments || {};
      const success = organizeLogIntoFolder(log_id, folder);
      return {
        content: [
          {
            type: "text",
            text: success
              ? `Saved log ${log_id} to folder ${folder}`
              : `Log not found`,
          },
        ],
      };
    }

    if (request.params.name === "clear_traffic_logs") {
      clearAllTrafficLogs();
      return {
        content: [
          {
            type: "text",
            text: "Successfully deleted all traffic history logs from the database.",
          },
        ],
      };
    }

    if (request.params.name === "get_traffic_detail") {
      const args = request.params.arguments || {};
      const { log_id } = args;
      if (!log_id)
        return {
          isError: true,
          content: [{ type: "text", text: "log_id is required." }],
        };
      const rows = executeRawQuery(
        `SELECT * FROM traffic_logs WHERE id = '${log_id.replace(/'/g, "''")}'`,
      );
      if (!rows || rows.length === 0)
        return {
          content: [
            { type: "text", text: `No traffic log found with id: ${log_id}` },
          ],
        };
      return {
        content: [{ type: "text", text: JSON.stringify(rows[0], null, 2) }],
      };
    }

    if (request.params.name === "replay_request") {
      const args = request.params.arguments || {};
      const { url, method, headers, body } = args;

      try {
        const options = {
          method: method ? method.toUpperCase() : "GET",
          headers: {},
        };

        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            const lowerKey = key.toLowerCase();
            if (
              !lowerKey.startsWith(":") &&
              !["host", "content-length", "connection"].includes(lowerKey)
            ) {
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
        if (
          contentType.includes("image/") ||
          contentType.includes("video/") ||
          contentType.includes("application/zip") ||
          contentType.includes("application/octet-stream")
        ) {
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
          request: {
            url,
            method: options.method,
            headers: options.headers,
            body: options.body,
          },
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            body: responseText,
          },
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Error replaying request: ${err.message}` },
          ],
        };
      }
    }

    if (request.params.name === "resolve_request") {
      const args = request.params.arguments || {};
      const intercept = getPendingIntercept(args.id);

      if (!intercept) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Intercept ${args.id} not found or already resolved.`,
            },
          ],
        };
      }

      const resolved = resolvePendingIntercept(args.id, buildDecision(args));

      if (!resolved) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Intercept ${args.id} was no longer pending.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Resolved ${args.id} (${intercept.data.phase}) with action ${args.action}.`,
          },
        ],
      };
    }

    // ─── NEW TOOLS ────────────────────────────────────────────────────────────

    if (request.params.name === "browser_wait_for") {
      const args = request.params.arguments || {};
      const timeoutMs = args.timeout_ms || 10000;
      try {
        let expression = "";
        if (args.wait_type === "selector") {
          if (!args.selector)
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "selector is required when wait_type=selector",
                },
              ],
            };
          const sel = JSON.stringify(args.selector);
          expression = `new Promise((resolve, reject) => {
            const sel = ${sel};
            const start = Date.now();
            const check = () => {
              const el = document.querySelector(sel);
              if (el) return resolve({ found: true, tag: el.tagName, text: (el.innerText || el.value || '').substring(0, 80) });
              if (Date.now() - start > ${timeoutMs}) return reject(new Error('Timeout waiting for selector: ' + sel));
              setTimeout(check, 100);
            };
            check();
          })`;
        } else if (args.wait_type === "dom_stable") {
          expression = `new Promise((resolve) => {
            let tid;
            const STABLE_FOR = 300;
            const observer = new MutationObserver(() => {
              clearTimeout(tid);
              tid = setTimeout(() => { observer.disconnect(); resolve('DOM is stable'); }, STABLE_FOR);
            });
            observer.observe(document.body, { childList: true, subtree: true, attributes: true });
            tid = setTimeout(() => { observer.disconnect(); resolve('DOM is stable (initial)'); }, STABLE_FOR);
            setTimeout(() => { observer.disconnect(); resolve('DOM stable (max timeout)'); }, ${timeoutMs});
          })`;
        } else if (args.wait_type === "network_idle") {
          expression = `new Promise((resolve) => {
            if (document.readyState === 'complete') return resolve('Page already complete');
            window.addEventListener('load', () => resolve('load event fired'), { once: true });
            setTimeout(() => resolve('network_idle timeout'), ${timeoutMs});
          })`;
        }
        const res = await sendCdpCommand(null, "Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (res.exceptionDetails)
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "Wait failed: " + res.exceptionDetails.exception.description,
              },
            ],
          };
        return {
          content: [
            {
              type: "text",
              text: "Wait complete: " + JSON.stringify(res.result.value),
            },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_handle_dialog") {
      const args = request.params.arguments || {};
      try {
        await sendCdpCommand(null, "Page.handleJavaScriptDialog", {
          accept: args.action === "accept",
          promptText: args.prompt_text || "",
        });
        return {
          content: [
            { type: "text", text: `Dialog ${args.action}ed successfully.` },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_get_console_logs") {
      const args = request.params.arguments || {};
      const limit = args.limit || 200;
      try {
        // ── Step 1: Enable CDP Log domain (captures EVERYTHING DevTools shows:
        //   CSP violations, runtime errors, extension errors, console.* calls).
        //   This is idempotent — safe to call on every invocation.
        if (!logDomainEnabled) {
          try {
            await sendCdpCommand(null, "Log.enable", {});
            logDomainEnabled = true;
          } catch (e) {
            // Non-fatal — fall through to JS hook below
          }
        }

        // ── Step 2: Also install a JS-side hook so we capture console.* calls
        //   with rich parameter serialization (CDP Log gives only strings).
        //   This is idempotent via the __openclawConsoleLogs guard.
        const hookExpr = `(() => {
          if (window.__openclawConsoleLogs !== undefined) return 'already_hooked';
          window.__openclawConsoleLogs = [];
          const _orig = {};
          ['log','warn','error','info','debug'].forEach(lvl => {
            _orig[lvl] = console[lvl].bind(console);
            console[lvl] = (...a) => {
              window.__openclawConsoleLogs.push({
                level: lvl,
                source: 'console-api',
                msg: a.map(x => { try { return typeof x === 'object' ? JSON.stringify(x) : String(x); } catch(e) { return '[unserializable]'; } }).join(' '),
                t: Date.now()
              });
              _orig[lvl](...a);
            };
          });
          // Also catch uncaught errors and unhandled promise rejections
          window.addEventListener('error', (e) => {
            window.__openclawConsoleLogs.push({ level: 'error', source: 'javascript', msg: (e.message || String(e)) + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : ''), t: Date.now() });
          }, { capture: true });
          window.addEventListener('unhandledrejection', (e) => {
            window.__openclawConsoleLogs.push({ level: 'error', source: 'promise', msg: 'Unhandled rejection: ' + (e.reason?.message || String(e.reason)), t: Date.now() });
          });
          // CSP violation events
          document.addEventListener('securitypolicyviolation', (e) => {
            window.__openclawConsoleLogs.push({ level: 'error', source: 'security', msg: 'CSP violation: ' + e.violatedDirective + ' blocked ' + (e.blockedURI || '(inline)'), t: Date.now() });
          });
          return 'hooked';
        })()`;
        await sendCdpCommand(null, "Runtime.evaluate", {
          expression: hookExpr,
          returnByValue: true,
        });

        // ── Step 3: If early_install requested, register as a persistent init
        //   script so the hook survives page navigation / reload.
        if (args.early_install) {
          const initScript = `
            window.__openclawConsoleLogs = window.__openclawConsoleLogs || [];
            (() => {
              if (window.__openclawConsoleHookPersisted) return;
              window.__openclawConsoleHookPersisted = true;
              const _orig = {};
              ['log','warn','error','info','debug'].forEach(lvl => {
                _orig[lvl] = console[lvl].bind(console);
                console[lvl] = (...a) => {
                  window.__openclawConsoleLogs.push({ level: lvl, source: 'console-api', msg: a.map(x => { try { return typeof x === 'object' ? JSON.stringify(x) : String(x); } catch(e) { return '[unserializable]'; } }).join(' '), t: Date.now() });
                  _orig[lvl](...a);
                };
              });
              window.addEventListener('error', (e) => { window.__openclawConsoleLogs.push({ level: 'error', source: 'javascript', msg: (e.message || String(e)) + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : ''), t: Date.now() }); }, { capture: true });
              window.addEventListener('unhandledrejection', (e) => { window.__openclawConsoleLogs.push({ level: 'error', source: 'promise', msg: 'Unhandled rejection: ' + (e.reason?.message || String(e.reason)), t: Date.now() }); });
              document.addEventListener('securitypolicyviolation', (e) => { window.__openclawConsoleLogs.push({ level: 'error', source: 'security', msg: 'CSP violation: ' + e.violatedDirective + ' blocked ' + (e.blockedURI || '(inline)'), t: Date.now() }); });
            })();
          `;
          try {
            await sendCdpCommand(
              null,
              "Page.addScriptToEvaluateOnNewDocument",
              { source: initScript },
            );
          } catch (e) {
            /* non-fatal */
          }
        }

        // ── Step 4: Merge CDP logBuffer (browser-level events) + JS hook logs.
        //   CDP log captures what DevTools shows; JS hook gives richer params.
        let cdpLogs = [...logBuffer];
        if (args.clear) logBuffer.length = 0;

        // Apply source_filter if requested
        if (args.source_filter && args.source_filter.length) {
          cdpLogs = cdpLogs.filter((l) =>
            args.source_filter.includes(l.source),
          );
        }

        // Get JS hook logs from page
        const getExpr = `(() => {
          const logs = window.__openclawConsoleLogs || [];
          const filtered = ${
            args.level_filter && args.level_filter.length
              ? `logs.filter(l => ${JSON.stringify(args.level_filter)}.includes(l.level))`
              : "logs"
          };
          ${args.clear ? "window.__openclawConsoleLogs = [];" : ""}
          return filtered;
        })()`;
        const res = await sendCdpCommand(null, "Runtime.evaluate", {
          expression: getExpr,
          returnByValue: true,
        });
        if (res.exceptionDetails)
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "Exception: " + res.exceptionDetails.exception.description,
              },
            ],
          };
        const jsLogs = res.result.value || [];

        // Deduplicate: CDP and JS hook both capture console.* calls.
        // Prefer JS hook entries (richer) and use CDP entries for browser-level
        // events that JS can't see (source != 'console-api').
        const nativeOnlyLogs = cdpLogs.filter(
          (l) => l.source !== "console-api",
        );
        const merged = [...nativeOnlyLogs, ...jsLogs]
          .sort((a, b) => (a.t || 0) - (b.t || 0))
          .slice(-limit);

        if (merged.length === 0)
          return {
            content: [
              {
                type: "text",
                text:
                  "No console messages yet.\n" +
                  "• CDP Log domain: " +
                  (logDomainEnabled ? "active ✓" : "inactive") +
                  "\n" +
                  "• JS hook: installed ✓ (captures future console.* calls, uncaught errors, CSP violations)\n" +
                  (args.early_install
                    ? "• Persistent init script: installed ✓ (survives page reload)\n"
                    : "") +
                  "\nTip: call browser_get_console_logs again after triggering actions on the page.",
              },
            ],
          };

        const summary = `${merged.length} messages (${nativeOnlyLogs.length} browser-level via CDP, ${jsLogs.length} via JS hook):`;
        return {
          content: [
            {
              type: "text",
              text: summary + "\n" + JSON.stringify(merged, null, 2),
            },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_hover") {
      const args = request.params.arguments || {};
      try {
        const coordExpr = `(() => {
          let el;
          if (${JSON.stringify(args.id)} != null && window.__openclawInteractables) {
            el = window.__openclawInteractables.get(Number(${JSON.stringify(args.id)}));
          } else if (${JSON.stringify(args.selector)}) {
            el = document.querySelector(${JSON.stringify(args.selector)});
          }
          if (!el) return null;
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`;
        const coordRes = await sendCdpCommand(null, "Runtime.evaluate", {
          expression: coordExpr,
          returnByValue: true,
        });
        if (!coordRes.result?.value)
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Element not found for hover. Did you run browser_extract_dom first?",
              },
            ],
          };
        const { x, y } = coordRes.result.value;
        await sendCdpCommand(null, "Input.dispatchMouseEvent", {
          type: "mouseMovedToElement",
          x,
          y,
          modifiers: 0,
        });
        await sendCdpCommand(null, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y,
          modifiers: 0,
        });
        // Dispatch JS mouseover/mouseenter for apps relying on JS events
        await sendCdpCommand(null, "Runtime.evaluate", {
          expression: `(() => {
            let el;
            if (${JSON.stringify(args.id)} != null && window.__openclawInteractables) {
              el = window.__openclawInteractables.get(Number(${JSON.stringify(args.id)}));
            } else if (${JSON.stringify(args.selector)}) {
              el = document.querySelector(${JSON.stringify(args.selector)});
            }
            if (el) {
              el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
              el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            }
          })()`,
          returnByValue: true,
        });
        return {
          content: [
            { type: "text", text: `Hovered over element at (${x}, ${y}).` },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_press_key") {
      const args = request.params.arguments || {};
      const keyInfo = KEY_MAP[args.key];
      if (!keyInfo)
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown key: ${args.key}` }],
        };
      try {
        const base = {
          key: args.key,
          code: keyInfo.code,
          windowsVirtualKeyCode: keyInfo.windowsVirtualKeyCode,
          nativeVirtualKeyCode: keyInfo.windowsVirtualKeyCode,
          modifiers: 0,
        };
        if (keyInfo.text) base.text = keyInfo.text;
        await sendCdpCommand(null, "Input.dispatchKeyEvent", {
          ...base,
          type: "rawKeyDown",
        });
        if (keyInfo.text)
          await sendCdpCommand(null, "Input.dispatchKeyEvent", {
            ...base,
            type: "char",
          });
        await sendCdpCommand(null, "Input.dispatchKeyEvent", {
          ...base,
          type: "keyUp",
        });
        return {
          content: [{ type: "text", text: `Pressed key: ${args.key}` }],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_drag") {
      const args = request.params.arguments || {};
      try {
        const getCoords = async (id, selector) => {
          const expr = `(() => {
            let el;
            if (${JSON.stringify(id)} != null && window.__openclawInteractables) {
              el = window.__openclawInteractables.get(Number(${JSON.stringify(id)}));
            } else if (${JSON.stringify(selector)}) {
              el = document.querySelector(${JSON.stringify(selector)});
            }
            if (!el) return null;
            el.scrollIntoView({ block: 'center', inline: 'center' });
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
          })()`;
          const res = await sendCdpCommand(null, "Runtime.evaluate", {
            expression: expr,
            returnByValue: true,
          });
          return res.result?.value || null;
        };

        const from = await getCoords(args.from_id, args.from_selector);
        const to = await getCoords(args.to_id, args.to_selector);
        if (!from)
          return {
            isError: true,
            content: [{ type: "text", text: "Source element not found." }],
          };
        if (!to)
          return {
            isError: true,
            content: [{ type: "text", text: "Target element not found." }],
          };

        const STEPS = 12;
        await sendCdpCommand(null, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: from.x,
          y: from.y,
          button: "left",
          buttons: 1,
          clickCount: 1,
          modifiers: 0,
        });
        for (let i = 1; i <= STEPS; i++) {
          const x = Math.round(from.x + (to.x - from.x) * (i / STEPS));
          const y = Math.round(from.y + (to.y - from.y) * (i / STEPS));
          await sendCdpCommand(null, "Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x,
            y,
            button: "left",
            buttons: 1,
            modifiers: 0,
          });
        }
        await sendCdpCommand(null, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: to.x,
          y: to.y,
          button: "left",
          buttons: 0,
          clickCount: 1,
          modifiers: 0,
        });
        return {
          content: [
            {
              type: "text",
              text: `Dragged from (${from.x},${from.y}) to (${to.x},${to.y}).`,
            },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_emulate_device") {
      const args = request.params.arguments || {};
      try {
        let cfg = args.preset ? DEVICE_PRESETS[args.preset] : null;
        if (!cfg)
          cfg = {
            width: args.custom_width || 1280,
            height: args.custom_height || 800,
            deviceScaleFactor: 1,
            mobile: args.mobile || false,
            ua: args.custom_ua || "",
          };
        const ua = args.custom_ua || cfg.ua;

        await sendCdpCommand(null, "Emulation.setDeviceMetricsOverride", {
          width: cfg.width,
          height: cfg.height,
          deviceScaleFactor: cfg.deviceScaleFactor,
          mobile: cfg.mobile,
          screenWidth: cfg.width,
          screenHeight: cfg.height,
          screenOrientation: {
            type:
              cfg.height > cfg.width ? "portraitPrimary" : "landscapePrimary",
            angle: cfg.height > cfg.width ? 0 : 90,
          },
        });
        if (ua)
          await sendCdpCommand(null, "Emulation.setUserAgentOverride", {
            userAgent: ua,
          });
        await sendCdpCommand(null, "Emulation.setTouchEmulationEnabled", {
          enabled: cfg.mobile,
          maxTouchPoints: cfg.mobile ? 5 : 0,
        });

        const label = args.preset || `custom ${cfg.width}x${cfg.height}`;
        return {
          content: [
            {
              type: "text",
              text: `Device emulation set to: ${label}. Viewport: ${cfg.width}x${cfg.height}, Mobile: ${cfg.mobile}. Reload the page for full effect.`,
            },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_memory_scan") {
      try {
        const expression = `(() => {
          const findings = [];
          const patterns = [
            { name: 'JWT',             rx: /ey[A-Za-z0-9\\-_]{10,}\\.[A-Za-z0-9\\-_]{10,}\\.[A-Za-z0-9\\-_]{10,}/g },
            { name: 'BearerToken',     rx: /Bearer\\s+([A-Za-z0-9\\-._~+\\/]+=*)/gi },
            { name: 'APIKey',          rx: /(api[_\\-]?key|api[_\\-]?secret|access[_\\-]?token|auth[_\\-]?token)['":\\s=]+([A-Za-z0-9\\-_.]{16,})/gi },
            { name: 'AWSAccessKey',    rx: /AKIA[0-9A-Z]{16}/g },
            { name: 'PrivateKey',      rx: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g },
            { name: 'Password',        rx: /["\\'](password|passwd|secret)["\\'\\s]*[:=]\\s*["\\']((?!undefined|null)[^\\"\\' ]{4,})["\\'']/gi },
            { name: 'BasicAuthCred',   rx: /[A-Za-z0-9+\\/]{40,}={0,2}/g },
          ];
          function scan(text, src) {
            for (const { name, rx } of patterns) {
              const matches = [];
              let m;
              const r = new RegExp(rx.source, rx.flags);
              while ((m = r.exec(text)) !== null) matches.push(m[0].substring(0, 120));
              if (matches.length) findings.push({ type: name, source: src, matches });
            }
          }
          try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); scan(k + '=' + localStorage.getItem(k), 'localStorage[' + k + ']'); } } catch(e) {}
          try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); scan(k + '=' + sessionStorage.getItem(k), 'sessionStorage[' + k + ']'); } } catch(e) {}
          try { scan(document.cookie, 'cookies'); } catch(e) {}
          try { document.querySelectorAll('meta[content]').forEach(m => scan(m.content || '', 'meta[' + (m.name || m.property || '') + ']')); } catch(e) {}
          try { document.querySelectorAll('script:not([src])').forEach((s, i) => { const c = s.textContent || ''; if (c.length < 60000) scan(c, 'inlineScript[' + i + ']'); }); } catch(e) {}
          try {
            const keys = Object.getOwnPropertyNames(window).slice(0, 300);
            for (const k of keys) {
              try {
                const v = window[k];
                if (typeof v === 'string' && v.length > 8 && v.length < 4000) scan(v, 'window.' + k);
                else if (v && typeof v === 'object' && !Array.isArray(v)) { const s = JSON.stringify(v); if (s && s.length < 8000) scan(s, 'window.' + k); }
              } catch(e) {}
            }
          } catch(e) {}
          return findings;
        })()`;
        const res = await sendCdpCommand(null, "Runtime.evaluate", {
          expression,
          returnByValue: true,
        });
        if (res.exceptionDetails)
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "Exception: " + res.exceptionDetails.exception.description,
              },
            ],
          };
        const findings = res.result.value || [];
        if (findings.length === 0)
          return {
            content: [
              {
                type: "text",
                text: "No secrets found in JS-accessible memory. (Encrypted apps like 1Password store keys only in heap RAM — use browser_execute_cdp with HeapProfiler for deeper analysis.)",
              },
            ],
          };
        return {
          content: [{ type: "text", text: JSON.stringify(findings, null, 2) }],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_websocket_hook") {
      try {
        const hookExpression = `(() => {
          if (window.__openclawWsHooked) return { status: 'already_hooked', count: Object.keys(window.__openclawWsSockets || {}).length };
          window.__openclawWsHooked = true;
          window.__openclawWsSockets = {};
          window.__openclawWsLog = [];
          window.__openclawWsNextId = 1;
          const OrigWS = window.WebSocket;
          window.WebSocket = function(url, protocols) {
            const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
            const id = window.__openclawWsNextId++;
            window.__openclawWsSockets[id] = { id, url, readyState: 0, ws };
            ws.addEventListener('open', () => { window.__openclawWsSockets[id].readyState = 1; window.__openclawWsLog.push({ id, type: 'open', url, t: Date.now() }); });
            ws.addEventListener('close', (e) => { window.__openclawWsSockets[id].readyState = 3; window.__openclawWsLog.push({ id, type: 'close', url, code: e.code, reason: e.reason, t: Date.now() }); });
            ws.addEventListener('error', () => { window.__openclawWsLog.push({ id, type: 'error', url, t: Date.now() }); });
            ws.addEventListener('message', (e) => {
              const data = typeof e.data === 'string' ? e.data.substring(0, 1000) : '[binary frame]';
              window.__openclawWsLog.push({ id, type: 'recv', url, data, t: Date.now() });
            });
            const origSend = ws.send.bind(ws);
            ws.send = (data) => {
              const logged = typeof data === 'string' ? data.substring(0, 1000) : '[binary]';
              window.__openclawWsLog.push({ id, type: 'sent', url, data: logged, t: Date.now() });
              return origSend(data);
            };
            return ws;
          };
          Object.assign(window.WebSocket, OrigWS);
          window.WebSocket.prototype = OrigWS.prototype;
          return { status: 'hooked' };
        })()`;
        const res = await sendCdpCommand(null, "Runtime.evaluate", {
          expression: hookExpression,
          returnByValue: true,
        });
        if (res.exceptionDetails)
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "Exception: " + res.exceptionDetails.exception.description,
              },
            ],
          };
        return {
          content: [
            {
              type: "text",
              text:
                "WebSocket hook: " +
                JSON.stringify(res.result.value) +
                ". All future WebSocket connections will be captured.",
            },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_websocket_list") {
      const args = request.params.arguments || {};
      const limit = args.limit || 50;
      try {
        const expression = `(() => {
          const sockets = Object.values(window.__openclawWsSockets || {}).map(s => ({ id: s.id, url: s.url, readyState: s.readyState, states: ['CONNECTING','OPEN','CLOSING','CLOSED'][s.readyState] || 'UNKNOWN' }));
          const log = ${args.include_log ? `(window.__openclawWsLog || []).slice(-${limit})` : "[]"};
          return { hooked: !!window.__openclawWsHooked, sockets, log };
        })()`;
        const res = await sendCdpCommand(null, "Runtime.evaluate", {
          expression,
          returnByValue: true,
        });
        if (res.exceptionDetails)
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "Exception: " + res.exceptionDetails.exception.description,
              },
            ],
          };
        return {
          content: [
            { type: "text", text: JSON.stringify(res.result.value, null, 2) },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_websocket_send") {
      const args = request.params.arguments || {};
      try {
        const expression = `(() => {
          if (!window.__openclawWsSockets) return { error: 'WebSocket hook not installed. Run browser_websocket_hook first.' };
          const conn = window.__openclawWsSockets[${Number(args.id)}];
          if (!conn) return { error: 'WebSocket ID ${args.id} not found. Use browser_websocket_list to see active connections.' };
          if (conn.readyState !== 1) return { error: 'WebSocket ID ${args.id} is not OPEN (current state: ' + ['CONNECTING','OPEN','CLOSING','CLOSED'][conn.readyState] + ')' };
          conn.ws.send(${JSON.stringify(args.message)});
          return { sent: true, id: ${Number(args.id)}, url: conn.url, message: ${JSON.stringify(String(args.message).substring(0, 100))} };
        })()`;
        const res = await sendCdpCommand(null, "Runtime.evaluate", {
          expression,
          returnByValue: true,
        });
        if (res.exceptionDetails)
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "Exception: " + res.exceptionDetails.exception.description,
              },
            ],
          };
        const val = res.result.value;
        if (val?.error)
          return {
            isError: true,
            content: [{ type: "text", text: val.error }],
          };
        return {
          content: [
            { type: "text", text: "Frame sent: " + JSON.stringify(val) },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_dom_diff") {
      const args = request.params.arguments || {};
      const fmt = args.format || "markdown";
      try {
        let expression = "";
        if (fmt === "html") {
          expression = "document.documentElement.outerHTML";
        } else {
          expression = `(() => {
            let interactiveId = 1;
            window.__openclawInteractables = new Map();
            function walk(node) {
              if (node.nodeType === Node.TEXT_NODE) return node.textContent.trim() ? node.textContent.trim() + ' ' : '';
              if (node.nodeType !== Node.ELEMENT_NODE) return '';
              const style = window.getComputedStyle(node);
              if (style.display === 'none' || style.visibility === 'hidden') return '';
              const tag = node.tagName.toLowerCase();
              if (['script','style','noscript','svg','canvas','img','video','audio'].includes(tag)) return '';
              let out = '';
              const isInteractive = tag === 'a' || tag === 'button' || tag === 'input' || tag === 'textarea' || node.onclick != null || node.getAttribute('role') === 'button';
              if (isInteractive) { const cid = interactiveId++; window.__openclawInteractables.set(cid, node); out += '[ID:' + cid + ' ' + tag.toUpperCase() + ' '; }
              if (tag === 'input' || tag === 'textarea') { out += 'type="' + (node.type||'text') + '" value="' + (node.value||'') + '"] '; return out; }
              for (const c of node.childNodes) out += walk(c);
              if (isInteractive) { if (tag === 'a' && node.href) out += ' (href: ' + node.href + ')'; out += '] '; }
              if (['div','p','h1','h2','h3','h4','h5','h6','section','article','li','ul','ol','form','tr'].includes(tag)) out = '\\n' + out.trim() + '\\n';
              return out;
            }
            return walk(document.body).replace(/\\n\\s*\\n/g, '\\n').trim();
          })()`;
        }
        const res = await sendCdpCommand(null, "Runtime.evaluate", {
          expression,
          returnByValue: true,
        });
        if (res.exceptionDetails)
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "Exception: " + res.exceptionDetails.exception.description,
              },
            ],
          };
        const currentDom = (res.result.value || "").substring(0, 120000);

        if (args.reset || !lastDomSnapshot) {
          lastDomSnapshot = currentDom;
          return {
            content: [
              {
                type: "text",
                text: args.reset
                  ? "DOM baseline reset."
                  : "No previous snapshot — baseline stored. Make your action, then call browser_dom_diff again.",
              },
            ],
          };
        }

        // Compute line-level diff
        const oldLines = new Set(
          lastDomSnapshot
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
        );
        const newLines = new Set(
          currentDom
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
        );
        const added = [...newLines]
          .filter((l) => !oldLines.has(l))
          .map((l) => "+ " + l);
        const removed = [...oldLines]
          .filter((l) => !newLines.has(l))
          .map((l) => "- " + l);
        lastDomSnapshot = currentDom;

        if (added.length === 0 && removed.length === 0)
          return {
            content: [
              {
                type: "text",
                text: "No DOM changes detected since last snapshot.",
              },
            ],
          };
        const diff = [...removed.slice(0, 100), ...added.slice(0, 100)].join(
          "\n",
        );
        return {
          content: [
            {
              type: "text",
              text: `DOM diff (${removed.length} removed, ${added.length} added):\n${diff}`,
            },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    }

    if (request.params.name === "browser_fuzz") {
      const args = request.params.arguments || {};
      const {
        url,
        method,
        headers = {},
        body_template,
        param_name,
        payload_type,
        num_start = 1,
        num_end = 100,
        custom_payloads = [],
        concurrency = 5,
        timeout_ms = 8000,
      } = args;

      try {
        // Build payload list
        let payloads = [];
        if (payload_type === "numbers") {
          const end = Math.min(num_end, num_start + 999); // cap at 1000
          for (let i = num_start; i <= end; i++) payloads.push(String(i));
        } else if (payload_type === "custom") {
          payloads = custom_payloads;
        } else if (FUZZ_PAYLOADS[payload_type]) {
          payloads = FUZZ_PAYLOADS[payload_type];
        }
        if (payloads.length === 0)
          return {
            isError: true,
            content: [{ type: "text", text: "No payloads to fuzz with." }],
          };

        // Baseline request
        const buildRequest = (payload) => {
          let reqUrl = url.includes("{{FUZZ}}")
            ? url.replace(/\{\{FUZZ\}\}/g, encodeURIComponent(payload))
            : url;
          if (param_name && !url.includes("{{FUZZ}}")) {
            const u = new URL(reqUrl);
            u.searchParams.set(param_name, payload);
            reqUrl = u.toString();
          }
          let reqBody = body_template
            ? body_template.replace(/\{\{FUZZ\}\}/g, payload)
            : undefined;
          const opts = {
            method: method.toUpperCase(),
            headers: { ...headers },
            signal: AbortSignal.timeout(timeout_ms),
          };
          for (const k of ["host", "content-length", "connection"])
            delete opts.headers[k];
          if (reqBody && !["GET", "HEAD"].includes(opts.method))
            opts.body = reqBody;
          return { url: reqUrl, opts };
        };

        const baseline = buildRequest("BASELINE_OPENCLAW_TEST");
        let baselineStatus = 200,
          baselineLength = 0;
        try {
          const br = await fetch(baseline.url, baseline.opts);
          const bt = await br.text();
          baselineStatus = br.status;
          baselineLength = bt.length;
        } catch (e) {}

        // Run fuzzing with concurrency
        const results = {
          total: payloads.length,
          baseline: { status: baselineStatus, length: baselineLength },
          anomalies: [],
        };
        const maxConcurrency = Math.min(concurrency, 20);

        const runBatch = async (batch) => {
          await Promise.all(
            batch.map(async (payload) => {
              try {
                const { url: reqUrl, opts } = buildRequest(payload);
                const r = await fetch(reqUrl, opts);
                const body = await r.text();
                const lenDiff = Math.abs(body.length - baselineLength);
                const statusChanged = r.status !== baselineStatus;
                if (statusChanged || lenDiff > 50) {
                  results.anomalies.push({
                    payload: payload.substring(0, 80),
                    status: r.status,
                    length: body.length,
                    lenDiff,
                    preview: body.substring(0, 200),
                  });
                }
              } catch (e) {
                // Timeout or network error — skip
              }
            }),
          );
        };

        for (let i = 0; i < payloads.length; i += maxConcurrency) {
          await runBatch(payloads.slice(i, i + maxConcurrency));
        }

        if (results.anomalies.length === 0)
          return {
            content: [
              {
                type: "text",
                text: `Fuzzing complete. ${results.total} payloads tested. No anomalies detected (all matched baseline status=${baselineStatus}, length≈${baselineLength}).`,
              },
            ],
          };
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      } catch (e) {
        return {
          isError: true,
          content: [{ type: "text", text: "Fuzz error: " + e.message }],
        };
      }
    }

    if (request.params.name === "browser_pause_for_human") {
      const args = request.params.arguments || {};
      const message =
        args.message || "Please complete the verification and click Resume AI";
      const timeoutSeconds = args.timeout_seconds || 300;
      try {
        // Inject overlay
        const injectExpr = `(() => {
          document.getElementById('__openclaw_pause__')?.remove();
          window.__openclawPaused = true;
          const overlay = document.createElement('div');
          overlay.id = '__openclaw_pause__';
          overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.82);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';
          overlay.innerHTML = '<div style="background:#fff;padding:36px 44px;border-radius:12px;text-align:center;max-width:480px;box-shadow:0 8px 40px rgba(0,0,0,0.4)"><div style="font-size:48px;margin-bottom:12px">🤖</div><h2 style="margin:0 0 12px;font-size:22px;color:#111">AI Paused</h2><p style="margin:0 0 24px;color:#444;font-size:16px;line-height:1.5">${message.replace(/"/g, '\\"')}</p><button id="__openclaw_resume__" style="background:#1a73e8;color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:17px;font-weight:600;cursor:pointer;">▶ Resume AI</button></div>';
          document.body.appendChild(overlay);
          document.getElementById('__openclaw_resume__').addEventListener('click', () => { window.__openclawPaused = false; overlay.remove(); });
          return 'overlay_injected';
        })()`;
        await sendCdpCommand(null, "Runtime.evaluate", {
          expression: injectExpr,
          returnByValue: true,
        });

        // Poll until resumed or timeout
        const startMs = Date.now();
        const maxMs = timeoutSeconds * 1000;
        while (Date.now() - startMs < maxMs) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            const checkRes = await sendCdpCommand(null, "Runtime.evaluate", {
              expression:
                "window.__openclawPaused === false ? 'resumed' : 'waiting'",
              returnByValue: true,
            });
            if (checkRes.result?.value === "resumed") {
              return {
                content: [
                  { type: "text", text: "Human resumed. Continuing..." },
                ],
              };
            }
          } catch (e) {
            /* extension might briefly disconnect — keep polling */
          }
        }
        // Timed out — clean up overlay
        await sendCdpCommand(null, "Runtime.evaluate", {
          expression:
            "document.getElementById('__openclaw_pause__')?.remove(); window.__openclawPaused = false;",
          returnByValue: true,
        }).catch(() => {});
        return {
          content: [
            {
              type: "text",
              text: `Human pause timed out after ${timeoutSeconds}s. Continuing anyway.`,
            },
          ],
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
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
      res.status(403).json({
        error: "Remote AI access (SSE) is disabled in the dashboard.",
      });
      return;
    }
    console.error("[MCP] New SSE connection established (Remote AI)");
    sseServer = createMcpServerInstance();
    sseTransport = new SSEServerTransport("/message", res);
    await sseServer.connect(sseTransport);
  });

  app.post("/message", async (req, res) => {
    if (!global.sseEnabled || !sseTransport) {
      res.status(403).json({
        error: "Remote AI access (SSE) is disabled or not connected.",
      });
      return;
    }
    await sseTransport.handlePostMessage(req, res);
  });
}

import { randomUUID } from "crypto";

const wsUrls = new Map();

cdpEvents.on("event", ({ event, params }) => {
  // ── CDP Log domain: buffer ALL browser-level log entries ──────────────────
  // This is what Chrome DevTools itself uses — captures CSP violations,
  // runtime.lastError, uncaught exceptions, network errors, etc.
  if (event === "Log.entryAdded" && params?.entry) {
    const e = params.entry;
    logBuffer.push({
      level: e.level, // verbose | info | warning | error
      source: e.source, // console-api | javascript | network | security | other | ...
      text: (e.text || "").substring(0, 600),
      url: e.url || null,
      line: e.lineNumber || null,
      t: Date.now(),
    });
    // Keep buffer bounded — drop oldest when over 2000 entries
    if (logBuffer.length > 2000) logBuffer.splice(0, logBuffer.length - 2000);
  }

  // ── Re-enable Log domain after extension reconnects ───────────────────────
  // When the extension SSE stream drops and reconnects, the CDP session
  // resets and Log.enable must be re-sent.
  if (event === "__streamReconnected__") {
    logDomainEnabled = false; // will be re-enabled on next browser_get_console_logs call
  }

  // ── WebSocket traffic logging ─────────────────────────────────────────────
  if (event === "Network.webSocketCreated") {
    wsUrls.set(params.requestId, params.url);
  }
  if (
    event === "Network.webSocketFrameSent" ||
    event === "Network.webSocketFrameReceived"
  ) {
    const isSent = event === "Network.webSocketFrameSent";
    const payloadData = params.response?.payloadData || "";
    const url = wsUrls.get(params.requestId) || "ws-req-" + params.requestId;

    import("./db.js").then(({ addTrafficLog }) => {
      addTrafficLog({
        id: randomUUID(),
        phase: isSent ? "WebSocket:Sent" : "WebSocket:Received",
        method: isSent ? "WSS_SEND" : "WSS_RECV",
        url: url,
        requestBody: isSent ? payloadData : undefined,
        responseBody: !isSent ? payloadData : undefined,
        mode: "listen",
      });
    });
  }
});
