import { Request, Response, NextFunction, Router } from 'express';
import { Database } from '../database/connection';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

declare module 'express-serve-static-core' {
  interface Request { adminUser?: { id: string; email: string }; }
}

const DEFAULT_TTL_DAYS = parseInt(process.env.ADMIN_SESSION_TTL_DAYS || '7', 10);
const COOKIE_NAME = 'admin_session';

async function fetchSession(token: string) {
  return Database.query(
    `SELECT s.id as session_id, s.admin_user_id, u.email, s.expires_at, s.revoked_at
     FROM admin_sessions s
     JOIN admin_users u ON u.id = s.admin_user_id
     WHERE s.session_token = $1`, [token]
  );
}

export async function adminSessionAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = (req.cookies && req.cookies[COOKIE_NAME]) || undefined;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const result = await fetchSession(token);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
    const row = result.rows[0];
    if (row.revoked_at) return res.status(401).json({ error: 'Session revoked' });
    if (new Date(row.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired' });
    req.adminUser = { id: row.admin_user_id, email: row.email };
    Database.query('UPDATE admin_sessions SET last_used_at = NOW() WHERE id = $1', [row.session_id]).catch(()=>{});
    next();
  } catch (e) {
    next(e);
  }
}

export const adminAuthRouter = Router();

function setSessionCookie(res: Response, token: string, ttlDays: number) {
  const maxAgeMs = ttlDays * 24 * 60 * 60 * 1000;
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: maxAgeMs
  });
}

adminAuthRouter.post('/bootstrap', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const existing = await Database.query('SELECT COUNT(*)::int AS count FROM admin_users');
  if (existing.rows[0].count > 0) return res.status(409).json({ error: 'Admin already initialized' });
  const hash = await bcrypt.hash(password, 12);
  const user = await Database.query('INSERT INTO admin_users (email, password_hash) VALUES ($1, $2) RETURNING id, email', [email, hash]);
  res.status(201).json({ user: user.rows[0] });
});

adminAuthRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = await Database.query('SELECT id, email, password_hash FROM admin_users WHERE email = $1', [email]);
  if (user.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
  const row = user.rows[0];
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + DEFAULT_TTL_DAYS * 86400000);
  await Database.query('INSERT INTO admin_sessions (admin_user_id, session_token, expires_at) VALUES ($1, $2, $3)', [row.id, token, expires]);
  setSessionCookie(res, token, DEFAULT_TTL_DAYS);
  res.json({ user: { id: row.id, email: row.email }, expires_at: expires.toISOString() });
});

adminAuthRouter.post('/logout', adminSessionAuth, async (req, res) => {
  const token = (req.cookies && req.cookies[COOKIE_NAME]) || undefined;
  if (token) {
    await Database.query('UPDATE admin_sessions SET revoked_at = NOW() WHERE session_token = $1 AND revoked_at IS NULL', [token]);
    res.clearCookie(COOKIE_NAME);
  }
  res.json({ success: true });
});

adminAuthRouter.get('/me', adminSessionAuth, async (req, res) => {
  res.json({ user: req.adminUser });
});
