import { startTunnel } from 'untun';

async function run() {
  console.log("Starting...");
  const tunnel = await startTunnel({ port: 31337 });
  const url = await tunnel.getURL();
  console.log("URL:", url);
  
  const res = await fetch(url + "/health");
  console.log("Health:", res.status, await res.text());
  
  const res2 = await fetch(url + "/sse");
  console.log("SSE:", res2.status);
  
  process.exit(0);
}
run();
