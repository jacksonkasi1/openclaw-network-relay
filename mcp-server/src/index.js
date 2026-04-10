#!/usr/bin/env node
import { startHttpServer } from './http.js';
import { startMcpServer } from './mcp.js';

const PORT = process.env.PORT || 31337;

startHttpServer(PORT);
startMcpServer();
