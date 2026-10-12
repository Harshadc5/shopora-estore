// Runs the Vercel function in api/collect.js as an ordinary Node server.
import http from 'node:http';
import handler from '../api/collect.js';
const PORT = process.env.PORT || 4001;
http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1_000_000) req.destroy(); // tag payloads are far smaller than this
  });
  req.on('end', async () => {
    req.body = raw;
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      if (!res.writableEnded) { res.statusCode = 500; res.end(); }
    }
  });
}).listen(PORT, () => console.log(`Tag receiver listening on port ${PORT}`));
