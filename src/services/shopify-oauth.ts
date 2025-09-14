import crypto from 'crypto';
import fetch from 'node-fetch';
import { config } from '../config';
import { Database } from '../database/connection';
import { encryptToken } from './encryption';

function missingShopifyConfig(): string[] {
  const missing: string[] = [];
  if (!config.shopify.apiKey) missing.push('SHOPIFY_API_KEY');
  if (!config.shopify.apiSecret) missing.push('SHOPIFY_API_SECRET');
  if (!config.shopify.scopes) missing.push('SHOPIFY_SCOPES');
  if (!config.shopify.redirectUri) missing.push('SHOPIFY_REDIRECT_URI');
  return missing;
}

export function buildShopifyAuthUrl(shop: string, state: string) {
  const missing = missingShopifyConfig().filter(v => v !== 'SHOPIFY_API_SECRET');
  if (missing.length) {
    throw new Error(`Shopify OAuth not configured: missing ${missing.join(', ')}`);
  }
  if (!config.shopify.apiKey || !config.shopify.scopes || !config.shopify.redirectUri) {
    throw new Error('Shopify OAuth not configured (incomplete)');
  }
  const base = `https://${shop}/admin/oauth/authorize`;
  const params = new URLSearchParams({
    client_id: config.shopify.apiKey,
    scope: config.shopify.scopes,
    redirect_uri: config.shopify.redirectUri,
    state
  });
  return `${base}?${params.toString()}`;
}

export function verifyHmac(query: Record<string,string | string[] | undefined>): boolean {
  if (!config.shopify.apiSecret) return false;
  const receivedHmac = Array.isArray(query.hmac) ? query.hmac[0] : query.hmac || '';
  const sorted = Object.keys(query)
    .filter(k => k !== 'hmac' && k !== 'signature')
    .sort()
    .map(k => `${k}=${Array.isArray(query[k]) ? query[k]![0] : query[k]}`)
    .join('&');
  const digest = crypto
    .createHmac('sha256', config.shopify.apiSecret)
    .update(sorted)
    .digest('hex');
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(receivedHmac, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function exchangeCodeForToken(shop: string, code: string) {
  if (!config.shopify.apiKey || !config.shopify.apiSecret) throw new Error('Missing Shopify credentials');
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.shopify.apiKey,
      client_secret: config.shopify.apiSecret,
      code
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ access_token: string; scope: string }>;
}

export async function upsertTenant(shop: string, accessToken: string) {
  const domain = shop.toLowerCase();
  let storedToken = accessToken;
  try {
    if (process.env.TOKEN_ENCRYPTION_KEY) {
      storedToken = encryptToken(accessToken);
    }
  } catch (e) {
    console.warn('[encryption] Failed to encrypt access token, storing plaintext', (e as any).message);
  }
  const result = await Database.query(`
    INSERT INTO tenants (shop_domain, access_token)
    VALUES ($1, $2)
    ON CONFLICT (shop_domain) DO UPDATE SET access_token = EXCLUDED.access_token, updated_at = NOW()
    RETURNING id, shop_domain, status, created_at
  `, [domain, storedToken]);
  return result.rows[0];
}
