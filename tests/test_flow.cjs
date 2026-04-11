const { spawn } = require('child_process');
const http = require('http');

const server = spawn('bun', ['run', 'src/index.js'], { cwd: 'mcp-server' });
server.stdout.on('data', d => console.log('SERVER:', d.toString().trim()));
server.stderr.on('data', d => console.log('SERVER ERR:', d.toString().trim()));

setTimeout(() => {
  // Simulate extension SSE connection
  console.log("Simulating extension connection...");
  const req = http.request('http://127.0.0.1:31337/api/extension/commands', {
    headers: { 'Accept': 'text/event-stream' }
  }, (res) => {
    res.on('data', async (chunk) => {
      const data = chunk.toString();
      console.log("EXTENSION RECEIVED:", data);
      
      if (data.includes('data: ')) {
        try {
           const jsonStr = data.split('data: ')[1].trim();
           const msg = JSON.parse(jsonStr);
           if (msg.id) {
             console.log("Simulating extension sending success result for id", msg.id);
             await fetch('http://127.0.0.1:31337/api/extension/cdp-result', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ id: msg.id, result: { ok: true } })
             });
           }
        } catch(e) {
           console.error("Parse error", e);
        }
      }
    });
  });
  req.end();
  
  // Simulate MCP tool call
  setTimeout(async () => {
    console.log("Simulating tool call via MCP HTTP (we don't have an HTTP tool endpoint, so we'll use a direct internal call if we can, or just observe)");
    // actually, let's just make a small script to import and call the tool
  }, 1000);

}, 2000);

setTimeout(() => {
  server.kill();
  process.exit(0);
}, 6000);
