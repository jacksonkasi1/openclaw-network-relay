import { startTunnel } from 'untun';
import express from 'express';

const app = express();
app.get('/sse', (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });
  res.write("data: hello\n\n");
});

app.listen(31338, async () => {
  console.log("Listening on 31338");
  const tunnel = await startTunnel({ port: 31338 });
  const url = await tunnel.getURL();
  console.log("Tunnel URL:", url);
  setTimeout(() => process.exit(0), 30000);
});
