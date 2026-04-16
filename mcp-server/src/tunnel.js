/**
 * tunnel.js — cloudflared tunnel wrapper
 *
 * Replaces the `untun` npm package with a direct spawn of the official
 * `cloudflared` CLI. This fixes two problems:
 *
 *   1. untun Quick Tunnels are unreliable (Cloudflare 1033 errors).
 *   2. The old code hardcoded port 31337; now the actual runtime port is used.
 *
 * Supported modes (checked in order):
 *
 *   A) Named tunnel via token  — set CLOUDFLARE_TUNNEL_TOKEN in .env
 *      Gives a permanent URL tied to your Cloudflare account/domain.
 *      Get the token from: Cloudflare dashboard → Zero Trust → Networks →
 *      Tunnels → Create a tunnel → copy the token.
 *
 *   B) Quick tunnel (no login) — default when no token is set
 *      Spawns `cloudflared tunnel --url http://localhost:<port>`.
 *      URL changes on every restart. Requires cloudflared CLI installed.
 *
 * Install cloudflared:
 *   macOS:   brew install cloudflare/cloudflare/cloudflared
 *   Linux:   https://pkg.cloudflare.com/index.html
 *   Windows: winget install Cloudflare.cloudflared
 *
 * The returned object exposes:
 *   tunnel.getURL()  → Promise<string>   public HTTPS URL
 *   tunnel.close()   → Promise<void>     kill the cloudflared process
 */

import { spawn } from "child_process";

// How long to wait for cloudflared to print the tunnel URL before giving up.
const URL_TIMEOUT_MS = 45_000;

// Quick Tunnel URLs always follow this exact pattern.
// We do NOT use a generic HTTPS pattern because cloudflared's disclaimer
// text also contains cloudflare.com URLs which would be matched too early.
const QUICK_TUNNEL_PATTERN = /https:\/\/[\w-]+\.trycloudflare\.com/;

/**
 * Extract a Quick Tunnel URL from a chunk of cloudflared output.
 * Returns the URL string, or null if no Quick Tunnel URL is present.
 *
 * Named tunnels do NOT print their public URL — the URL is whatever hostname
 * the user configured in the Cloudflare dashboard.  For named tunnels we
 * instead resolve the URL from the CLOUDFLARE_TUNNEL_URL env var (see below).
 */
function extractQuickTunnelUrl(text) {
  const match = text.match(QUICK_TUNNEL_PATTERN);
  return match ? match[0] : null;
}

/**
 * Start a cloudflared tunnel pointing at http://localhost:<port>.
 *
 * @param {number} port  The local port your Express server is listening on.
 * @returns {Promise<{ getURL: () => Promise<string>, close: () => Promise<void> }>}
 */
export async function startCloudflaredTunnel(port) {
  const token = process.env.CLOUDFLARE_TUNNEL_TOKEN;

  // ── Build the cloudflared command ─────────────────────────────────────────
  let args;

  if (token) {
    // Mode A: named tunnel authenticated with a Cloudflare account token.
    // The tunnel name, route, and domain are all configured in the Cloudflare
    // dashboard — cloudflared just needs the token to connect.
    // The public URL must be provided separately via CLOUDFLARE_TUNNEL_URL
    // because cloudflared does not print it when using a pre-created tunnel.
    const namedUrl = process.env.CLOUDFLARE_TUNNEL_URL;
    if (!namedUrl) {
      console.error(
        "[Tunnel] WARNING: CLOUDFLARE_TUNNEL_TOKEN is set but CLOUDFLARE_TUNNEL_URL is not.\n" +
          "         Set CLOUDFLARE_TUNNEL_URL=https://openclaw.yourdomain.com in .env\n" +
          "         so the server knows its own public address.",
      );
    }
    console.error(
      "[Tunnel] Using named Cloudflare tunnel (CLOUDFLARE_TUNNEL_TOKEN)",
    );
    args = ["tunnel", "--no-autoupdate", "run", "--token", token];
  } else {
    // Mode B: anonymous Quick Tunnel — no account needed, URL changes on restart.
    console.error(`[Tunnel] Starting Quick Tunnel → http://localhost:${port}`);
    args = ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`];
  }

  // ── Spawn cloudflared ─────────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    let proc;

    try {
      proc = spawn("cloudflared", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (spawnErr) {
      return reject(
        new Error(
          `Failed to spawn cloudflared: ${spawnErr.message}\n` +
            `Install it with:  brew install cloudflare/cloudflare/cloudflared\n` +
            `Docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`,
        ),
      );
    }

    let resolved = false;
    let publicUrl = null;
    const outputLines = [];

    // For named tunnels, resolve immediately using the env var URL because
    // cloudflared will never print the public hostname itself.
    if (token) {
      const namedUrl = (process.env.CLOUDFLARE_TUNNEL_URL || "").trim();
      if (namedUrl) {
        // Wait briefly to let cloudflared connect before declaring success.
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            publicUrl = namedUrl;
            console.error(`[Tunnel] Named tunnel public URL: ${namedUrl}`);
            resolve(buildHandle(namedUrl, proc));
          }
        }, 5000);
      }
      // If no URL env var, fall through and wait for any output-based signal.
    }

    // ── Capture URL from stdout / stderr ──────────────────────────────────
    function handleOutput(chunk) {
      const text = chunk.toString();

      // Log cloudflared output at debug level for troubleshooting
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          outputLines.push(trimmed);
          // Keep the last 40 lines for error reporting
          if (outputLines.length > 40) outputLines.shift();
          console.error(`[cloudflared] ${trimmed}`);
        }
      }

      if (resolved) return;

      // Quick Tunnel only — named tunnel URL comes from env var above.
      if (!token) {
        const url = extractQuickTunnelUrl(text);
        if (url) {
          publicUrl = url;
          resolved = true;
          console.error(`[Tunnel] Public URL: ${url}`);
          resolve(buildHandle(url, proc));
        }
      }
    }

    proc.stdout.on("data", handleOutput);
    proc.stderr.on("data", handleOutput);

    // ── Handle process exit before URL was found ──────────────────────────
    proc.on("close", (code) => {
      if (!resolved) {
        const tail = outputLines.slice(-10).join("\n");
        reject(
          new Error(
            `cloudflared exited (code ${code}) before providing a URL.\n` +
              `Last output:\n${tail || "(none)"}\n\n` +
              `Troubleshooting:\n` +
              `  • Make sure cloudflared is installed and up to date.\n` +
              `  • Run manually:  cloudflared tunnel --url http://localhost:${port}\n` +
              `  • Check if port ${port} is accessible (not firewalled).`,
          ),
        );
      }
    });

    // ── Handle spawn errors (e.g. binary not in PATH) ─────────────────────
    proc.on("error", (err) => {
      if (!resolved) {
        reject(
          new Error(
            `cloudflared not found or could not be executed: ${err.message}\n` +
              `Install with:  brew install cloudflare/cloudflare/cloudflared\n` +
              `Then restart the MCP server.`,
          ),
        );
      }
    });

    // ── Timeout guard ─────────────────────────────────────────────────────
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true; // prevent double-reject
        proc.kill("SIGTERM");
        const tail = outputLines.slice(-10).join("\n");
        reject(
          new Error(
            `cloudflared did not provide a URL within ${URL_TIMEOUT_MS / 1000}s.\n` +
              `Last output:\n${tail || "(none)"}\n\n` +
              `Try running manually to diagnose:\n` +
              `  cloudflared tunnel --url http://localhost:${port}`,
          ),
        );
      }
    }, URL_TIMEOUT_MS);

    // Don't let the timer keep the Node process alive
    if (timer.unref) timer.unref();
  });
}

/**
 * Build the tunnel handle object returned to callers.
 * Mirrors the untun interface so existing code needs minimal changes.
 */
function buildHandle(url, proc) {
  let closed = false;

  return {
    /** Returns the public HTTPS URL of this tunnel. */
    getURL() {
      return Promise.resolve(url);
    },

    /** Terminates the cloudflared process and cleans up. */
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise((resolve) => {
        proc.once("close", resolve);
        proc.kill("SIGTERM");
        // Force-kill after 3 s if it doesn't exit gracefully
        setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch (_) {}
          resolve();
        }, 3000).unref?.();
      });
    },

    /** The underlying child process, exposed for advanced use. */
    process: proc,
  };
}
