#!/usr/bin/env node
import { createHttpApp } from "./http.js";
import { startMcpServer } from "./mcp.js";
import { startCloudflaredTunnel } from "./tunnel.js";

let PORT = parseInt(process.env.PORT || "31337", 10);

const app = createHttpApp();
startMcpServer(app);

/**
 * If GPT_AUTO_TUNNEL=true is set, automatically open a Cloudflare tunnel so
 * the Custom GPT bridge is publicly reachable on every server boot — no need
 * to manually toggle SSE in the dashboard.
 */
async function maybeStartAutoTunnel(port) {
  if (process.env.GPT_AUTO_TUNNEL !== "true") return;
  if (!process.env.GPT_API_KEY) {
    console.error(
      "[GPT] GPT_AUTO_TUNNEL is true but GPT_API_KEY is not set — skipping tunnel.",
    );
    return;
  }

  try {
    console.error("[GPT] GPT_AUTO_TUNNEL=true — starting Cloudflare tunnel...");
    global.sseEnabled = true;
    global.tunnel = await startCloudflaredTunnel(port);
    if (global.tunnel) {
      global.publicUrl = await global.tunnel.getURL();
      console.error(`[GPT] Tunnel active: ${global.publicUrl}`);
      console.error(
        `[GPT] Schema URL:    ${global.publicUrl}/api/gpt/openapi.json`,
      );
    }
  } catch (e) {
    console.error("[GPT] Auto-tunnel failed:", e.message);
  }
}

function startServer(port) {
  const server = app.listen(port, () => {
    // Store the actual port globally so tunnel.js and http.js always
    // target the correct port even when 31337 was already in use.
    global.serverPort = port;
    console.error(
      `[HTTP] OpenClaw Dashboard listening on http://localhost:${port}`,
    );
    maybeStartAutoTunnel(port);
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.error(
        `[HTTP] Port ${port} is in use. Trying port ${port + 1}...`,
      );
      setTimeout(() => {
        startServer(port + 1);
      }, 500);
    } else {
      console.error(e);
      process.exit(1);
    }
  });
}

startServer(PORT);
