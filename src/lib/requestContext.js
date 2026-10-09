// Request details recorded alongside audit-log entries.
export function requestContext(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}
