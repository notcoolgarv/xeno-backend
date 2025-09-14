type Config = {
  nodeEnv: string;
  port: number;
  db: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };
  shopify: {
    apiKey?: string;
    apiSecret?: string;
    apiVersion?: string;
    scopes?: string;
    redirectUri?: string;
    appUrl?: string;
  };
  webhookSecret: string;
  logLevel: string;
  security: {
    apiKeyPepper?: string;
  };
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
  };
};

function required(name: string, value: any): string {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value);
      appUrl: process.env.SHOPIFY_APP_URL
}

function optionalNumber(name: string, value: any, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be a number`);
  return n;
}

function loadConfig(): Config {
  const cfg: Config = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: optionalNumber('PORT', process.env.PORT, 3000),
    db: {
      host: required('DB_HOST', process.env.DB_HOST),
      port: optionalNumber('DB_PORT', process.env.DB_PORT, 5432),
      name: required('DB_NAME', process.env.DB_NAME),
      user: required('DB_USER', process.env.DB_USER),
      password: required('DB_PASSWORD', process.env.DB_PASSWORD)
    },
    shopify: {
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecret: process.env.SHOPIFY_API_SECRET,
      apiVersion: process.env.SHOPIFY_API_VERSION || '2024-01',
      scopes: process.env.SHOPIFY_SCOPES || 'read_products,read_orders,read_customers',
      redirectUri: (() => {
        const urlVar = process.env.SHOPIFY_REDIRECT_URL;
        const uriVar = process.env.SHOPIFY_REDIRECT_URI;
        if (urlVar && uriVar && urlVar !== uriVar) {
          console.warn('[config] Both SHOPIFY_REDIRECT_URL and SHOPIFY_REDIRECT_URI set; using SHOPIFY_REDIRECT_URI');
        }
        return uriVar || urlVar;
      })()
    },
    webhookSecret: process.env.WEBHOOK_SECRET || 'default-secret',
    logLevel: process.env.LOG_LEVEL || 'info',
    security: {
      apiKeyPepper: process.env.API_KEY_PEPPER
    },
    retry: {
      maxAttempts: optionalNumber('MAX_RETRY_ATTEMPTS', process.env.MAX_RETRY_ATTEMPTS, 3),
      baseDelayMs: optionalNumber('RETRY_BASE_DELAY_MS', process.env.RETRY_BASE_DELAY_MS, 500)
    }
  };
  return cfg;
}

export const config = loadConfig();

// Helper for exponential backoff calculation
export function computeDelay(attempt: number, base: number): number {
  return Math.round(base * Math.pow(2, attempt - 1));
}
