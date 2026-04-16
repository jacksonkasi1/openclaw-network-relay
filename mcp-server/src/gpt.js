/**
 * gpt.js — REST API bridge between ChatGPT Custom GPT Actions and the local MCP server.
 *
 * Architecture:
 *   ChatGPT (HTTPS) → ngrok/Cloudflare tunnel → Express (/api/gpt/*)
 *                                                        ↓ InMemoryTransport
 *                                               MCP Server Instance (all tools)
 *                                                        ↓
 *                                               Chrome Extension / Local System
 *
 * Endpoints (all under /api/gpt, mounted in http.js):
 *   GET  /openapi.json  — OpenAPI 3.1 schema (public, GPT fetches this)
 *   GET  /tools         — List all MCP tools (requires Bearer token)
 *   POST /tool          — Call an MCP tool   (requires Bearer token)
 *
 * Setup:
 *   1. Set GPT_API_KEY=<random-secret> in mcp-server/.env
 *   2. Enable SSE tunnel from the dashboard (or set GPT_AUTO_TUNNEL=true)
 *   3. Copy the public URL shown in the dashboard
 *   4. Create a Custom GPT → Actions → import from URL:
 *        https://<tunnel-url>/api/gpt/openapi.json
 *   5. Set authentication to "API Key" → Bearer → paste GPT_API_KEY value
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Router } from "express";
import { createMcpServerInstance } from "./mcp.js";

// ─── In-process MCP client (lazy-initialized, singleton) ─────────────────────

let _client = null;
let _initPromise = null;

/**
 * Returns a connected MCP Client that speaks directly (in-process) to a
 * dedicated MCP server instance via InMemoryTransport.  Initialises once and
 * reuses the same connection for all subsequent GPT requests.
 */
async function getMcpClient() {
  if (_client) return _client;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    // Spin up a fresh MCP server instance wired to the in-memory transport.
    // This shares all module-level state (CDP streams, DB, etc.) with the
    // stdio / SSE instances, which is exactly what we want.
    const server = createMcpServerInstance();
    await server.connect(serverTransport);

    const client = new Client(
      { name: "openclaw-gpt-bridge", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(clientTransport);

    _client = client;
    console.error("[GPT] In-process MCP bridge ready");
    return _client;
  })();

  return _initPromise;
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireApiKey(req, res, next) {
  const configured = process.env.GPT_API_KEY;

  if (!configured) {
    return res.status(503).json({
      error:
        "GPT API bridge is not configured. " +
        "Set GPT_API_KEY in mcp-server/.env and restart the server.",
    });
  }

  const auth = (req.headers["authorization"] || "").trim();
  if (auth !== `Bearer ${configured}`) {
    return res.status(401).json({
      error: "Unauthorized. Provide a valid Bearer token matching GPT_API_KEY.",
    });
  }

  next();
}

// ─── OpenAPI 3.1 schema ───────────────────────────────────────────────────────

/**
 * Generates the OpenAPI schema that the Custom GPT reads to understand what
 * actions are available.  The server URL is dynamic so it always reflects the
 * current tunnel address.
 *
 * @param {string} baseUrl  e.g. "https://abc123.trycloudflare.com"
 */
export function generateOpenApiSchema(baseUrl) {
  return {
    openapi: "3.1.0",
    info: {
      title: "OpenClaw MCP Bridge",
      description:
        "Exposes all OpenClaw MCP tools as REST endpoints for ChatGPT Custom GPT Actions. " +
        "Controls a local Chrome browser via the OpenClaw extension — navigate pages, " +
        "intercept network traffic, take screenshots, run JS, and perform security testing " +
        "entirely from ChatGPT.",
      version: "1.0.0",
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/api/gpt/tools": {
        get: {
          operationId: "listMcpTools",
          summary: "List all available MCP tools",
          description:
            "Returns every MCP tool this server exposes, including names, " +
            "descriptions, and JSON-Schema inputSchemas.  Call this first to " +
            "discover what tools are available before calling /api/gpt/tool.",
          security: [{ BearerAuth: [] }],
          responses: {
            "200": {
              description: "Array of tool descriptors",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      tools: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            description: { type: "string" },
                            inputSchema: { type: "object" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { description: "Unauthorized — invalid or missing Bearer token" },
            "503": { description: "GPT_API_KEY not configured on the server" },
          },
        },
      },
      "/api/gpt/tool": {
        post: {
          operationId: "callMcpTool",
          summary: "Execute an MCP tool by name",
          description:
            "Calls a specific MCP tool with the supplied arguments and returns " +
            "its result.  Use listMcpTools to discover tool names and their " +
            "expected inputSchemas before calling this endpoint.",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: {
                      type: "string",
                      description:
                        "Exact name of the MCP tool to call (e.g. 'browser_navigate').",
                    },
                    arguments: {
                      type: "object",
                      description:
                        "Arguments for the tool.  Shape must match the tool's " +
                        "inputSchema (see listMcpTools).  Omit or pass {} if the " +
                        "tool takes no arguments.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Tool execution result",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      content: {
                        type: "array",
                        description:
                          "Array of content blocks (text, image, etc.) returned " +
                          "by the tool.",
                        items: {
                          type: "object",
                          properties: {
                            type: {
                              type: "string",
                              enum: ["text", "image", "resource"],
                            },
                            text: { type: "string" },
                            data: {
                              type: "string",
                              description: "Base-64 encoded data for image content",
                            },
                            mimeType: { type: "string" },
                          },
                        },
                      },
                      isError: {
                        type: "boolean",
                        description:
                          "true if the tool itself reported an error (as opposed to " +
                          "an HTTP-level error).",
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request — 'name' field is missing",
            },
            "401": { description: "Unauthorized — invalid or missing Bearer token" },
            "500": { description: "Tool execution failed unexpectedly" },
            "503": { description: "GPT_API_KEY not configured on the server" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "API key that matches the GPT_API_KEY environment variable set on the " +
            "local MCP server.  Configure this in the Custom GPT → Actions → " +
            "Authentication → API Key → Bearer section.",
        },
      },
    },
  };
}

// ─── Express router ───────────────────────────────────────────────────────────

/**
 * Returns an Express Router with all GPT-facing endpoints.
 * Mount it in http.js with:  app.use('/api/gpt', createGptRouter());
 */
export function createGptRouter() {
  const router = Router();

  // ── GET /api/gpt/openapi.json ─────────────────────────────────────────────
  // Public — no auth required. ChatGPT fetches this to learn what actions exist.
  // The server URL embedded in the schema always reflects the live tunnel address.
  router.get("/openapi.json", (_req, res) => {
    const port = parseInt(process.env.PORT || "31337", 10);
    const baseUrl =
      global.publicUrl || `http://localhost:${port}`;
    res.json(generateOpenApiSchema(baseUrl));
  });

  // ── GET /api/gpt/status ───────────────────────────────────────────────────
  // Lightweight health check the Custom GPT can call before doing real work.
  router.get("/status", requireApiKey, (_req, res) => {
    const port = parseInt(process.env.PORT || "31337", 10);
    res.json({
      ok: true,
      tunnelActive: !!global.publicUrl,
      publicUrl: global.publicUrl || null,
      localUrl: `http://localhost:${port}`,
    });
  });

  // ── GET /api/gpt/tools ────────────────────────────────────────────────────
  // Returns the full tool list so the GPT knows what it can do.
  router.get("/tools", requireApiKey, async (_req, res) => {
    try {
      const client = await getMcpClient();
      const { tools } = await client.listTools();
      res.json({ tools });
    } catch (err) {
      console.error("[GPT] listTools error:", err.message);
      res.status(500).json({
        error: "Failed to list MCP tools",
        details: err.message,
      });
    }
  });

  // ── POST /api/gpt/tool ────────────────────────────────────────────────────
  // Executes a single MCP tool and streams the result back as JSON.
  router.post("/tool", requireApiKey, async (req, res) => {
    const { name, arguments: args = {} } = req.body || {};

    if (!name || typeof name !== "string") {
      return res.status(400).json({
        error: "Request body must include a non-empty 'name' string.",
      });
    }

    console.error(`[GPT] callTool → ${name}`, JSON.stringify(args).slice(0, 200));

    try {
      const client = await getMcpClient();
      const result = await client.callTool({ name, arguments: args });

      // Truncate oversized text content so we don't blow the GPT context window.
      if (Array.isArray(result.content)) {
        result.content = result.content.map((block) => {
          if (block.type === "text" && typeof block.text === "string") {
            const MAX = 12_000;
            if (block.text.length > MAX) {
              block.text =
                block.text.slice(0, MAX) +
                `\n\n[… output truncated at ${MAX} chars to fit context window …]`;
            }
          }
          return block;
        });
      }

      res.json(result);
    } catch (err) {
      console.error(`[GPT] callTool error (${name}):`, err.message);
      res.status(500).json({
        error: `Tool '${name}' failed`,
        details: err.message,
      });
    }
  });

  return router;
}
