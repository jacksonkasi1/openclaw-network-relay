import { startTunnel } from 'untun';
import express from 'express';

const app = express();
app.get('/health', (req, res) => res.json({ ok: true }));

const server = app.listen(31337, '127.0.0.1', async () => {
  console.log("Server listening...");
  const tunnel = await startTunnel({ port: 31337, hostname: '127.0.0.1' });
  const url = await tunnel.getURL();
  console.log("URL:", url);
  
  // wait for tunnel to be active
  await new Promise(r => setTimeout(r, 3000));

  const res = await fetch(url + "/health");
  console.log("Health:", res.status, await res.text());
  
  process.exit(0);
});
