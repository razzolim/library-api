import { verifyToken } from '../lib/jwt.js';
import { isTokenRevoked } from '../services/auth.service.js';
import { isUserActive } from '../services/users.service.js';

const UNAUTHORIZED_BODY = {
  error: 'Unauthorized',
  message: 'Missing or invalid token',
};

export async function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json(UNAUTHORIZED_BODY);
  }

  const token = header.slice('Bearer '.length).trim();

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json(UNAUTHORIZED_BODY);
  }

  try {
    if (await isTokenRevoked(payload.jti)) {
      return res.status(401).json(UNAUTHORIZED_BODY);
    }
  } catch (err) {
    return next(err);
  }

  try {
    if (!(await isUserActive(payload.sub))) {
      return res.status(401).json(UNAUTHORIZED_BODY);
    }
  } catch (err) {
    return next(err);
  }

  req.user = payload;
  return next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
  }
  return next();
}
