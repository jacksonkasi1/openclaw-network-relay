# OpenClaw × ChatGPT Custom GPT — Setup Guide

Connect your local OpenClaw MCP server to a ChatGPT Custom GPT so that the
GPT can control your local Chrome browser, intercept network traffic, run
security tests, and more — all from chat.openai.com.

---

## How It Works

```
You (chat.openai.com)
        │
        ▼
 ChatGPT Custom GPT
  (system prompt + Actions)
        │  HTTPS calls to your public URL
        ▼
 Cloudflare Tunnel  ◄── ngrok also works
        │
        ▼
 Express server on your Mac  :31337
  └── /api/gpt/openapi.json  (schema — public)
  └── /api/gpt/tools         (list tools — auth)
  └── /api/gpt/tool          (call tool — auth)
        │  InMemoryTransport (in-process, zero latency)
        ▼
 MCP Server (all tools available)
        │
        ▼
 Chrome Extension (OpenClaw)
        │
        ▼
 Your local browser / system
```

---

## Prerequisites

- OpenClaw MCP server running locally (`bun run start` inside `mcp-server/`)
- OpenClaw Chrome extension installed and connected
- A ChatGPT account with Custom GPT access (ChatGPT Plus / Team / Enterprise)
- `openssl` available in your terminal (comes with macOS)

---

## Step 1 — Generate a Secret API Key

The Custom GPT authenticates to your local server with a Bearer token.  
Generate a strong random key:

```bash
openssl rand -hex 32
```

Copy the output — you will need it in Steps 2 and 5.

---

## Step 2 — Configure the Server

Inside `mcp-server/`, copy the example env file and fill it in:

```bash
cp .env.example .env
```

Open `.env` and set your key:

```
GPT_API_KEY=<paste-the-key-from-step-1>
```

**Optional — auto-start tunnel on boot:**  
If you want the Cloudflare tunnel to start automatically every time the server
starts (instead of toggling it from the dashboard), also add:

```
GPT_AUTO_TUNNEL=true
```

---

## Step 3 — Start the Server and Open the Tunnel

### Option A — Use the dashboard (recommended for testing)

1. Start the server:
   ```bash
   cd mcp-server
   bun run start
   ```
2. Open the dashboard: [http://localhost:31337](http://localhost:31337)
3. Toggle **"Remote AI (SSE)"** → this starts a Cloudflare tunnel and shows
   you the public URL, e.g.:
   ```
   https://abc123.trycloudflare.com
   ```

### Option B — Auto-tunnel (recommended for production / always-on)

With `GPT_AUTO_TUNNEL=true` in `.env`, just start the server:

```bash
cd mcp-server
bun run start
```

The tunnel URL is printed to the console on startup:

```
[GPT] Tunnel active: https://abc123.trycloudflare.com
[GPT] Schema URL:    https://abc123.trycloudflare.com/api/gpt/openapi.json
```

### Option C — Use ngrok instead of Cloudflare

If you prefer ngrok:

```bash
ngrok http 31337
```

Copy the `Forwarding` HTTPS URL (e.g. `https://abc123.ngrok-free.app`).  
You do **not** need to set `GPT_AUTO_TUNNEL` when using ngrok.

> **Note:** The tunnel URL changes every time you restart.  When it changes,
> update the server URL in your Custom GPT Actions (Step 5 → "Edit" → update
> the server URL).  With a paid ngrok plan you can reserve a static domain.

---

## Step 4 — Verify the Bridge is Working

Confirm the public OpenAPI schema is reachable (no auth needed):

```bash
curl https://<your-tunnel-url>/api/gpt/openapi.json
```

Confirm authenticated tool listing works:

```bash
curl -H "Authorization: Bearer <your-GPT_API_KEY>" \
     https://<your-tunnel-url>/api/gpt/tools
```

You should see a JSON array of all MCP tools.

---

## Step 5 — Create the Custom GPT

1. Go to [https://chat.openai.com/gpts/editor](https://chat.openai.com/gpts/editor)
2. Click **"Create a GPT"**

### Name & Description

| Field | Value |
|-------|-------|
| Name | `OpenClaw` (or anything you like) |
| Description | Controls my local Chrome browser via the OpenClaw MCP server. Can navigate pages, intercept traffic, run JS, take screenshots, and perform security testing. |

### Instructions (paste this into the Instructions box)

```
You are OpenClaw, an expert browser-automation and web-security assistant.
You have direct access to the user's local Chrome browser through the
OpenClaw MCP server running on their machine.

## Capabilities
You can call any of the available MCP tools via the callMcpTool action.
Use listMcpTools whenever you are unsure what tools are available or need
to check argument names.

## Key tools (not exhaustive — always call listMcpTools to see the full list)
- browser_navigate          — navigate to a URL
- browser_get_dom_snapshot  — get the current page DOM / accessibility tree
- browser_screenshot        — take a screenshot (returns base64 image)
- browser_click_element     — click an element by CSS selector or ID
- browser_type_text         — type text into an input
- browser_execute_js        — run arbitrary JavaScript in the page
- browser_get_console_logs  — read browser console output
- traffic_get_history       — get captured network requests/responses
- traffic_send_request      — send an HTTP request directly
- add_intercept_rule        — intercept and modify future requests/responses
- resolve_intercept         — approve or modify a pending intercepted request

## Workflow guidelines
1. Before automating anything, call browser_get_dom_snapshot to understand
   the current page state.
2. Prefer specific CSS selectors or element IDs over broad queries.
3. After navigation or clicks, wait briefly then call browser_get_dom_snapshot
   to confirm the action succeeded.
4. For security testing, always confirm the user owns or has permission to
   test the target before proceeding.
5. When returning screenshots, display the image inline so the user can see it.

## Tone
Be concise and action-oriented. Report what you did and what you found.
Ask for clarification only when truly needed.
```

### Actions — Import Schema

1. In the GPT editor, click **"Add actions"**
2. Click **"Import from URL"**
3. Paste:
   ```
   https://<your-tunnel-url>/api/gpt/openapi.json
   ```
4. Click **"Import"** — you should see two actions appear:
   - `listMcpTools`
   - `callMcpTool`

### Actions — Authentication

1. Click **"Authentication"** (in the Actions panel)
2. Select **"API Key"**
3. Set **Auth Type** to **"Bearer"**
4. Paste your `GPT_API_KEY` value into the **"API Key"** field
5. Click **"Save"**

### Privacy Policy (required by OpenAI)

Since your Custom GPT calls an external server, OpenAI requires a privacy
policy URL.  You can use a simple placeholder:

```
https://github.com/your-username/your-repo/blob/main/PRIVACY.md
```

Or just enter your own site URL.

---

## Step 6 — Test It

Click **"Save"** on the GPT editor, then switch to **"Preview"** and try:

> **"Navigate to https://example.com and take a screenshot."**

The GPT should:
1. Call `callMcpTool` with `browser_navigate`
2. Call `callMcpTool` with `browser_screenshot`
3. Display the screenshot image inline

---

## Troubleshooting

### "GPT API bridge is not configured" (503)
→ `GPT_API_KEY` is not set in `.env`. Set it and restart the server.

### "Unauthorized" (401)
→ The Bearer token in the Custom GPT Actions does not match `GPT_API_KEY`.
  Re-check the key in the GPT editor → Actions → Authentication.

### Schema import fails / connection refused
→ The tunnel is not running or the URL has changed. Re-enable SSE in the
  dashboard (or restart with `GPT_AUTO_TUNNEL=true`) and update the schema
  URL in the GPT Actions.

### Tool call returns "isError: true"
→ The MCP tool itself returned an error (e.g. Chrome is not open, or the
  extension is not connected).  Open the OpenClaw dashboard at
  [http://localhost:31337](http://localhost:31337) and check that the
  extension shows as connected.

### Image / screenshot not displayed
→ Make sure your GPT instructions mention "display the image inline".  Some
  GPT configurations need explicit instruction to render base64 images.

---

## Security Considerations

- The `GPT_API_KEY` gives full access to your local machine via the MCP
  tools.  **Never share it or commit it to version control.**
- `.env` is already listed in `.gitignore` — keep it that way.
- The Cloudflare tunnel URL is publicly routable; the Bearer token is the
  only thing protecting it.  Use a long random key (32+ hex chars).
- Consider stopping the tunnel when you are not actively using the GPT.
- The Custom GPT's system prompt is visible to GPT editors but **not** to
  end users chatting with a published GPT — so credentials in the prompt
  would be visible to you but not users.  Still, keep secrets in env vars.

---

## Updating the Schema URL After a Tunnel Restart

Each time the Cloudflare tunnel (or free ngrok) restarts, you get a new URL.

1. Copy the new URL from the console / dashboard.
2. Open [https://chat.openai.com/gpts/editor](https://chat.openai.com/gpts/editor) → your GPT → Edit.
3. Go to **Actions** → click the existing action → **Edit**.
4. Update the server URL in the schema (or re-import from the new URL).
5. Click **"Update"** and **"Save"** the GPT.

To avoid this, use **ngrok with a reserved domain** (paid plan) or run your
own reverse proxy with a fixed domain.