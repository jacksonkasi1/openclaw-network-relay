# OpenClaw MCP Bridge

This server is the bridge between the Chrome extension and the remote model.

## What it does

- Accepts paused browser intercept events over HTTP at `POST /log`
- Holds the browser request or response until the model resolves it
- Exposes MCP tools over STDIO so an LLM client can inspect and resolve pending intercepts
- Captures WebSockets traffic in real-time
- Connects directly to the Chrome DevTools Protocol (CDP) for full AI-driven browser automation
- Enables automated file uploads and downloads, native cookie manipulation, and SQLite database interaction

## Run

```bash
bun install
bun src/index.js
```

The bridge listens on port `31337` by default. Override with `PORT=4000 bun src/index.js`.

## MCP tools

- `get_pending_requests`: list paused intercepts
- `get_traffic_history`: retrieve logged traffic history, including REST and WebSocket data
- `resolve_request`: forward, drop, or modify a paused intercept
- `replay_request`: replay an intercepted request with modified parameters
- `add_rule`, `remove_rule`, `list_rules`: manage rules for zero-latency in-browser interception
- `browser_extract_dom`, `browser_click`, `browser_type`, `browser_navigate`: full AI browser control tools
- `browser_screenshot`: Capture visual state of the attached tab with interactive bounding box annotations
- `browser_upload_file`, `browser_download_file`: Trigger file downloads and natively upload files bypassing JS
- `browser_get_cookies`, `browser_set_cookies`: Direct native manipulation of browser sessions and JWTs
- `db_sql_query`: Run advanced SQLite queries against stored traffic logs

## Notes

- The Chrome extension uses the Chrome debugger, so interception applies to one attached tab at a time.
- If the model does not resolve an intercept in time, the bridge forwards it automatically.
- Upon attaching, OpenClaw automatically enables Stealth Mode to evade common anti-bot mechanisms.
