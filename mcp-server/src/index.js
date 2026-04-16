#!/usr/bin/env node
import { createHttpApp } from "./http.js";
import { startMcpServer } from "./mcp.js";
import { startCloudflaredTunnel } from "./tunnel.js";

let PORT = parseInt(process.env.PORT || "31337", 10);

/**
 * If CLOUDFLARE_TUNNEL_URL is set in .env, the user has already configured a
 * named Cloudflare tunnel (Mode A) that is running as a separate service.
 * In that case we can immediately enable the SSE endpoint and publish the URL
 * without starting a second tunnel process.
 *
 * This is the primary reason the /sse endpoint returned 403 when ChatGPT tried
 * to probe it — global.sseEnabled defaulted to false even though the tunnel was
 * perfectly reachable.
 */
function maybeActivateNamedTunnel() {
  const tunnelUrl = process.env.CLOUDFLARE_TUNNEL_URL;
  if (!tunnelUrl) return;

  global.sseEnabled = true;
  global.publicUrl = tunnelUrl.replace(/\/$/, ""); // strip trailing slash
  console.error(
    `[MCP] Named Cloudflare tunnel detected — SSE endpoint auto-enabled.`,
  );
  console.error(`[MCP] Public URL : ${global.publicUrl}`);
  console.error(`[MCP] SSE URL    : ${global.publicUrl}/sse`);
}

/**
 * If GPT_AUTO_TUNNEL=true is set, spin up a fresh Cloudflare tunnel so the
 * Custom GPT bridge is publicly reachable on every server boot — no need to
 * manually toggle SSE in the dashboard.
 *
 * Note: This is for Mode B (quick tunnel / no named tunnel).
 * If CLOUDFLARE_TUNNEL_URL is already set, this function is skipped because
 * maybeActivateNamedTunnel() has already handled everything.
 */
async function maybeStartAutoTunnel(port) {
  // Skip if a named tunnel is already configured.
  if (process.env.CLOUDFLARE_TUNNEL_URL) return;

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
      console.error(`[GPT] SSE URL:       ${global.publicUrl}/sse`);
      console.error(
        `[GPT] Schema URL:   ${global.publicUrl}/api/gpt/openapi.json`,
      );
    }
  } catch (e) {
    console.error("[GPT] Auto-tunnel failed:", e.message);
  }
}

// Activate named tunnel BEFORE the HTTP app is created so that the very first
// request to /sse is already allowed (global.sseEnabled === true).
maybeActivateNamedTunnel();

const app = createHttpApp();
startMcpServer(app);

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
