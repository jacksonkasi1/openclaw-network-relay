#!/usr/bin/env node
import { createHttpApp } from './http.js';
import { startMcpServer } from './mcp.js';

const PORT = process.env.PORT || 31337;

const app = createHttpApp();
startMcpServer(app);

app.listen(PORT, '127.0.0.1', () => {
  console.error(`[HTTP] OpenClaw Dashboard listening on http://127.0.0.1:${PORT}`);
});
