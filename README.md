# Xeno Backend - Multi-Tenant Shopify Analytics Platform

A robust, production-ready backend service that provides multi-tenant Shopify data ingestion, analytics, and dashboard APIs. Built with Node.js, TypeScript, PostgreSQL, and Docker.

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Shopify API   │    │   Admin Panel   │    │  Tenant Users   │
│                 │    │                 │    │                 │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          │ OAuth/Webhooks       │ Session Auth         │ Basic Auth
          │                      │                      │
          v                      v                      v
    ┌─────────────────────────────────────────────────────────────┐
    │                    Xeno Backend API                         │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
    │  │    Auth     │  │ Data Sync   │  │     Analytics       │ │
    │  │ Middleware  │  │  Service    │  │      Engine         │ │
    │  └─────────────┘  └─────────────┘  └─────────────────────┘ │
    └─────────────────────┬───────────────────────────────────────┘
                          │
                          v
              ┌─────────────────────┐
              │    PostgreSQL       │
              │  (Multi-tenant DB)  │
              │                     │
              │ • tenants           │
              │ • customers         │
              │ • orders            │
              │ • products          │
              │ • custom_events     │
              │ • webhook_receipts  │
              │ • sync_checkpoints  │
              │ • admin_users       │
              │ • admin_sessions    │
              │ • tenant_users      │
              └─────────────────────┘
```

## 🚀 Features

### Core Features
- **Multi-tenant Architecture**: Row-level data isolation for multiple Shopify stores
- **Dual Authentication**: Session-based admin auth + Basic auth for tenants
- **Real-time Data Sync**: Automated Shopify data ingestion with scheduling
- **OAuth Integration**: Seamless Shopify app installation and authorization
- **Manual Token Support**: Alternative token input for direct integration
- **Comprehensive Analytics**: Revenue, growth, and performance metrics
- **Webhook Handling**: Real-time updates via Shopify webhooks
- **Data Encryption**: Secure storage of access tokens using AES-256-GCM

### Advanced Features
- **Idempotency**: Prevents duplicate data ingestion
- **Sync Checkpoints**: Incremental data updates and resume capability
- **Error Handling**: Comprehensive error tracking and response envelopes
- **Request Logging**: Detailed request/response logging with Pino
- **API Rate Limiting**: Respects Shopify API limits
- **Health Monitoring**: Built-in health checks and status endpoints

## 📋 Prerequisites

- **Node.js** 18+ 
- **PostgreSQL** 13+
- **Docker** (optional, for containerized deployment)
- **Shopify Partner Account** (for OAuth setup)

## ⚙️ Setup Instructions

### 1. Environment Configuration

Create `.env` file from the example:

```bash
cp .env.example .env
```

Configure the following environment variables:

```bash
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/xeno_db
AUTO_MIGRATE=true

# Server
PORT=3000
API_PEPPER=your-secret-pepper-for-api-keys

# Shopify OAuth (Required for OAuth flow)
SHOPIFY_CLIENT_ID=your-shopify-app-client-id
SHOPIFY_CLIENT_SECRET=your-shopify-app-client-secret
SHOPIFY_REDIRECT_URI=http://localhost:3000/api/shopify/callback
SHOPIFY_SCOPES=read_products,read_orders,read_customers,read_analytics

# Security
TOKEN_ENCRYPTION_KEY=your-32-character-encryption-key
```

### 2. Database Setup

Create PostgreSQL database:

```sql
CREATE DATABASE xeno_db;
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run Database Migrations

```bash
# Automatic migration (if AUTO_MIGRATE=true)
npm run dev

# Manual migration
npm run migrate
```

### 5. Start the Service

```bash
# Development with hot reload
npm run dev

# Production build and start
npm run build
npm start
```

### 6. Docker Deployment (Optional)

```bash
# Build and run with Docker Compose
docker-compose up --build

# Production deployment
docker-compose -f docker-compose.prod.yml up --build
```

## 📚 API Documentation

### Authentication

The API supports three authentication methods:

1. **Admin Session Auth**: Cookie-based authentication for admin users
2. **Tenant Basic Auth**: HTTP Basic authentication for tenant users  
3. **API Key Auth**: Header-based authentication using `X-API-Key`

### Core Endpoints

#### Admin Management
```http
POST   /api/admin/bootstrap     # Create first admin user
POST   /api/admin/login         # Admin login (creates session)
POST   /api/admin/logout        # Admin logout
GET    /api/admin/me            # Get current admin user
```

#### Tenant Management
```http
POST   /api/tenants             # Create new tenant (admin only)
GET    /api/tenants             # List all tenants (admin only)
GET    /api/tenants/:id         # Get tenant details (admin only)
POST   /api/tenants/:id/users   # Create tenant user (admin only)
```

#### Tenant Operations
```http
POST   /api/tenant/login        # Tenant user login
GET    /api/tenant/me           # Get current tenant info
POST   /api/tenant/set-token    # Set Shopify access token manually
GET    /api/tenant/lookup       # Lookup tenant by shop domain
```

#### Shopify Integration
```http
GET    /api/shopify/install     # Start OAuth installation
GET    /api/shopify/callback    # OAuth callback handler
POST   /api/tenants/:id/ingest  # Trigger data ingestion
GET    /api/tenants/:id/sync-status # Get sync status
```

#### Analytics & Metrics
```http
GET    /api/tenants/:id/analytics           # Overall analytics
GET    /api/tenants/:id/metrics/revenue     # Revenue over time
GET    /api/tenants/:id/metrics/orders      # Orders by date
GET    /api/tenants/:id/metrics/customers   # Top customers
GET    /api/tenants/:id/metrics/events      # Events summary
GET    /api/tenants/:id/metrics/customer-growth  # Customer growth
GET    /api/tenants/:id/metrics/product-growth   # Product growth
```

#### Webhooks
```http
POST   /api/webhooks/customers/update    # Customer update webhook
POST   /api/webhooks/orders/create       # Order creation webhook
POST   /api/webhooks/orders/updated      # Order update webhook
```

#### Utility
```http
GET    /api/health             # Health check
GET    /api/debug/oauth-config # OAuth configuration (debug)
```

## 🗄️ Database Schema

### Core Tables

#### `tenants`
Stores Shopify store configurations and access tokens.

```sql
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_domain VARCHAR(255) UNIQUE NOT NULL,
    access_token TEXT,  -- Encrypted with AES-256-GCM
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### `customers`
Multi-tenant customer data from Shopify.

```sql
CREATE TABLE customers (
    id BIGINT NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    email VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    orders_count INTEGER DEFAULT 0,
    total_spent DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    PRIMARY KEY (tenant_id, id)
);
```

#### `orders`
Multi-tenant order data with line items.

```sql
CREATE TABLE orders (
    id BIGINT NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    customer_id BIGINT,
    total_price DECIMAL(10,2),
    subtotal_price DECIMAL(10,2),
    total_tax DECIMAL(10,2),
    currency VARCHAR(3),
    financial_status VARCHAR(50),
    fulfillment_status VARCHAR(50),
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    PRIMARY KEY (tenant_id, id)
);
```

#### `products`
Multi-tenant product catalog.

```sql
CREATE TABLE products (
    id BIGINT NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    title VARCHAR(500),
    handle VARCHAR(255),
    product_type VARCHAR(255),
    vendor VARCHAR(255),
    status VARCHAR(50),
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    PRIMARY KEY (tenant_id, id)
);
```

### Authentication Tables

#### `admin_users`
System administrators with full access.

```sql
CREATE TABLE admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### `tenant_users`
Tenant-specific users with basic authentication.

```sql
CREATE TABLE tenant_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    username VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, username)
);
```

### Operational Tables

#### `webhook_receipts`
Tracks incoming webhook deliveries for idempotency.

```sql
CREATE TABLE webhook_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    webhook_id VARCHAR(255),
    topic VARCHAR(100),
    shop_domain VARCHAR(255),
    received_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, webhook_id, topic)
);
```

#### `sync_checkpoints`
Manages incremental data synchronization.

```sql
CREATE TABLE sync_checkpoints (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    data_type VARCHAR(50) NOT NULL,
    last_sync_at TIMESTAMP NOT NULL,
    last_id BIGINT,
    status VARCHAR(20) DEFAULT 'completed',
    PRIMARY KEY (tenant_id, data_type)
);
```

## 🔒 Security Features

### Token Encryption
- Access tokens are encrypted using **AES-256-GCM** before database storage
- Encryption key must be provided via `TOKEN_ENCRYPTION_KEY` environment variable
- Automatic fallback to plaintext storage if encryption fails (with warning)

### Authentication Security
- **Password Hashing**: bcryptjs with salt rounds for secure password storage
- **Session Management**: HTTP-only cookies with expiration handling
- **API Key Authentication**: Peppered API keys for additional security
- **Input Validation**: Comprehensive request validation and sanitization

### Multi-tenant Isolation
- **Row-level Security**: All queries include tenant_id filtering
- **Access Control**: Users can only access their tenant's data
- **Admin Segregation**: Admin users have separate authentication flow

## 📊 Monitoring & Logging

### Request Logging
- **Pino Logger**: Structured JSON logging for all requests and responses
- **Error Tracking**: Detailed error logs with stack traces
- **Performance Metrics**: Request duration and response time tracking

### Health Monitoring
- **Health Endpoint**: `/api/health` provides service status
- **Database Connectivity**: Automatic database health checks
- **Sync Status**: Monitor data ingestion health via `/api/tenants/:id/sync-status`

### Debug Features
- **OAuth Debug**: `/api/debug/oauth-config` for troubleshooting OAuth setup
- **Environment Validation**: Startup checks for required environment variables
- **Migration Status**: Automatic database migration with status reporting

## 🚀 Production Deployment

### Docker Deployment
The service includes production-ready Docker configuration:

```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/xeno_db
      - NODE_ENV=production
    depends_on:
      - db
  
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: xeno_db
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### Environment Configuration
Ensure these production settings:

```bash
NODE_ENV=production
AUTO_MIGRATE=true
DATABASE_URL=postgresql://user:pass@host:port/db
TOKEN_ENCRYPTION_KEY=32-character-secret-key
SHOPIFY_CLIENT_ID=production-client-id
SHOPIFY_CLIENT_SECRET=production-client-secret
SHOPIFY_REDIRECT_URI=https://yourdomain.com/api/shopify/callback
```

### Performance Considerations
- **Database Indexing**: Ensure proper indexes on tenant_id and foreign keys
- **Connection Pooling**: Configure PostgreSQL connection pool size
- **Rate Limiting**: Implement rate limiting for public endpoints
- **Caching**: Consider Redis for session storage and caching

## ⚠️ Known Limitations

### Current Limitations
1. **Single Database**: No database sharding support for extreme scale
2. **Memory Sessions**: Session storage in memory (not suitable for multi-instance)
3. **Manual Webhook Setup**: Webhooks must be configured manually in Shopify
4. **Limited Error Recovery**: Basic retry logic for failed API calls
5. **No User Management UI**: Admin user creation requires direct API calls

### Assumptions Made
1. **Shopify API Stability**: Assumes consistent Shopify API structure
2. **Tenant Isolation**: Relies on application-level tenant isolation
3. **Token Security**: Assumes secure network transport for token transmission
4. **Data Consistency**: Eventual consistency acceptable for analytics data
5. **Small to Medium Scale**: Designed for hundreds of tenants, not thousands

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Built with ❤️ using Node.js, TypeScript, PostgreSQL, and Docker**
