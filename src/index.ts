import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import apiRoutes from './routes/api';
import { adminAuthRouter } from './middleware/admin-session';
import { WebhookHandler } from './services/webhook-handler';
import { config } from './config';
import { Database } from './database/connection';
import { DataIngestionService } from './services/data-ingestion';
import { responseWrapper, errorHandler } from './middleware/response';
import { decryptToken } from './services/encryption';
import { runMigrations } from './database/migrate';

dotenv.config();

const app = express();
const port = config.port;
const webhookHandler = new WebhookHandler(config.webhookSecret);

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
app.use(cookieParser());

app.use((req, _res, next) => {
  (req as any).reqId = randomUUID();
  next();
});
app.use(pinoHttp({
  // @ts-ignore - pino-pretty target optional types
  transport: config.nodeEnv === 'development' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  genReqId: (req: any) => req.reqId,
  customLogLevel: function (res: any, err: any) {
    if (err) return 'error';
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  }
}));

app.use(express.json());
app.use(responseWrapper);

app.use('/webhooks', bodyParser.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));

// Routes
app.use('/api/admin', adminAuthRouter);
app.use('/api', apiRoutes);

// Webhook endpoints
app.post('/webhooks/customers/update', (req, res) => webhookHandler.handleCustomerUpdate(req as any, res));
app.post('/webhooks/carts/abandoned', (req, res) => webhookHandler.handleCartAbandoned(req as any, res));
app.post('/webhooks/checkouts/create', (req, res) => webhookHandler.handleCheckoutStarted(req as any, res));

// Health check
app.get('/health', (req, res) => {
  (res as any).ok ? (res as any).ok({ status: 'healthy', timestamp: new Date().toISOString() }) : res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

async function start() {
  if (process.env.AUTO_MIGRATE === 'true') {
    try {
      await runMigrations();
    } catch (e) {
      console.error('Auto-migrations failed, exiting.', e);
      process.exit(1);
    }
  }
  // Debug logging for Shopify OAuth configuration (non-secret parts)
  if (config.shopify.apiKey || config.shopify.redirectUri) {
    try {
      const ru = config.shopify.redirectUri;
      const host = ru ? new URL(ru).host : '(none)';
      let appUrlInfo = '';
      if (config.shopify.appUrl) {
        try {
          const au = new URL(config.shopify.appUrl);
          appUrlInfo = ` appUrl=${config.shopify.appUrl} appHost=${au.host}`;
          if (ru && au.host !== host) {
            console.warn(`[startup] WARNING: SHOPIFY_APP_URL host (${au.host}) does not match redirectUri host (${host}). This will trigger Shopify invalid_request.`);
          }
        } catch {
          console.warn('[startup] Invalid SHOPIFY_APP_URL value; not a valid URL');
        }
      }
      console.log(`[startup] Shopify OAuth config: apiKey=${config.shopify.apiKey ? 'set' : 'missing'} redirectUri=${ru || 'missing'} redirectHost=${host}${appUrlInfo}`);
    } catch (e) {
      console.warn('[startup] Invalid SHOPIFY_REDIRECT_URI value; not a valid URL', config.shopify.redirectUri);
    }
  }
  app.listen(port, () => {
    console.log(`Shopify Data Ingestion Service running on port ${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
    console.log(`API base URL: http://localhost:${port}/api`);
  });
}

start();

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const ingestionService = new DataIngestionService();
async function runScheduledIngestion() {
  try {
    console.log('[scheduler] Starting scheduled ingestion run');
    const tenants = await Database.query('SELECT id, shop_domain, access_token FROM tenants WHERE status = $1', ['active']);
    for (const t of tenants.rows) {
      if (!t.access_token) {
        console.log(`[scheduler] Skipping tenant ${t.id} (${t.shop_domain}) - no access token yet`);
        continue;
      }
      let token = t.access_token;
      if (process.env.TOKEN_ENCRYPTION_KEY) {
        try { token = decryptToken(token); } catch (e) { console.warn('[scheduler] decrypt failed, skipping tenant', t.id, (e as any).message); continue; }
      }
      console.log(`[scheduler] Ingesting tenant ${t.id}`);
      try {
        await ingestionService.ingestCustomers(t.id, t.shop_domain, token);
        await ingestionService.ingestProducts(t.id, t.shop_domain, token);
        await ingestionService.ingestOrders(t.id, t.shop_domain, token);
      } catch (e) {
        console.error(`[scheduler] Error ingesting tenant ${t.id}`, e);
      }
    }
    console.log('[scheduler] Completed scheduled ingestion run');
  } catch (err) {
    console.error('[scheduler] Fatal scheduler error', err);
  }
}

setTimeout(runScheduledIngestion, 30_000);
setInterval(runScheduledIngestion, SIX_HOURS_MS);

app.use(errorHandler);
