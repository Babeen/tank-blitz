// Plain HTTP endpoints that sit alongside Socket.IO on the same server —
// currently just the health check. Kept as a pure function of (req, res) so
// it's testable without spinning up Socket.IO or a real TCP listener.
export function handleHttpRequest(req, res) {
  // Simple liveness/readiness probe for hosting platforms — deliberately
  // returns nothing beyond a status flag and uptime, no internal details.
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: Math.round(process.uptime()) }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}
