#!/usr/bin/env node
import { startHttpServer } from './http.js';
import { startMcpServer } from './mcp.js';

// Boot both the HTTP bridge (for the browser) and the MCP protocol (for the LLM)
const PORT = process.env.PORT || 31337;
startHttpServer(PORT);
startMcpServer();