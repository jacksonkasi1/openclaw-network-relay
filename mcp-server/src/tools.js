export const MCP_TOOLS = [
  {
    name: "browser_new_tab",
    description: "Open a new background tab in the attached browser.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        url: { type: "string", description: "URL to open in the new tab" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_close_tab",
    description: "Close a specific tab in the attached browser.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        tabId: {
          type: "number",
          description:
            "The ID of the tab to close. Defaults to the currently attached tab.",
        },
      },
    },
  },
  {
    name: "browser_switch_tab",
    description:
      "Bring a specific tab to the foreground and make it the active tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        tabId: {
          type: "number",
          description: "The ID of the tab to activate.",
        },
      },
      required: ["tabId"],
    },
  },
  {
    name: "browser_list_tabs",
    description:
      "Get a list of all open tabs in the browser, including their IDs, titles, and URLs.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
      },
    },
  },
  {
    name: "db_sql_query",
    description:
      "Execute a raw, read-only SQL SELECT query against the high-performance local SQLite database. Gives you MAXIMUM control to filter or analyze network traffic! Tables available:\n1. 'rules' (id, name, folder, urlPattern, method, phase, action, modifiedBody, isActive, createdAt)\n2. 'traffic_logs' (id, folder, phase, mode, url, method, requestHeaders, requestBody, responseStatusCode, responseHeaders, responseBody, timestamp)",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        query: {
          type: "string",
          description:
            "The raw SQL SELECT statement to execute (e.g. 'SELECT id, url, method FROM traffic_logs WHERE responseStatusCode >= 400 ORDER BY timestamp DESC')",
        },
      },
      required: ["query"],
    },
  },

  {
    name: "add_rule",
    description:
      "Deploy a Zero-Latency Interception Rule. Pushes a rule to the browser extension that executes instantly without pausing the browser. Use this to auto-mock endpoints or bypass paywalls.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        name: { type: "string", description: "Readable name for this rule" },
        folder: {
          type: "string",
          description:
            "Folder/Collection name to group this rule (e.g. 'Firefox', 'Apple')",
        },
        urlPattern: {
          type: "string",
          description: "Substring match for the URL (e.g. '/api/checkout')",
        },
        method: {
          type: "string",
          description: "HTTP method to match (e.g. 'POST', 'GET'). Optional.",
        },
        phase: {
          type: "string",
          enum: ["request", "response", "both"],
          description: "Which phase this rule applies to",
        },
        action: {
          type: "string",
          enum: ["modify", "drop", "forward"],
          description: "What to do instantly when matched",
        },
        modifiedMethod: { type: "string" },
        modifiedUrl: { type: "string" },
        modifiedHeaders: { type: "object" },
        modifiedBody: { type: "string" },
        modifiedStatusCode: { type: "number" },
        modifiedResponseHeaders: { type: "object" },
        modifiedResponseBody: { type: "string" },
      },
      required: ["name", "urlPattern", "phase", "action"],
    },
  },
  {
    name: "list_rules",
    description: "List all currently deployed Zero-Latency rules.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
      },
    },
  },
  {
    name: "remove_rule",
    description: "Remove a specific deployed rule by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "clear_all_rules",
    description:
      "Permanently delete ALL Zero-Latency interception rules from the SQLite database.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
      },
    },
  },

  {
    name: "browser_execute_cdp",
    description:
      "Execute a raw Chrome DevTools Protocol (CDP) command on the attached browser tab. Requires Intercept mode to be ON in the extension.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        method: {
          type: "string",
          description: "CDP method name (e.g. 'Page.navigate')",
        },
        params: {
          type: "object",
          description: "Parameters for the CDP method",
        },
        tabId: {
          type: "number",
          description:
            "Optional specific tab ID. Omit to use the currently attached tab.",
        },
      },
      required: ["method"],
    },
  },

  {
    name: "browser_extract_dom",
    description:
      "Extract the page content. 'markdown' provides a highly compressed, token-efficient view of buttons/inputs/text for the LLM. 'html' gives raw DOM for vulnerability scanning. 'text' gives raw innerText.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        format: {
          type: "string",
          enum: ["markdown", "html", "text"],
          description: "Whether to return full HTML or just text content",
        },
      },
      required: ["format"],
    },
  },
  {
    name: "browser_inject_payload",
    description:
      "Inject and execute a security payload (JavaScript) directly into the page context. Bypasses some network-level filters.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        payload: {
          type: "string",
          description: "The JavaScript payload to execute",
        },
      },
      required: ["payload"],
    },
  },
  {
    name: "browser_navigate",
    description: "Navigate the attached browser tab to a specific URL.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        url: { type: "string" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_evaluate",
    description:
      "Execute JavaScript in the attached browser tab and return the result.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        expression: {
          type: "string",
          description: "JavaScript code to evaluate",
        },
      },
      required: ["expression"],
    },
  },
  {
    name: "browser_screenshot",
    description:
      "Take a screenshot of the attached browser tab. Can optionally draw Set-of-Mark (SoM) bounding boxes over interactive elements if you need visual help finding buttons.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        annotate: {
          type: "boolean",
          description:
            "Draw numbered red bounding boxes over every interactive element on the screen. (You MUST run browser_extract_dom first to generate the IDs!)",
        },
      },
    },
  },
  {
    name: "browser_click",
    description:
      "Click an element on the page. You can use EITHER the numeric 'id' returned from browser_extract_dom (markdown format), OR a standard CSS 'selector'. Prefer the numeric ID.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        id: {
          type: "number",
          description: "Numeric ID from browser_extract_dom markdown (e.g. 5)",
        },
        selector: { type: "string", description: "CSS selector fallback" },
      },
    },
  },
  {
    name: "browser_upload_file",
    description:
      "Upload a file from the local /hunting directory to a file input element.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        id: {
          type: "number",
          description: "Numeric ID from browser_extract_dom",
        },
        selector: { type: "string", description: "CSS selector fallback" },
        filename: {
          type: "string",
          description: "Name of the file in the /hunting directory",
        },
      },
      required: ["filename"],
    },
  },
  {
    name: "browser_download_file",
    description:
      "Click an element that triggers a download and save the file to the local /hunting directory.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        id: {
          type: "number",
          description: "Numeric ID of the download link/button",
        },
        selector: { type: "string", description: "CSS selector fallback" },
      },
    },
  },
  {
    name: "browser_get_cookies",
    description: "Get all browser cookies for the current page.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
      },
    },
  },
  {
    name: "browser_set_cookies",
    description: "Set or modify cookies.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        cookies: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tabId: {
                type: "integer",
                description:
                  "Target tab ID (optional, defaults to first attached tab)",
              },
              name: { type: "string" },
              value: { type: "string" },
              domain: { type: "string" },
              path: { type: "string" },
            },
            required: ["name", "value"],
          },
        },
      },
      required: ["cookies"],
    },
  },
  {
    name: "browser_type",
    description:
      "Type text into an input field. You can use EITHER the numeric 'id' returned from browser_extract_dom (markdown format), OR a standard CSS 'selector'. Prefer the numeric ID.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        id: {
          type: "number",
          description: "Numeric ID from browser_extract_dom markdown (e.g. 12)",
        },
        selector: { type: "string", description: "CSS selector fallback" },
        text: { type: "string", description: "Text to type" },
      },
      required: ["text"],
    },
  },

  {
    name: "get_pending_requests",
    description:
      "List all currently paused browser intercepts. Includes request-phase and response-phase events.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
      },
    },
  },
  {
    name: "get_traffic_history",
    description:
      "List recently logged network requests/responses from SQLite DB. " +
      "CONTEXT-SAFE DEFAULTS: limit defaults to 20, light_mode defaults to true (request/response bodies and raw headers are omitted). " +
      "Use get_traffic_detail for the full payload of a specific log entry. " +
      "Pass light_mode:false only when you explicitly need bodies — it will flood the context window.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        limit: {
          type: "number",
          description:
            "Number of recent items to return (default 20, max 100). Keep low to avoid context bloat.",
        },
        folder: {
          type: "string",
          description: "Filter by a specific folder/collection name",
        },
        url_filter: {
          type: "string",
          description:
            "Only return requests where the URL contains this string",
        },
        method_filter: {
          type: "string",
          description:
            "Only return requests with this HTTP method (e.g. 'POST')",
        },
      },
    },
  },
  {
    name: "get_traffic_detail",
    description:
      "Fetch the full details of a specific traffic log by its ID. Used to view massive request/response payloads.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        log_id: {
          type: "string",
          description: "The ID of the traffic log to deeply inspect",
        },
      },
      required: ["log_id"],
    },
  },
  {
    name: "organize_traffic_log",
    description:
      "Save or categorize a specific traffic log into a folder/collection (e.g. 'Firefox', 'Auth').",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        log_id: {
          type: "string",
          description: "The ID of the traffic log to organize",
        },
        folder: {
          type: "string",
          description: "The name of the folder/collection to put it in",
        },
      },
      required: ["log_id", "folder"],
    },
  },
  {
    name: "clear_traffic_logs",
    description:
      "Permanently delete ALL traffic history logs from the SQLite database.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
      },
    },
  },
  {
    name: "replay_request",
    description:
      "Simulate/Replay a network request directly from the MCP server. You do not need the user to trigger it in the browser! You can freely specify the URL, method, headers, and body.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        url: {
          type: "string",
          description: "The full URL to send the request to",
        },
        method: {
          type: "string",
          description: "HTTP method (GET, POST, PUT, etc.)",
        },
        headers: {
          type: "object",
          description:
            "HTTP headers object (including Cookies, Authorization, etc.)",
        },
        body: {
          type: "string",
          description: "Stringified request body (optional)",
        },
      },
      required: ["url", "method"],
    },
  },
  {
    name: "resolve_request",
    description:
      "Resolve one paused intercept by forwarding it, dropping it, or modifying the request/response payload.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        id: { type: "string", description: "The paused intercept ID" },
        action: {
          type: "string",
          enum: ["forward", "drop", "modify"],
          description: "How to continue the intercept",
        },
        modifiedMethod: { type: "string" },
        modifiedUrl: { type: "string" },
        modifiedHeaders: { type: "object" },
        modifiedBody: { type: "string" },
        modifiedStatusCode: { type: "number" },
        modifiedResponseHeaders: { type: "object" },
        modifiedResponseBody: { type: "string" },
      },
      required: ["id", "action"],
    },
  },

  // ─── NEW TOOLS ────────────────────────────────────────────────────────────

  {
    name: "browser_wait_for",
    description:
      "Wait for a condition before continuing. CRITICAL for React/Vue SPAs — use after browser_click or browser_navigate so you get the settled DOM, not a stale one. Options: 'selector' waits until a CSS selector appears; 'dom_stable' waits until mutations stop; 'network_idle' waits until document.readyState is complete.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        wait_type: {
          type: "string",
          enum: ["selector", "dom_stable", "network_idle"],
          description: "What to wait for",
        },
        selector: {
          type: "string",
          description:
            "CSS selector to wait for (required when wait_type=selector)",
        },
        timeout_ms: {
          type: "number",
          description: "Max wait in ms (default 10000)",
        },
      },
      required: ["wait_type"],
    },
  },

  {
    name: "browser_handle_dialog",
    description:
      "Accept or dismiss a browser JavaScript dialog (alert, confirm, prompt). REQUIRED after injecting XSS payloads like <script>alert(1)</script> that trigger real dialogs — otherwise the browser page freezes.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        action: {
          type: "string",
          enum: ["accept", "dismiss"],
          description: "accept or dismiss the dialog",
        },
        prompt_text: {
          type: "string",
          description: "Optional text to enter for prompt() dialogs",
        },
      },
      required: ["action"],
    },
  },

  {
    name: "browser_get_console_logs",
    description:
      "Get browser console messages — exactly what Chrome DevTools shows. Uses the CDP Log domain (captures CSP violations, runtime.lastError, extension errors, network errors) PLUS a JS-side hook (captures console.log/warn/error/info/debug with full parameters). " +
      "Returns compact one-line-per-entry format to minimise context usage. " +
      "CONTEXT-SAFE DEFAULTS: limit defaults to 50, messages are capped at 300 chars each. " +
      "Call with early_install:true right after navigation to install a persistent hook that survives page reloads. " +
      "Filter by level (error/warn/log) or by source (security=CSP violations, javascript=uncaught errors, console-api=console.* calls, network=network errors). " +
      "Pass clear:true to flush the buffer after reading.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        level_filter: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "verbose",
              "info",
              "warning",
              "error",
              "log",
              "warn",
              "debug",
            ],
          },
          description:
            "Only return messages of these severity levels (omit for all)",
        },
        source_filter: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "console-api",
              "javascript",
              "network",
              "security",
              "storage",
              "rendering",
              "deprecation",
              "worker",
              "other",
              "promise",
            ],
          },
          description:
            "Only return messages from these CDP sources. 'security' = CSP violations, 'javascript' = uncaught errors/runtime.lastError, 'console-api' = console.log/warn/error calls, 'promise' = unhandled rejections.",
        },
        early_install: {
          type: "boolean",
          description:
            "Install the hook as a Page.addScriptToEvaluateOnNewDocument persistent script so it captures messages from the very first line of JS on every future navigation/reload. Use this immediately after attaching to a tab.",
        },
        clear: {
          type: "boolean",
          description: "Clear the log buffer after reading (default false)",
        },
        limit: {
          type: "number",
          description:
            "Max messages to return (default 50). Raise only when you need deeper history.",
        },
      },
    },
  },

  {
    name: "browser_hover",
    description:
      "Hover over an element to trigger hover states, reveal hidden admin menus, expand dropdowns, or fire mouseover-only API requests. Use numeric ID from browser_extract_dom (markdown format) or a CSS selector.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        id: {
          type: "number",
          description: "Numeric ID from browser_extract_dom markdown",
        },
        selector: { type: "string", description: "CSS selector fallback" },
      },
    },
  },

  {
    name: "browser_press_key",
    description:
      "Press a keyboard key on the currently focused element. Use 'Enter' to submit forms, 'Tab' to advance focus, 'Escape' to close modals, arrow keys to navigate.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        key: {
          type: "string",
          enum: [
            "Enter",
            "Tab",
            "Escape",
            "Backspace",
            "Delete",
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "Space",
            "Home",
            "End",
            "PageUp",
            "PageDown",
            "F1",
            "F5",
            "F12",
          ],
          description: "Key to press",
        },
      },
      required: ["key"],
    },
  },

  {
    name: "browser_drag",
    description:
      "Drag an element from one location to another using mouse events. Use for drag-and-drop file upload zones, reordering lists, or testing drop targets for path traversal.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        from_id: {
          type: "number",
          description: "Source element numeric ID from browser_extract_dom",
        },
        from_selector: {
          type: "string",
          description: "Source CSS selector fallback",
        },
        to_id: { type: "number", description: "Target element numeric ID" },
        to_selector: {
          type: "string",
          description: "Target CSS selector fallback",
        },
      },
    },
  },

  {
    name: "browser_emulate_device",
    description:
      "Emulate a mobile device or custom viewport. Developers often forget to apply the same authorization checks on mobile API paths. Use to hunt for Mobile-only IDORs and WAF bypasses via trusted mobile User-Agents. Use preset='reset' to restore desktop.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        preset: {
          type: "string",
          enum: [
            "iPhone 15",
            "iPhone SE",
            "Pixel 8",
            "Samsung Galaxy S24",
            "iPad Pro",
            "reset",
          ],
          description:
            "Built-in device preset. Use 'reset' to restore to default desktop.",
        },
        custom_ua: {
          type: "string",
          description:
            "Override User-Agent string (optional, overrides preset UA)",
        },
        custom_width: {
          type: "number",
          description: "Custom viewport width in px",
        },
        custom_height: {
          type: "number",
          description: "Custom viewport height in px",
        },
        mobile: {
          type: "boolean",
          description: "Enable mobile emulation flag",
        },
      },
    },
  },

  {
    name: "browser_memory_scan",
    description:
      "Scan all JavaScript-accessible state for secrets: JWTs, bearer tokens, API keys, AWS access keys, private keys, and passwords. Searches localStorage, sessionStorage, cookies, window globals, and inline <script> tags.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
      },
    },
  },

  {
    name: "browser_websocket_hook",
    description:
      "Inject a WebSocket interceptor into the page. Captures ALL future WebSocket connections and logs their frames. Run this BEFORE the page creates WebSocket connections (e.g. right after navigation). Required before using browser_websocket_send.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
      },
    },
  },

  {
    name: "browser_websocket_list",
    description:
      "List all WebSocket connections captured by browser_websocket_hook, including their IDs, URLs, and readyState. Optionally include the message log.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        include_log: {
          type: "boolean",
          description: "Also return the frame history (default false)",
        },
        limit: {
          type: "number",
          description: "Max log entries if include_log=true (default 50)",
        },
      },
    },
  },

  {
    name: "browser_websocket_send",
    description:
      "Inject a custom message frame into an active WebSocket connection. Use for CSWSH (Cross-Site WebSocket Hijacking), race condition attacks, or unauthorized action testing via open WebSocket connections.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        id: {
          type: "number",
          description: "WebSocket connection ID from browser_websocket_list",
        },
        message: {
          type: "string",
          description: "The message payload to inject (string or JSON)",
        },
      },
      required: ["id", "message"],
    },
  },

  {
    name: "browser_dom_diff",
    description:
      "Show ONLY what changed in the DOM since your last call. Token-efficient alternative to calling browser_extract_dom repeatedly. Returns added/removed lines. Use after clicks, hovers, or API calls to instantly spot newly revealed elements.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        format: {
          type: "string",
          enum: ["markdown", "html"],
          description: "DOM representation format (default markdown)",
        },
        reset: {
          type: "boolean",
          description:
            "Set baseline to current DOM without returning diff (use to start fresh)",
        },
      },
    },
  },

  {
    name: "browser_fuzz",
    description:
      "Offloaded local fuzzing engine. Fires many requests rapidly without using LLM turns. Finds IDORs (numbers), SQLi, XSS, path traversal, etc. Returns ONLY anomalous responses (different status code or significantly different body size from baseline).",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        url: {
          type: "string",
          description:
            "Target URL. Use {{FUZZ}} as placeholder in the URL for URL fuzzing.",
        },
        method: {
          type: "string",
          description: "HTTP method (GET, POST, PUT, etc.)",
        },
        headers: {
          type: "object",
          description: "HTTP headers (include Cookie, Authorization, etc.)",
        },
        body_template: {
          type: "string",
          description:
            "Request body with {{FUZZ}} placeholder. For JSON: '{\"id\":{{FUZZ}}}'",
        },
        param_name: {
          type: "string",
          description:
            "Query parameter name to fuzz (alternative to body_template for GET requests)",
        },
        payload_type: {
          type: "string",
          enum: [
            "numbers",
            "sqli_basic",
            "xss_basic",
            "path_traversal",
            "nosqli_basic",
            "template_injection",
            "custom",
          ],
          description: "Built-in payload list type",
        },
        num_start: {
          type: "number",
          description:
            "Start of numeric range (payload_type=numbers, default 1)",
        },
        num_end: {
          type: "number",
          description:
            "End of numeric range (payload_type=numbers, default 100)",
        },
        custom_payloads: {
          type: "array",
          items: { type: "string" },
          description: "Custom payload list (payload_type=custom)",
        },
        concurrency: {
          type: "number",
          description: "Parallel requests (default 5, max 20)",
        },
        timeout_ms: {
          type: "number",
          description: "Per-request timeout in ms (default 8000)",
        },
      },
      required: ["url", "method", "payload_type"],
    },
  },

  {
    name: "browser_pause_for_human",
    description:
      "Pause the AI and show a full-page overlay in the browser requesting human intervention. Use when blocked by CAPTCHA, Cloudflare Turnstile, 2FA, or WebAuthn (YubiKey). The human completes the challenge and clicks Resume. AI then continues automatically.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description:
            "Target tab ID (optional, defaults to first attached tab)",
        },
        message: {
          type: "string",
          description:
            "Message to display to the human (default: 'Please complete the verification and click Resume AI')",
        },
        timeout_seconds: {
          type: "number",
          description:
            "Max seconds to wait for human (default 300 = 5 minutes)",
        },
      },
    },
  },
];
