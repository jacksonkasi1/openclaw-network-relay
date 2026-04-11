const { Worker } = require('worker_threads');

const workerCode = `
try {
  new EventSource('http://localhost:31337');
  console.log("EventSource exists!");
} catch(e) {
  console.log("Error:", e.message);
}
`;
const w = new Worker(workerCode, { eval: true });
