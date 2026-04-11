const { spawn } = require('child_process');

async function test() {
  const mcp = spawn('bun', ['run', 'src/index.js'], { cwd: 'mcp-server' });
  mcp.stdout.on('data', d => console.log('MCP:', d.toString().trim()));
  mcp.stderr.on('data', d => console.log('MCP ERR:', d.toString().trim()));

  await new Promise(r => setTimeout(r, 2000));
  
  // Connect extension SSE
  const http = require('http');
  const req = http.request('http://127.0.0.1:31337/api/extension/commands', { headers: { 'Accept': 'text/event-stream' } }, (res) => {
    res.on('data', async chunk => {
      const data = chunk.toString();
      if (data.includes('data: ')) {
        const msg = JSON.parse(data.split('data: ')[1].trim());
        console.log("EXT RECV:", msg);
        // mock success
        await fetch('http://127.0.0.1:31337/api/extension/cdp-result', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ id: msg.id, result: { value: 'success' } })
        });
      }
    });
  });
  req.end();

  await new Promise(r => setTimeout(r, 1000));
  
  // Call tool via STDIO
  // Actually easier to just write a simple script that imports sendCdpCommand
  mcp.kill();
  process.exit(0);
}
test();
