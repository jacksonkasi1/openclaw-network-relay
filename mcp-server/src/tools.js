export const MCP_TOOLS = [

        {
          name: "browser_new_tab",
          description: "Open a new background tab in the attached browser.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to open in the new tab" }
            },
            required: ["url"]
          }
        },
        {
          name: "browser_close_tab",
          description: "Close a specific tab in the attached browser.",
          inputSchema: {
            type: "object",
            properties: {
              tabId: { type: "number", description: "The ID of the tab to close. Defaults to the currently attached tab." }
            }
          }
        },
        {
          name: "browser_switch_tab",
          description: "Bring a specific tab to the foreground and make it the active tab.",
          inputSchema: {
            type: "object",
            properties: {
              tabId: { type: "number", description: "The ID of the tab to activate." }
            },
            required: ["tabId"]
          }
        },
        {
          name: "browser_list_tabs",
          description: "Get a list of all open tabs in the browser, including their IDs, titles, and URLs.",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },
        {
          name: "db_sql_query",
          description: "Execute a raw, read-only SQL SELECT query against the high-performance local SQLite database. Gives you MAXIMUM control to filter or analyze network traffic! Tables available:\n1. 'rules' (id, name, folder, urlPattern, method, phase, action, modifiedBody, isActive, createdAt)\n2. 'traffic_logs' (id, folder, phase, mode, url, method, requestHeaders, requestBody, responseStatusCode, responseHeaders, responseBody, timestamp)",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "The raw SQL SELECT statement to execute (e.g. 'SELECT id, url, method FROM traffic_logs WHERE responseStatusCode >= 400 ORDER BY timestamp DESC')" }
            },
            required: ["query"]
          }
        },


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
          name: "browser_extract_dom",
          description: "Extract the page content. 'markdown' provides a highly compressed, token-efficient view of buttons/inputs/text for the LLM. 'html' gives raw DOM for vulnerability scanning. 'text' gives raw innerText.",
          inputSchema: {
            type: "object",
            properties: {
              format: { type: "string", enum: ["markdown", "html", "text"], description: "Whether to return full HTML or just text content" }
            },
            required: ["format"]
          }
        },
        {
          name: "browser_inject_payload",
          description: "Inject and execute a security payload (JavaScript) directly into the page context. Bypasses some network-level filters.",
          inputSchema: {
            type: "object",
            properties: {
              payload: { type: "string", description: "The JavaScript payload to execute" }
            },
            required: ["payload"]
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
          description: "Take a screenshot of the attached browser tab. Can optionally draw Set-of-Mark (SoM) bounding boxes over interactive elements if you need visual help finding buttons.",
          inputSchema: {
            type: "object",
            properties: {
              annotate: { type: "boolean", description: "Draw numbered red bounding boxes over every interactive element on the screen. (You MUST run browser_extract_dom first to generate the IDs!)" }
            }
          }
        },
        {
          name: "browser_click",
          description: "Click an element on the page. You can use EITHER the numeric 'id' returned from browser_extract_dom (markdown format), OR a standard CSS 'selector'. Prefer the numeric ID.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "number", description: "Numeric ID from browser_extract_dom markdown (e.g. 5)" },
              selector: { type: "string", description: "CSS selector fallback" }
            }
          }
        },
        {
          name: "browser_upload_file",
          description: "Upload a file from the local /hunting directory to a file input element.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "number", description: "Numeric ID from browser_extract_dom" },
              selector: { type: "string", description: "CSS selector fallback" },
              filename: { type: "string", description: "Name of the file in the /hunting directory" }
            },
            required: ["filename"]
          }
        },
        {
          name: "browser_download_file",
          description: "Click an element that triggers a download and save the file to the local /hunting directory.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "number", description: "Numeric ID of the download link/button" },
              selector: { type: "string", description: "CSS selector fallback" }
            }
          }
        },
        {
          name: "browser_get_cookies",
          description: "Get all browser cookies for the current page.",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },
        {
          name: "browser_set_cookies",
          description: "Set or modify cookies.",
          inputSchema: {
            type: "object",
            properties: {
              cookies: { 
                type: "array", 
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    value: { type: "string" },
                    domain: { type: "string" },
                    path: { type: "string" }
                  },
                  required: ["name", "value"]
                }
              }
            },
            required: ["cookies"]
          }
        },
        {
          name: "browser_type",
          description: "Type text into an input field. You can use EITHER the numeric 'id' returned from browser_extract_dom (markdown format), OR a standard CSS 'selector'. Prefer the numeric ID.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "number", description: "Numeric ID from browser_extract_dom markdown (e.g. 12)" },
              selector: { type: "string", description: "CSS selector fallback" },
              text: { type: "string", description: "Text to type" }
            },
            required: ["text"]
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
      
];
