const express = require('express');
const app = express();
app.get('/test-sse', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('data: {"hello": "world"}\n\n');
});
app.listen(31338, () => console.log('listening'));
