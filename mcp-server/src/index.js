#!/usr/bin/env node
import { createHttpApp } from './http.js';
import { startMcpServer } from './mcp.js';

let PORT = parseInt(process.env.PORT || '31337', 10);

const app = createHttpApp();
startMcpServer(app);

function startServer(port) {
  const server = app.listen(port, () => {
    console.error(`[HTTP] OpenClaw Dashboard listening on http://localhost:${port}`);
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`[HTTP] Port ${port} is in use. Trying port ${port + 1}...`);
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
