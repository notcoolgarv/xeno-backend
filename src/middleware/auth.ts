import { Database } from '../database/connection';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';

declare module 'express-serve-static-core' {
  interface Request {
    tenantId?: string;
    tenant?: any;
    apiKeyId?: string;
  }
}

function hashApiKey(raw: string, pepper?: string): string {
  return crypto.createHash('sha256').update(`${raw}${pepper || ''}`).digest('hex');
}

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const headerKey = req.header('x-api-key') || req.header('X-API-Key');
    if (!headerKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    const pepper = process.env.API_KEY_PEPPER;
    const hashed = hashApiKey(headerKey, pepper);

    const result = await Database.query(
      `SELECT k.id as api_key_id, t.* FROM tenant_api_keys k
       JOIN tenants t ON t.id = k.tenant_id
       WHERE k.hashed_key = $1 AND k.revoked_at IS NULL
       LIMIT 1`,
      [hashed]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const row = result.rows[0];
    req.tenantId = row.id;
    req.tenant = {
      id: row.id,
      shop_domain: row.shop_domain,
      status: row.status,
      plan: row.plan
    };
    req.apiKeyId = row.api_key_id;

    Database.query('UPDATE tenant_api_keys SET last_used_at = NOW() WHERE id = $1', [row.api_key_id])
      .catch(() => {/* ignore */});

    next();
  } catch (err) {
    console.error('API key auth error', err);
    return res.status(500).json({ error: 'Authentication failure' });
  }
}

export function generateApiKey(pepper?: string) {
  const raw = 'xsk_' + crypto.randomBytes(24).toString('hex');
  const hashed = hashApiKey(raw, pepper || process.env.API_KEY_PEPPER);
  return { raw, hashed };
}

export function adminAuth(req: Request, res: Response, next: NextFunction) {
  const configured = process.env.ADMIN_TOKEN;
  if (!configured) {
    return res.status(500).json({ error: 'Admin token not configured' });
  }
  const authz = req.header('authorization') || req.header('Authorization');
  if (!authz || !authz.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Admin authorization required' });
  }
  const token = authz.substring('Bearer '.length).trim();
  if (token !== configured) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  (req as any).isAdmin = true;
  next();
}

export function ensureTenantAccess(req: Request, res: Response, next: NextFunction) {
  const { tenantId } = req.params as any;
  if (req.tenantId && tenantId && req.tenantId !== tenantId) {
    return res.status(403).json({ error: 'Forbidden: tenant mismatch' });
  }
  next();
}

export async function apiKeyOrAdminSession(req: Request, res: Response, next: NextFunction) {
  const headerKey = req.header('x-api-key') || req.header('X-API-Key');
  if (headerKey) {
    return apiKeyAuth(req, res, next);
  }

  const COOKIE_NAME = 'admin_session';
  const token = (req as any).cookies ? (req as any).cookies[COOKIE_NAME] : undefined;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required (API key or admin session)' });
  }
  try {
    const result = await Database.query(
      `SELECT s.id as session_id, s.admin_user_id, u.email, s.expires_at, s.revoked_at
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_user_id
       WHERE s.session_token = $1`, [token]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid session' });
    const row = result.rows[0];
    if (row.revoked_at) return res.status(401).json({ error: 'Session revoked' });
    if (new Date(row.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired' });
    (req as any).adminUser = { id: row.admin_user_id, email: row.email };
    Database.query('UPDATE admin_sessions SET last_used_at = NOW() WHERE id = $1', [row.session_id]).catch(()=>{});
    return next();
  } catch (e) {
    console.error('apiKeyOrAdminSession error', e);
    return res.status(500).json({ error: 'Authentication failure' });
  }
}

export async function tenantBasicAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.header('authorization') || req.header('Authorization');
    if (!auth || !auth.startsWith('Basic ')) return res.status(401).json({ error: 'Basic auth required' });
    const raw = Buffer.from(auth.substring(6), 'base64').toString('utf8');
    const idx = raw.indexOf(':');
    if (idx === -1) return res.status(400).json({ error: 'Invalid basic auth format' });
    const email = raw.substring(0, idx);
    const password = raw.substring(idx + 1);
    const userRes = await Database.query(
      `SELECT tu.id, tu.email, tu.password_hash, tu.role, t.id as tenant_id, t.shop_domain
       FROM tenant_users tu
       JOIN tenants t ON t.id = tu.tenant_id
       WHERE tu.email = $1
       LIMIT 1`, [email]
    );
    if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const row = userRes.rows[0];
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    req.tenantId = row.tenant_id;
    req.tenant = { id: row.tenant_id, shop_domain: row.shop_domain };
    (req as any).tenantUser = { id: row.id, email: row.email, role: row.role };
    return next();
  } catch (e) {
    console.error('tenantBasicAuth error', e);
    return res.status(500).json({ error: 'Authentication failure' });
  }
}

export async function multiAuth(req: Request, res: Response, next: NextFunction) {
  const headerKey = req.header('x-api-key') || req.header('X-API-Key');
  if (headerKey) return apiKeyAuth(req, res, next);

  const COOKIE_NAME = 'admin_session';
  const token = (req as any).cookies ? (req as any).cookies[COOKIE_NAME] : undefined;
  if (token) {
    try {
      const result = await Database.query(
        `SELECT s.id as session_id, s.admin_user_id, u.email, s.expires_at, s.revoked_at
         FROM admin_sessions s
         JOIN admin_users u ON u.id = s.admin_user_id
         WHERE s.session_token = $1`, [token]
      );
      if (result.rows.length) {
        const row = result.rows[0];
        if (!row.revoked_at && new Date(row.expires_at) >= new Date()) {
          (req as any).adminUser = { id: row.admin_user_id, email: row.email };
          Database.query('UPDATE admin_sessions SET last_used_at = NOW() WHERE id = $1', [row.session_id]).catch(()=>{});
          return next();
        }
      }
    } catch (e) {
    }
  }

  const auth = req.header('authorization') || req.header('Authorization');
  if (auth && auth.startsWith('Basic ')) {
    return tenantBasicAuth(req, res, next);
  }

  return res.status(401).json({ error: 'Authentication required' });
}
