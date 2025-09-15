import { Router } from 'express';
import { Database } from '../database/connection';
import { DataIngestionService } from '../services/data-ingestion';
import { apiKeyAuth, generateApiKey, ensureTenantAccess, apiKeyOrAdminSession, tenantBasicAuth, multiAuth } from '../middleware/auth';
import { buildShopifyAuthUrl, verifyHmac, exchangeCodeForToken, upsertTenant } from '../services/shopify-oauth';
import crypto from 'crypto';
import { generateStrongPassword } from '../services/password';
import { adminSessionAuth } from '../middleware/admin-session';
import { decryptToken, encryptToken } from '../services/encryption';

const router = Router();
// In-memory map for state -> timestamp (simple; could move to Redis)
const oauthStateMap = new Map<string, number>();

// Debug endpoint (admin only) to inspect non-secret Shopify config
router.get('/shopify/debug', adminSessionAuth, (req, res) => {
  const { config } = require('../config');
  const redir = config.shopify.redirectUri;
  let redirectHost: string | null = null;
  try { redirectHost = redir ? new URL(redir).host : null; } catch { redirectHost = null; }
  let appUrl = config.shopify.appUrl;
  let appHost: string | null = null;
  if (appUrl) { try { appHost = new URL(appUrl).host; } catch { appHost = null; } }
  res.json({
    apiKeySet: !!config.shopify.apiKey,
    redirectUri: redir,
    redirectUri_b64: redir ? Buffer.from(redir).toString('base64') : null,
    redirectHost,
    appUrl,
    appUrl_b64: appUrl ? Buffer.from(appUrl).toString('base64') : null,
    appHost,
    hostMatch: redirectHost && appHost ? redirectHost === appHost : null,
    scopes: config.shopify.scopes,
    note: 'apiKeySet true means key loaded. No secrets exposed.'
  });
});

router.get('/shopify/install', async (req, res) => {
  try {
    let shop = String(req.query.shop || '').trim().toLowerCase();
    if (!shop) return res.status(400).json({ error: 'Missing shop parameter' });

    const SUFFIX = '.myshopify.com';
    const barePattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

    if (shop.endsWith(SUFFIX)) {
      const base = shop.slice(0, -SUFFIX.length);
      if (!base || !barePattern.test(base)) {
        return res.status(400).json({ error: 'Invalid shop domain format' });
      }
    } else {
      if (shop.includes('.')) {
        return res.status(400).json({ error: 'Invalid shop value; supply store name or full .myshopify.com domain' });
      }
      if (!barePattern.test(shop)) {
        return res.status(400).json({ error: 'Invalid shop name characters' });
      }
      shop = shop + SUFFIX;
    }

    const state = crypto.randomBytes(16).toString('hex');
    oauthStateMap.set(state, Date.now());
    for (const [k,v] of oauthStateMap.entries()) { if (Date.now() - v > 10*60*1000) oauthStateMap.delete(k); }
    const url = buildShopifyAuthUrl(shop, state);
    try {
      const parsed = new URL(url);
      const redirectParam = parsed.searchParams.get('redirect_uri');
      console.log('[oauth.install] shop=%s state=%s redirectUriConfigured=%s redirectUriInUrl=%s', shop, state, require('../config').config.shopify.redirectUri, redirectParam);
    } catch {}
    res.json({ authorize_url: url, state, normalized_shop_domain: shop });
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to build auth URL', detail: e.message });
  }
});

router.get('/shopify/callback', async (req, res) => {
  try {
    const { shop, state, code } = req.query as Record<string,string>;
    if (!shop || !state || !code) return res.status(400).send('Missing required params');
    if (!oauthStateMap.has(state)) return res.status(400).send('Invalid state');
    oauthStateMap.delete(state);
    if (!verifyHmac(req.query as any)) return res.status(400).send('HMAC validation failed');
    const tokenResp = await exchangeCodeForToken(shop, code);
    const tenant = await upsertTenant(shop, tokenResp.access_token);
    res.send(`<html><body style="font-family:system-ui;padding:40px;">Installation successful for <strong>${tenant.shop_domain}</strong>.<br/>You may close this window.</body></html>`);
  } catch (e: any) {
    console.error('OAuth callback error', e);
    res.status(500).send('OAuth callback failed');
  }
});
const ingestionService = new DataIngestionService();

router.post('/tenants', adminSessionAuth, async (req, res) => {
  try {
  const { shop_domain, access_token } = req.body || {};
    if (!shop_domain) return res.status(400).json({ error: 'shop_domain is required' });
    let stored = access_token || null;
    if (stored && process.env.TOKEN_ENCRYPTION_KEY) {
      try { stored = encryptToken(stored); } catch (e:any) { console.warn('[encryption] create tenant token encrypt failed', e.message); }
    }
    const result = await Database.query(`
      INSERT INTO tenants (shop_domain, access_token)
      VALUES ($1, $2)
      ON CONFLICT (shop_domain) DO NOTHING
      RETURNING id, shop_domain, status, created_at, updated_at, (access_token IS NOT NULL) AS has_access_token
    `, [shop_domain.toLowerCase().trim(), stored]);
    if (!result.rows.length) {
      const existing = await Database.query('SELECT id, shop_domain, status, created_at, updated_at, (access_token IS NOT NULL) AS has_access_token FROM tenants WHERE shop_domain = $1', [shop_domain.toLowerCase().trim()]);
      return res.status(200).json(existing.rows[0]);
    }
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create tenant error:', error);
    res.status(500).json({ error: 'Failed to create tenant' });
  }
});

router.post('/tenants/init', adminSessionAuth, async (req, res) => {
  const { shop_domain, access_token, user_email, role } = req.body || {};
  if (!shop_domain || !user_email) {
    return res.status(400).json({ error: 'shop_domain and user_email required (access_token optional until Shopify connect)' });
  }
  try {
    const bcrypt = require('bcryptjs');
    const plainPassword = generateStrongPassword(16);
    const passwordHash = await bcrypt.hash(plainPassword, 12);
    const result = await Database.transaction(async (q) => {
      const existing = await q('SELECT id, shop_domain, status, created_at, (access_token IS NOT NULL) AS has_access_token FROM tenants WHERE shop_domain = $1', [shop_domain.toLowerCase().trim()]);
      let tenantRow;
      if (existing.rows.length) {
        tenantRow = existing.rows[0];
      } else {
        let stored = access_token || null;
        if (stored && process.env.TOKEN_ENCRYPTION_KEY) {
          try { stored = encryptToken(stored); } catch (e:any) { console.warn('[encryption] init tenant token encrypt failed', e.message); }
        }
        const t = await q(`INSERT INTO tenants (shop_domain, access_token) VALUES ($1,$2) RETURNING id, shop_domain, status, created_at, (access_token IS NOT NULL) AS has_access_token`, [shop_domain.toLowerCase().trim(), stored]);
        tenantRow = t.rows[0];
      }
      const u = await q(`INSERT INTO tenant_users (tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, email, role, created_at`, [tenantRow.id, user_email, passwordHash, role || 'owner']);
      return { tenant: tenantRow, user: u.rows[0], password: plainPassword };
    });
    res.status(201).json({ ...result });
  } catch (e: any) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Tenant or user already exists' });
    }
    console.error('Tenant init error', e);
    res.status(500).json({ error: 'Failed to initialize tenant' });
  }
});

router.get('/tenants', adminSessionAuth, async (req, res) => {
  try {
    const result = await Database.query(`
      SELECT id, shop_domain, status, created_at, updated_at, (access_token IS NOT NULL) AS has_access_token 
      FROM tenants 
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Get tenants error:', error);
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
});

// Ingestion: allow either tenant auth (API key/basic) or admin session.
router.post('/tenants/:tenantId/ingest', adminSessionAuth, multiAuth, ensureTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    if (req.tenantId && req.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Forbidden: tenant mismatch' });
    }
    const { data_types } = req.body;
    
    const tenant = await Database.query(`
      SELECT * FROM tenants WHERE id = $1
    `, [tenantId]);

    if (tenant.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

  const tenantData = tenant.rows[0];
    if (!tenantData.access_token) {
      return res.status(400).json({ error: 'Tenant not connected to Shopify yet (missing access token)' });
    }
    let token = tenantData.access_token;
    if (process.env.TOKEN_ENCRYPTION_KEY) {
      try { token = decryptToken(token); } catch (e:any) { return res.status(500).json({ error: 'Failed to decrypt tenant access token'}); }
    }
    const results: Record<string, any> = {};

    if (!data_types || data_types.includes('customers')) {
      results['customers'] = await ingestionService.ingestCustomers(
        tenantId, tenantData.shop_domain, token
      );
    }

    if (!data_types || data_types.includes('products')) {
      results['products'] = await ingestionService.ingestProducts(
        tenantId, tenantData.shop_domain, token
      );
    }

    if (!data_types || data_types.includes('orders')) {
      results['orders'] = await ingestionService.ingestOrders(
        tenantId, tenantData.shop_domain, token
      );
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('Data ingestion error:', error);
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    res.status(500).json({ error: 'Data ingestion failed', details: errorMessage });
  }
});

router.get('/tenants/:tenantId/logs', multiAuth, ensureTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    if (req.tenantId && req.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Forbidden: tenant mismatch' });
    }
    
    const result = await Database.query(`
      SELECT * FROM sync_logs 
      WHERE tenant_id = $1 
      ORDER BY started_at DESC
      LIMIT 50
    `, [tenantId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

router.get('/tenants/:tenantId/analytics', multiAuth, ensureTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    if (req.tenantId && req.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Forbidden: tenant mismatch' });
    }
    
    const [customerCount, productCount, orderCount, eventCount] = await Promise.all([
      Database.query('SELECT COUNT(*) as count FROM customers WHERE tenant_id = $1', [tenantId]),
      Database.query('SELECT COUNT(*) as count FROM products WHERE tenant_id = $1', [tenantId]),
      Database.query('SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1', [tenantId]),
      Database.query('SELECT COUNT(*) as count FROM custom_events WHERE tenant_id = $1', [tenantId])
    ]);

    const analytics = {
      total_customers: parseInt(customerCount.rows[0].count),
      total_products: parseInt(productCount.rows[0].count),
      total_orders: parseInt(orderCount.rows[0].count),
      total_events: parseInt(eventCount.rows[0].count)
    };

    res.json(analytics);
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

router.get('/tenants/:tenantId/events/summary', multiAuth, ensureTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    if (req.tenantId && req.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Forbidden: tenant mismatch' });
    }

    const days = parseInt(String(req.query.days || '30'));
    const limitDays = Math.min(Math.max(days, 1), 90);

    const daily = await Database.query(
      `WITH ev AS (
         SELECT DATE(created_at) as day,
                SUM(CASE WHEN event_type = 'checkout_started' THEN 1 ELSE 0 END) AS checkout_started,
                SUM(CASE WHEN event_type = 'cart_abandoned' THEN 1 ELSE 0 END) AS cart_abandoned
         FROM custom_events
         WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '${limitDays} days'
         GROUP BY DATE(created_at)
       ), ord AS (
         SELECT DATE(created_at) as day,
                COUNT(*)::int AS orders
         FROM orders
         WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '${limitDays} days'
         GROUP BY DATE(created_at)
       )
       SELECT d.day,
              COALESCE(d.checkout_started,0) AS checkout_started,
              COALESCE(d.cart_abandoned,0) AS cart_abandoned,
              COALESCE(o.orders,0) AS orders
       FROM (
            SELECT generate_series::date AS day
            FROM generate_series(
              (CURRENT_DATE - INTERVAL '${limitDays} days')::date,
              CURRENT_DATE,
              '1 day'
            )
       ) gs
       LEFT JOIN ev d ON d.day = gs.day
       LEFT JOIN ord o ON o.day = gs.day
       ORDER BY gs.day ASC`,
      [tenantId]
    );

    const totals = daily.rows.reduce((acc: any, r: any) => {
      acc.checkout_started += parseInt(r.checkout_started);
      acc.cart_abandoned += parseInt(r.cart_abandoned);
      acc.orders += parseInt(r.orders);
      return acc;
    }, { checkout_started: 0, cart_abandoned: 0, orders: 0 });

    const enrichedDaily = daily.rows.map((r: any) => {
      const cs = parseInt(r.checkout_started);
      const ca = parseInt(r.cart_abandoned);
      const ord = parseInt(r.orders);
      const totalFunnels = cs + ca;
      const abandonment_rate = totalFunnels > 0 ? ca / totalFunnels : 0;
      const conversion_rate = cs > 0 ? ord / cs : 0;
      return { ...r, abandonment_rate, conversion_rate };
    });

    const totalFunnels = totals.checkout_started + totals.cart_abandoned;
    const abandonment_rate = totalFunnels > 0 ? totals.cart_abandoned / totalFunnels : 0;
    const conversion_rate = totals.checkout_started > 0 ? totals.orders / totals.checkout_started : 0;

    res.json({ range_days: limitDays, totals: { ...totals, abandonment_rate, conversion_rate }, daily: enrichedDaily });
  } catch (error) {
    console.error('Events summary error:', error);
    res.status(500).json({ error: 'Failed to fetch events summary' });
  }
});

router.get('/tenants/:tenantId/metrics/revenue-over-time', multiAuth, ensureTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    if (req.tenantId && req.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Forbidden: tenant mismatch' });
    }
    const days = parseInt(String(req.query.days || '30'));
    const limitDays = Math.min(Math.max(days, 1), 180);

    const rows = await Database.query(
      `WITH series AS (
         SELECT generate_series::date AS day
         FROM generate_series(
           (CURRENT_DATE - INTERVAL '${limitDays} days')::date,
           CURRENT_DATE,
           '1 day'
         )
       )
       SELECT s.day,
              COALESCE(SUM(o.total_price),0) AS revenue,
              COUNT(o.id) AS orders,
              COALESCE(COUNT(DISTINCT o.customer_id),0) AS unique_customers
       FROM series s
       LEFT JOIN orders o ON o.tenant_id = $1 AND DATE(o.created_at) = s.day
       GROUP BY s.day
       ORDER BY s.day ASC`,
      [tenantId]
    );

    let cumulativeRevenue = 0;
    let cumulativeOrders = 0;
    const enriched = rows.rows.map(r => {
      const rev = parseFloat(r.revenue);
      const ord = parseInt(r.orders);
      cumulativeRevenue += rev;
      cumulativeOrders += ord;
      return {
        day: r.day,
        revenue: rev,
        orders: ord,
        unique_customers: parseInt(r.unique_customers),
        cumulative_revenue: cumulativeRevenue,
        cumulative_orders: cumulativeOrders,
        aov: ord > 0 ? rev / ord : 0
      };
    });

    res.json({ range_days: limitDays, daily: enriched, totals: { revenue: cumulativeRevenue, orders: cumulativeOrders, aov: cumulativeOrders > 0 ? cumulativeRevenue / cumulativeOrders : 0 } });
  } catch (error) {
    console.error('Revenue over time error:', error);
    res.status(500).json({ error: 'Failed to fetch revenue over time' });
  }
});

router.get('/tenants/:tenantId/metrics/customer-growth', multiAuth, ensureTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const days = parseInt(String(req.query.days || '60'));
    const limitDays = Math.min(Math.max(days, 1), 365);
    const rows = await Database.query(
      `WITH series AS (
         SELECT generate_series::date AS day
         FROM generate_series(
           (CURRENT_DATE - INTERVAL '${limitDays} days')::date,
           CURRENT_DATE,
           '1 day'
         )
       ), cust AS (
         SELECT DATE(created_at) as day, COUNT(*)::int AS new_customers
         FROM customers
         WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '${limitDays} days'
         GROUP BY DATE(created_at)
       )
       SELECT s.day, COALESCE(c.new_customers,0) AS new_customers
       FROM series s
       LEFT JOIN cust c ON c.day = s.day
       ORDER BY s.day ASC`,
      [tenantId]
    );
    let cumulative = 0;
    const daily = rows.rows.map(r => {
      const n = parseInt(r.new_customers);
      cumulative += n;
      return { day: r.day, new_customers: n, cumulative_customers: cumulative };
    });
    res.json({ range_days: limitDays, daily, total_new: cumulative });
  } catch (e) {
    console.error('customer growth error', e);
    res.status(500).json({ error: 'Failed to fetch customer growth' });
  }
});

router.get('/tenants/:tenantId/metrics/product-growth', multiAuth, ensureTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const days = parseInt(String(req.query.days || '60'));
    const limitDays = Math.min(Math.max(days, 1), 365);
    const rows = await Database.query(
      `WITH series AS (
         SELECT generate_series::date AS day
         FROM generate_series(
           (CURRENT_DATE - INTERVAL '${limitDays} days')::date,
           CURRENT_DATE,
           '1 day'
         )
       ), prod AS (
         SELECT DATE(created_at) as day, COUNT(*)::int AS new_products
         FROM products
         WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '${limitDays} days'
         GROUP BY DATE(created_at)
       )
       SELECT s.day, COALESCE(p.new_products,0) AS new_products
       FROM series s
       LEFT JOIN prod p ON p.day = s.day
       ORDER BY s.day ASC`,
      [tenantId]
    );
    let cumulative = 0;
    const daily = rows.rows.map(r => {
      const n = parseInt(r.new_products);
      cumulative += n;
      return { day: r.day, new_products: n, cumulative_products: cumulative };
    });
    res.json({ range_days: limitDays, daily, total_new: cumulative });
  } catch (e) {
    console.error('product growth error', e);
    res.status(500).json({ error: 'Failed to fetch product growth' });
  }
});

router.get('/tenants/:tenantId/metrics/kpis', multiAuth, ensureTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const revenueOrders = await Database.query(
      `SELECT COALESCE(SUM(total_price),0) AS revenue, COUNT(*)::int AS orders, COALESCE(COUNT(DISTINCT customer_id),0) AS unique_customers
       FROM orders WHERE tenant_id = $1`, [tenantId]
    );
    const rc = await Database.query(
      `SELECT COUNT(*)::int AS repeat_customers FROM (
         SELECT customer_id, COUNT(*) FROM orders WHERE tenant_id = $1 AND customer_id IS NOT NULL GROUP BY customer_id HAVING COUNT(*) > 1
       ) x`, [tenantId]
    );
    const totalCustomers = await Database.query('SELECT COUNT(*)::int AS cnt FROM customers WHERE tenant_id = $1', [tenantId]);
    const row = revenueOrders.rows[0];
    const revenue = parseFloat(row.revenue);
    const orders = parseInt(row.orders);
    const uniqueCustomers = parseInt(row.unique_customers);
    const repeatCustomers = parseInt(rc.rows[0].repeat_customers);
    const customersTotal = parseInt(totalCustomers.rows[0].cnt);
    const aov = orders > 0 ? revenue / orders : 0;
    const repeat_customer_rate = customersTotal > 0 ? repeatCustomers / customersTotal : 0;
    res.json({ revenue, orders, unique_customers: uniqueCustomers, aov, repeat_customer_rate, total_customers: customersTotal });
  } catch (e) {
    console.error('kpis error', e);
    res.status(500).json({ error: 'Failed to fetch KPIs' });
  }
});

router.get('/stats', apiKeyOrAdminSession, async (req, res) => {
  try {
    const customerResult = await Database.query('SELECT COUNT(*) as count FROM customers');
    const orderResult = await Database.query('SELECT COUNT(*) as count, COALESCE(SUM(total_price),0) as revenue FROM orders');
    const data = {
      totalCustomers: parseInt(customerResult.rows[0].count),
      totalOrders: parseInt(orderResult.rows[0].count),
      totalRevenue: parseFloat(orderResult.rows[0].revenue)
    };
    (res as any).ok ? (res as any).ok(data) : res.json(data);
  } catch (error) {
    console.error('Get stats error:', error);
    (res as any).fail ? (res as any).fail('STATS_FETCH_FAILED', 'Failed to fetch stats', 500) : res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get orders (optionally filtered by date)
router.get('/orders', apiKeyOrAdminSession, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = `
      SELECT o.id, o.order_number, o.total_price, o.created_at,
             c.first_name, c.last_name
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
    `;
    const params: any[] = [];
    const conditions: string[] = [];
    if (startDate) {
      conditions.push('o.created_at >= $' + (params.length + 1));
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('o.created_at <= $' + (params.length + 1));
      params.push(endDate);
    }
    if (conditions.length) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY o.created_at DESC LIMIT 100';

    const result = await Database.query(query, params);
    const orders = result.rows.map(row => ({
      id: row.id,
      order_number: row.order_number,
      total_price: parseFloat(row.total_price),
      created_at: row.created_at,
      customer: {
        first_name: row.first_name,
        last_name: row.last_name
      }
    }));
    res.json(orders);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get top customers by total spend
router.get('/customers/top-spenders', apiKeyOrAdminSession, async (req, res) => {
  try {
    const limitParam = parseInt(String(req.query.limit || '10'), 10);
    const limit = isNaN(limitParam) ? 10 : Math.min(Math.max(limitParam, 1), 100);
    const result = await Database.query(
      `SELECT id, first_name || ' ' || last_name AS name, email, total_spent
       FROM customers
       ORDER BY total_spent DESC
       LIMIT $1`, [limit]
    );
    const data = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      total_spend: parseFloat(row.total_spent)
    }));
    (res as any).ok ? (res as any).ok(data, { limit }) : res.json(data);
  } catch (error) {
    console.error('Get top customers error:', error);
    (res as any).fail ? (res as any).fail('TOP_CUSTOMERS_FETCH_FAILED', 'Failed to fetch top customers', 500) : res.status(500).json({ error: 'Failed to fetch top customers' });
  }
});

// Simple metrics endpoint (counts + latest sync log timestamp)
router.get('/metrics', adminSessionAuth, async (req, res) => {
  try {
    const [tenants, customers, orders, lastSync] = await Promise.all([
      Database.query('SELECT COUNT(*)::int AS c FROM tenants'),
      Database.query('SELECT COUNT(*)::int AS c FROM customers'),
      Database.query('SELECT COUNT(*)::int AS c FROM orders'),
      Database.query(`SELECT MAX(completed_at) AS last_completed FROM sync_logs WHERE status='completed'`)
    ]);
    const data = {
      tenants: tenants.rows[0].c,
      customers: customers.rows[0].c,
      orders: orders.rows[0].c,
      last_sync_completed_at: lastSync.rows[0].last_completed
    };
    (res as any).ok ? (res as any).ok(data) : res.json(data);
  } catch (e) {
    console.error('metrics error', e);
    (res as any).fail ? (res as any).fail('METRICS_FAILED', 'Failed to fetch metrics', 500) : res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

export default router;

router.get('/auth/me', apiKeyAuth, (req, res) => {
  res.json({ tenant: req.tenant, apiKeyId: req.apiKeyId });
});

router.post('/tenants/:tenantId/api-keys', adminSessionAuth, async (req, res) => {
  const { tenantId } = req.params;
  const tenant = await Database.query('SELECT id FROM tenants WHERE id = $1', [tenantId]);
  if (tenant.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
  const label = req.body?.label || null;
  const { raw, hashed } = generateApiKey();
  const inserted = await Database.query(
    'INSERT INTO tenant_api_keys (tenant_id, hashed_key, label) VALUES ($1, $2, $3) RETURNING id, created_at, label',
    [tenantId, hashed, label]
  );
  res.status(201).json({ api_key: raw, meta: inserted.rows[0] });
});

router.get('/tenants/:tenantId/api-keys', adminSessionAuth, async (req, res) => {
  const { tenantId } = req.params;
  const rows = await Database.query(
    'SELECT id, label, created_at, last_used_at, revoked_at FROM tenant_api_keys WHERE tenant_id = $1 ORDER BY created_at DESC',
    [tenantId]
  );
  res.json(rows.rows);
});

router.post('/tenants/:tenantId/api-keys/:keyId/revoke', adminSessionAuth, async (req, res) => {
  const { tenantId, keyId } = req.params;
  await Database.query(
    'UPDATE tenant_api_keys SET revoked_at = NOW() WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL',
    [keyId, tenantId]
  );
  res.json({ success: true });
});

router.post('/tenants/:tenantId/users', adminSessionAuth, async (req, res) => {
  const { tenantId } = req.params;
  const { email, password, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const tenant = await Database.query('SELECT id FROM tenants WHERE id = $1', [tenantId]);
  if (!tenant.rows.length) return res.status(404).json({ error: 'Tenant not found' });
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(password, 12);
  try {
    const user = await Database.query(
      'INSERT INTO tenant_users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, role, created_at',
      [tenantId, email, hash, role || 'member']
    );
    res.status(201).json({ user: user.rows[0] });
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'User already exists for tenant' });
    console.error('Create tenant user error', e);
    res.status(500).json({ error: 'Failed to create tenant user' });
  }
});

router.get('/tenants/:tenantId/users', adminSessionAuth, async (req, res) => {
  const { tenantId } = req.params;
  const t = await Database.query('SELECT id FROM tenants WHERE id = $1', [tenantId]);
  if (!t.rows.length) return res.status(404).json({ error: 'Tenant not found' });
  const users = await Database.query('SELECT id, email, role, created_at FROM tenant_users WHERE tenant_id = $1 ORDER BY created_at ASC', [tenantId]);
  res.json(users.rows);
});

router.get('/tenant/me', tenantBasicAuth, async (req, res) => {
  if (!req.tenant) return res.status(401).json({ error: 'Unauthorized' });
  const { access_token, ...rest } = req.tenant as any;
  res.json({ tenant: { ...rest, has_access_token: !!access_token }, user: (req as any).tenantUser });
});

router.get('/tenant/lookup', async (req, res) => {
  try {
    const shop = String(req.query.shop || '').trim().toLowerCase();
    if (!shop) return res.status(400).json({ error: 'shop query param required' });
    const row = await Database.query('SELECT id, shop_domain, access_token FROM tenants WHERE shop_domain = $1', [shop]);
    if (!row.rows.length) return res.json({ exists: false });
    const t = row.rows[0];
    res.json({ exists: true, tenant: { id: t.id, shop_domain: t.shop_domain, has_access_token: !!t.access_token } });
  } catch (e: any) {
    console.error('Tenant lookup error', e);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

router.post('/tenant/set-token', tenantBasicAuth, async (req, res) => {
  try {
    const { access_token } = req.body || {};
    if (!access_token || typeof access_token !== 'string') {
      return res.status(400).json({ error: 'access_token is required' });
    }
    
    const tenantId = (req as any).tenant?.id;
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

    const tenant = await Database.query('SELECT shop_domain FROM tenants WHERE id = $1', [tenantId]);
    if (!tenant.rows.length) return res.status(404).json({ error: 'Tenant not found' });
    
    const shopDomain = tenant.rows[0].shop_domain;
    const testUrl = `https://${shopDomain}/admin/api/2024-01/shop.json`;
    
    try {
      const testResponse = await fetch(testUrl, {
        headers: { 'X-Shopify-Access-Token': access_token }
      });
      
      if (!testResponse.ok) {
        return res.status(400).json({ 
          error: 'Invalid access token', 
          detail: `Shopify API returned ${testResponse.status}` 
        });
      }
    } catch (fetchError) {
      return res.status(400).json({ 
        error: 'Failed to validate token against Shopify API',
        detail: 'Network error or invalid shop domain'
      });
    }

    let storedToken = access_token;
    try {
      if (process.env.TOKEN_ENCRYPTION_KEY) {
        storedToken = encryptToken(access_token);
      }
    } catch (e) {
      console.warn('[encryption] Failed to encrypt access token, storing plaintext', (e as any).message);
    }

    await Database.query(
      'UPDATE tenants SET access_token = $1, updated_at = NOW() WHERE id = $2',
      [storedToken, tenantId]
    );

    (res as any).ok ? (res as any).ok({ success: true }) : res.json({ success: true });
  } catch (e: any) {
    console.error('Set token error', e);
    (res as any).fail ? (res as any).fail('SET_TOKEN_FAILED', 'Failed to set access token', 500) : res.status(500).json({ error: 'Failed to set access token' });
  }
});
