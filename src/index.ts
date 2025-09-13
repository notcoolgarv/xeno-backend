import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import apiRoutes from './routes/api';
import { WebhookHandler } from './services/webhook-handler';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const webhookHandler = new WebhookHandler(process.env.WEBHOOK_SECRET || 'default-secret');

// Middleware
app.use(cors());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// Use JSON parser for all non-webhook routes
app.use(express.json());

// Use raw body parser for webhook routes, and also make JSON body available
app.use('/webhooks', bodyParser.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));

// Routes
app.use('/api', apiRoutes);

// Webhook endpoints
app.post('/webhooks/customers/update', webhookHandler.handleCustomerUpdate.bind(webhookHandler));
app.post('/webhooks/carts/abandoned', webhookHandler.handleCartAbandoned.bind(webhookHandler));
app.post('/webhooks/checkouts/create', webhookHandler.handleCheckoutStarted.bind(webhookHandler));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Shopify Data Ingestion Service running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`API base URL: http://localhost:${port}/api`);
});
