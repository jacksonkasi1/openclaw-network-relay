# OpenClaw Interceptor

OpenClaw Interceptor turns a Chrome tab into a Burp-style interception target controlled by a local or remote model through an MCP bridge.

This project uses the Chrome Debugger `Fetch` domain instead of monkey-patching page JavaScript. That gives the model control over paused browser requests and responses for one attached tab at a time.

## What it does

- Pause outgoing browser requests before they are sent
- Let a model inspect and decide whether to `forward`, `drop`, or `modify`
- Pause incoming responses before the page receives them
- Let a model inspect and optionally rewrite status code, headers, and body
- Bridge Chrome traffic to an MCP-compatible model workflow

## Project layout

```text
.
├── background.js          # Chrome debugger interception engine
├── manifest.json         # Chrome extension manifest (MV3)
├── popup.html            # Extension UI
├── popup.js              # Extension UI logic
├── mcp-server/
│   ├── README.md         # MCP bridge specific notes
│   ├── package.json      # Node.js bridge package config
│   └── src/
│       ├── http.js       # HTTP webhook bridge for the extension
│       ├── index.js      # Starts HTTP + MCP servers
│       ├── mcp.js        # MCP tools exposed to the model
│       └── state.js      # Pending intercept state management
└── README.md             # Full setup and operating guide
```

## Architecture

```text
Chrome Tab
  -> Chrome Debugger Fetch.requestPaused
  -> extension background service worker
  -> POST /log to MCP bridge
  -> pending intercept stored in bridge
  -> model uses MCP tool get_pending_requests
  -> model uses MCP tool resolve_request
  -> bridge returns decision to extension
  -> extension continues, drops, or rewrites request/response
```

## Requirements

- macOS or Linux for the browser machine
- Chrome or Chromium with developer mode enabled
- Node.js 18+
- A model client that supports MCP over STDIO on the VM or local machine
- Optional tunnel or private network if the browser is on Mac and the MCP bridge/model are on a VM

## Security model

This version is much stronger than the earlier page-injection approach because it intercepts traffic through Chrome Debugger instead of trusting `window.postMessage`.

Important limits still apply:

- It is a developer interception tool, not a hardened enterprise proxy
- It attaches to one tab at a time
- Chrome debugger interception is visible to the browser and may show debugger-related UI behavior
- The MCP bridge auto-forwards if the model does not answer before timeout
- The extension can see sensitive request/response data for the attached tab

## Local setup

### 1. Install MCP bridge dependencies

```bash
cd /Users/mahy/mcp/tmp/mcp-server
npm install
npm run check
```

### 2. Start the MCP bridge

```bash
cd /Users/mahy/mcp/tmp/mcp-server
npm start
```

Default HTTP bridge URL:

```text
http://127.0.0.1:31337/log
```

Health check:

```text
http://127.0.0.1:31337/health
```

### 3. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `/Users/mahy/mcp/tmp`

### 4. Attach interception to a tab

1. Open the website you want to control
2. Click the extension icon
3. Save the MCP bridge URL if needed
4. Click `ON`
5. The extension will attach to the current tab only

## Remote VM setup

Use this when the browser runs on your Mac and the model runs on a VM.

### Option A: tunnel the VM bridge publicly

Run the MCP bridge on the VM:

```bash
cd /path/to/openclaw/mcp-server
npm install
npm start
```

Expose it with a tunnel such as:

- `ngrok`
- `cloudflared`
- `localhost.run`

Example public URL used in the extension popup:

```text
https://your-public-domain.example.com/log
```

### Option B: private network

Use Tailscale or another private network and point the extension to something like:

```text
http://100.x.y.z:31337/log
```

For safety, the extension only accepts:

- `https://...`
- `http://localhost/...`
- `http://127.0.0.1/...`

If you use a private IP over HTTP, update the validation logic in `background.js`.

## MCP client configuration

Configure your model client on the machine that runs the model.

Generic MCP STDIO config:

```json
{
  "mcpServers": {
    "openclaw-interceptor": {
      "command": "node",
      "args": ["/absolute/path/to/openclaw/mcp-server/src/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/openclaw` with the real path on your VM or local machine.

## MCP tools exposed to the model

### `get_pending_requests`

Returns all currently paused intercepts. Each item can be either:

- `phase: "request"`
- `phase: "response"`

Typical fields include:

- `id`
- `tabId`
- `url`
- `method`
- `resourceType`
- `requestHeaders`
- `requestBody`
- `responseStatusCode`
- `responseHeaders`
- `responseBody`

### `resolve_request`

Required fields:

- `id`
- `action`: `forward`, `drop`, or `modify`

Optional request-phase modification fields:

- `modifiedMethod`
- `modifiedUrl`
- `modifiedHeaders`
- `modifiedBody`

Optional response-phase modification fields:

- `modifiedStatusCode`
- `modifiedResponseHeaders`
- `modifiedResponseBody`

## Recommended operating prompt for the model

Use this as the model instruction or initial prompt.

```text
You are OpenClaw, a browser interception agent controlling live Chrome traffic through MCP.

You have access to these tools:
- get_pending_requests
- resolve_request

Your job is to act like a focused Burp-style interceptor for one browser tab.

Rules:
1. Poll get_pending_requests frequently.
2. For each pending intercept, inspect phase, URL, method, headers, and body.
3. If phase is request, decide whether to:
   - forward it unchanged
   - drop it
   - modify method, URL, headers, or body
4. If phase is response, decide whether to:
   - forward it unchanged
   - drop it
   - modify status code, headers, or body
5. Act quickly. If you do not resolve the intercept fast enough, it will auto-forward.
6. Before modifying traffic, briefly explain what you are changing and why.
7. Prefer minimal changes that preserve browser stability.
8. Never invent missing fields; only modify fields that exist or are explicitly required for the goal.

Begin by calling get_pending_requests.
```

## Example model workflows

### Forward everything except tracking

- Inspect request URL
- Drop known analytics or ad endpoints
- Forward normal app traffic

### Rewrite a JSON request body

- Wait for a request-phase intercept
- Detect a target endpoint like `/api/checkout`
- Change `quantity`, `price`, `role`, or another field
- Resolve with `action: modify`

### Rewrite an API response

- Wait for a response-phase intercept
- Detect `/api/me` or `/api/plan`
- Replace response body fields like `isAdmin: true` or `plan: "enterprise"`
- Resolve with `action: modify`

## Example decision payloads

Forward:

```json
{
  "id": "123",
  "action": "forward"
}
```

Drop:

```json
{
  "id": "123",
  "action": "drop"
}
```

Modify request:

```json
{
  "id": "123",
  "action": "modify",
  "modifiedMethod": "POST",
  "modifiedHeaders": {
    "content-type": "application/json",
    "x-openclaw": "1"
  },
  "modifiedBody": "{\"role\":\"admin\"}"
}
```

Modify response:

```json
{
  "id": "123",
  "action": "modify",
  "modifiedStatusCode": 200,
  "modifiedResponseHeaders": {
    "content-type": "application/json"
  },
  "modifiedResponseBody": "{\"plan\":\"enterprise\",\"isAdmin\":true}"
}
```

## Operating notes

- Interception applies only to the tab currently attached in the popup
- If you change tabs, attach again if needed
- Request/response bodies may be large; model behavior should remain targeted
- Binary responses may be harder to reason about than JSON or text
- If the model is remote and slow, expect more auto-forward behavior

## Troubleshooting

### Extension toggles on but nothing pauses

- Make sure the popup is attached to the current tab
- Confirm the bridge is running
- Confirm the saved endpoint is reachable from the browser machine
- Check Chrome extension errors in `chrome://extensions`

### Bridge receives nothing

- Verify the popup endpoint matches the running server
- Test `/health`
- If using a VM, verify tunnel or private network routing

### Model sees no MCP tools

- Check the MCP client config path
- Start the client after editing the config
- Confirm `node` exists on the model machine

### Requests auto-forward too often

- Your model is too slow for the current timeout
- Reduce model reasoning time
- Run the model closer to the bridge
- Increase timeout in `background.js` and `mcp-server/src/http.js` if you accept slower browsing

### Remote HTTP endpoint rejected in popup

- The extension currently enforces HTTPS for non-local endpoints
- Use a proper HTTPS tunnel or adjust validation in `background.js`

## Development notes

Syntax validation:

```bash
cd /Users/mahy/mcp/tmp/mcp-server
npm run check
node --check /Users/mahy/mcp/tmp/background.js
node --check /Users/mahy/mcp/tmp/popup.js
```

## Current status

As of 2026-04-10T11:37:29+05:30, this repository is organized around a debugger-based interception model and is much closer to Burp-style browser control than the earlier injected-script approach.

## Next recommended steps

1. Add domain allowlists and auth-header redaction rules
2. Add structured logging of intercept decisions in the bridge
3. Add response body size limits and binary handling policy
4. Add automated end-to-end tests with a demo target app
