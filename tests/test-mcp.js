import { getTrafficLogs } from './mcp-server/src/db.js';
console.log("Found logs:", getTrafficLogs(5).length);
