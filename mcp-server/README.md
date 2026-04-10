# OpenClaw MCP Bridge

This server is the bridge between the Chrome extension and the remote model.

## What it does

- Accepts paused browser intercept events over HTTP at `POST /log`
- Holds the browser request or response until the model resolves it
- Exposes MCP tools over STDIO so an LLM client can inspect and resolve pending intercepts

## Run

```bash
npm install
npm start
```

The bridge listens on port `31337` by default. Override with `PORT=4000 npm start`.

## MCP tools

- `get_pending_requests`: list paused intercepts
- `resolve_request`: forward, drop, or modify a paused intercept

## Notes

- The Chrome extension uses the Chrome debugger, so interception applies to one attached tab at a time.
- If the model does not resolve an intercept in time, the bridge forwards it automatically.
