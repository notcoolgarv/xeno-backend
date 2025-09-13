# Shopify Data Ingestion Service

A multi-tenant data ingestion service that connects to Shopify APIs and stores customer, order, product, and custom event data in a PostgreSQL database.

## Features

- **Multi-tenant Architecture**: Isolated data storage for multiple Shopify stores
- **Real-time Webhooks**: Automatic data updates via Shopify webhooks
- **Comprehensive Data Ingestion**: Customers, Orders, Products, and Custom Events
- **Custom Events Tracking**: Cart abandonment, checkout started events
- **Sync Logging**: Track ingestion status and performance
- **RESTful API**: Manage tenants and trigger data ingestion

## Setup

### 1. Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

### 2. Database Setup

Ensure PostgreSQL is running and create the database:

```sql
CREATE DATABASE shopify_ingestion;
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run Migrations

```bash
npm run migrate
```

### 5. Start the Service

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## API Endpoints

### Tenant Management

- `POST /api/tenants` - Create a new tenant
- `GET /api/tenants` - List all tenants
- `GET /api/tenants/:id/analytics` - Get tenant analytics

### Data Ingestion

- `POST /api/tenants/:id/ingest` - Trigger data ingestion
- `GET /api/tenants/:id/logs` - Get ingestion logs

### Webhooks

- `POST /webhooks/customers/update` - Customer update webhook
- `POST /webhooks/carts/abandoned` - Cart abandonment webhook
- `POST /webhooks/checkouts/create` - Checkout started webhook

## Usage Examples

### Create a Tenant

```bash
curl -X POST http://localhost:3000/api/tenants \
  -H "Content-Type: application/json" \
  -d '{
    "shop_domain": "your-store.myshopify.com",
    "access_token": "your-access-token"
  }'
```

### Trigger Data Ingestion

```bash
curl -X POST http://localhost:3000/api/tenants/TENANT_ID/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "data_types": ["customers", "products", "orders"]
  }'
```

## Database Schema

The service uses a multi-tenant database schema with the following main tables:

- `tenants` - Store configuration for each Shopify store
- `customers` - Customer data with tenant isolation
- `products` - Product and variant data
- `orders` - Order and line item data
- `custom_events` - Custom events like cart abandonment
- `sync_logs` - Ingestion tracking and monitoring

## Shopify Setup

1. Create a Shopify App in your Partner Dashboard
2. Configure the required scopes: `read_products`, `read_orders`, `read_customers`, `read_analytics`
3. Set up webhooks for real-time updates:
   - Customer update: `/webhooks/customers/update`
   - Cart abandonment: `/webhooks/carts/abandoned`
   - Checkout create: `/webhooks/checkouts/create`

## Monitoring

- Check service health: `GET /health`
- View ingestion logs: `GET /api/tenants/:id/logs`
- Monitor analytics: `GET /api/tenants/:id/analytics`
