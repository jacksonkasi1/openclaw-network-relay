import express from "express";
import cors from "cors";
import { startTunnel } from "untun";
import path from "path";
import { fileURLToPath } from "url";
import { createGptRouter } from "./gpt.js";
import {
  createPendingIntercept,
  dropPendingIntercept,
  markTimedOut,
} from "./state.js";
import {
  getActiveRules,
  getAllRules,
  addTrafficLog,
  getTrafficLogs,
  updateRuleState,
  updateRule,
  removeRule,
  clearAllTrafficLogs,
  clearAllRules,
} from "./db.js";
import {
  handleCdpResult,
  addExtensionStream,
  clearExtensionStream,
} from "./cdp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicPath = path.resolve(__dirname, "../public");

const DEFAULT_TIMEOUT_MS = 20000;

global.sseEnabled = false;

function fallbackDecisionForPhase(phase) {
  return { action: "forward" };
}

export function createHttpApp() {
  const app = express();

  app.use(cors()); // Allow tunnel domains
  app.use(express.json({ limit: "50mb" }));
  app.use(express.static(publicPath)); // Serve the web dashboard

  // ── GPT Bridge ─────────────────────────────────────────────────────────────
  // REST endpoints that let a ChatGPT Custom GPT call MCP tools via Actions.
  // Schema is served at /api/gpt/openapi.json (public, no auth).
  // Tool calls require Bearer token matching GPT_API_KEY env var.
  app.use("/api/gpt", createGptRouter());
  if (process.env.GPT_API_KEY) {
    console.error(
      "[GPT] Custom GPT bridge enabled. Schema: /api/gpt/openapi.json",
    );
  } else {
    console.error(
      "[GPT] Custom GPT bridge inactive (set GPT_API_KEY in .env to enable).",
    );
  }

  // SSE Remote AI Settings
  app.get("/api/settings", (_req, res) => {
    res.json({ sseEnabled: global.sseEnabled, publicUrl: global.publicUrl });
  });

  app.post("/api/settings/sse", async (req, res) => {
    global.sseEnabled = !!req.body.enabled;

    if (global.sseEnabled && !global.publicUrl) {
      try {
        console.error("[HTTP] Starting Cloudflare tunnel...");
        global.tunnel = await startTunnel({ port: 31337 });
        if (global.tunnel) {
          global.publicUrl = await global.tunnel.getURL();
          console.error(`[HTTP] Tunnel active: ${global.publicUrl}`);
        }
      } catch (e) {
        console.error("[HTTP] Tunnel failed:", e.message);
      }
    } else if (!global.sseEnabled && global.tunnel) {
      try {
        await global.tunnel.close();
        global.tunnel = null;
        global.publicUrl = null;
        console.error("[HTTP] Tunnel closed.");
      } catch (e) {}
    }

    res.json({
      ok: true,
      sseEnabled: global.sseEnabled,
      publicUrl: global.publicUrl,
    });
  });

  // Health and Rule sync endpoints for the Chrome Extension
  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Graceful self-termination — called by a newly-starting server instance when
  // it detects that an older zombie is already holding the port.
  app.post("/api/shutdown", (_req, res) => {
    res.json({ ok: true, message: "Shutting down" });
    setTimeout(() => process.exit(0), 150);
  });
  app.get("/rules", (_req, res) => res.json(getActiveRules()));

  // Internal API for the Web Dashboard
  app.get("/api/rules", (_req, res) => res.json(getAllRules()));
  app.get("/api/logs", (_req, res) => res.json(getTrafficLogs()));
  app.put("/api/rules/:id", (req, res) => {
    updateRule(req.params.id, req.body);
    res.json({ ok: true });
  });
  app.post("/api/rules/:id/toggle", (req, res) => {
    updateRuleState(req.params.id, req.body.isActive);
    res.json({ ok: true });
  });
  app.delete("/api/rules/:id", (req, res) => {
    removeRule(req.params.id);
    res.json({ ok: true });
  });
  app.delete("/api/rules", (_req, res) => {
    clearAllRules();
    res.json({ ok: true });
  });
  app.delete("/api/logs", (_req, res) => {
    clearAllTrafficLogs();
    res.json({ ok: true });
  });

  // The main endpoint the extension hits for traffic
  app.post("/log", (req, res) => {
    const interceptData = req.body;
    const interceptId = interceptData?.id;

    if (!interceptId) {
      res.status(400).json({ error: "Missing intercept ID" });
      return;
    }

    addTrafficLog(interceptData); // Store persistently in SQLite

    // If extension is purely listening or already applied a rule locally, just return forward immediately
    if (interceptData.mode === "listen" || interceptData.appliedRule) {
      res.json({ action: "forward" });
      return;
    }

    const intercept = createPendingIntercept(interceptData);
    const fallbackDecision = fallbackDecisionForPhase(interceptData.phase);

    intercept.timeoutId = setTimeout(() => {
      markTimedOut(interceptId, fallbackDecision);
    }, DEFAULT_TIMEOUT_MS);

    req.on("close", () => {
      if (!res.writableEnded) {
        dropPendingIntercept(interceptId);
      }
    });

    intercept.promise
      .then((decision) => {
        if (!res.writableEnded) res.json(decision);
      })
      .catch(() => {
        if (!res.writableEnded) res.json(fallbackDecision);
      });
  });

  // --- Extension CDP Command Stream ---
  app.get("/api/extension/commands", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    if (req.socket && req.socket.setKeepAlive)
      req.socket.setKeepAlive(true, 15000);
    if (req.socket && req.socket.setNoDelay) req.socket.setNoDelay(true);

    // Some environments need an explicit empty write to clear the headers fully
    res.write(":\n\n");
    res.write("retry: 1000\n");
    res.write('event: ready\ndata: {"ok":true}\n\n');
    if (typeof res.flush === "function") res.flush();

    addExtensionStream(res);

    const pingInterval = setInterval(() => {
      try {
        const ok = res.write(`event: ping\ndata: {"ts":${Date.now()}}\n\n`);
        if (typeof res.flush === "function") res.flush();
        // If write() returns false the socket is congested or dead — tear down now
        // so extensionStream is nulled and sendCdpCommand retries immediately.
        if (ok === false) {
          cleanup();
          clearInterval(pingInterval);
        }
      } catch (e) {
        cleanup();
        clearInterval(pingInterval);
      }
    }, 8000);

    const cleanup = () => {
      clearInterval(pingInterval);
      clearExtensionStream(res);
    };

    req.on("close", cleanup);
    req.on("aborted", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
  });

  app.post("/api/extension/cdp-result", (req, res) => {
    handleCdpResult(req.body);
    res.json({ ok: true });
  });

  return app;
}
