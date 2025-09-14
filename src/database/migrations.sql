-- Tenants table for multi-tenant support
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_domain VARCHAR(255) UNIQUE NOT NULL,
    access_token TEXT,
    shopify_shop_id BIGINT,
    plan VARCHAR(50) DEFAULT 'basic',
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Customers table with tenant isolation
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shopify_customer_id BIGINT NOT NULL,
    email VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    phone VARCHAR(50),
    total_spent DECIMAL(10,2) DEFAULT 0,
    orders_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    shopify_created_at TIMESTAMP,
    shopify_updated_at TIMESTAMP,
    UNIQUE(tenant_id, shopify_customer_id)
);

-- Products table with tenant isolation
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shopify_product_id BIGINT NOT NULL,
    title VARCHAR(500),
    body_html TEXT,
    vendor VARCHAR(255),
    product_type VARCHAR(255),
    handle VARCHAR(255),
    tags TEXT,
    status VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    shopify_created_at TIMESTAMP,
    shopify_updated_at TIMESTAMP,
    shopify_published_at TIMESTAMP,
    UNIQUE(tenant_id, shopify_product_id)
);

-- Product variants table
CREATE TABLE IF NOT EXISTS product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    shopify_variant_id BIGINT NOT NULL,
    title VARCHAR(255),
    price DECIMAL(10,2),
    sku VARCHAR(255),
    inventory_quantity INTEGER DEFAULT 0,
    weight DECIMAL(8,2),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    shopify_created_at TIMESTAMP,
    shopify_updated_at TIMESTAMP,
    UNIQUE(tenant_id, shopify_variant_id)
);

-- Orders table with tenant isolation
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id),
    shopify_order_id BIGINT NOT NULL,
    order_number VARCHAR(50),
    total_price DECIMAL(10,2),
    subtotal_price DECIMAL(10,2),
    total_tax DECIMAL(10,2),
    currency VARCHAR(3),
    financial_status VARCHAR(50),
    fulfillment_status VARCHAR(50),
    shipping_address JSONB,
    billing_address JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    shopify_created_at TIMESTAMP,
    shopify_updated_at TIMESTAMP,
    UNIQUE(tenant_id, shopify_order_id)
);

-- Order line items table
CREATE TABLE IF NOT EXISTS order_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    shopify_line_item_id BIGINT NOT NULL,
    product_id UUID REFERENCES products(id),
    variant_id UUID REFERENCES product_variants(id),
    quantity INTEGER NOT NULL,
    price DECIMAL(10,2),
    title VARCHAR(500),
    variant_title VARCHAR(255),
    sku VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, shopify_line_item_id)
);

-- Custom events table for cart abandonment, checkout started, etc.
CREATE TABLE IF NOT EXISTS custom_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id),
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB,
    session_id VARCHAR(255),
    cart_token VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Sync logs table for tracking data ingestion
CREATE TABLE IF NOT EXISTS sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    sync_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    records_processed INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_customers_tenant_shopify_id ON customers(tenant_id, shopify_customer_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant_shopify_id ON products(tenant_id, shopify_product_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_shopify_id ON orders(tenant_id, shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_custom_events_tenant_type ON custom_events(tenant_id, event_type);
CREATE INDEX IF NOT EXISTS idx_custom_events_created_at ON custom_events(created_at);

-- API keys table for authenticating requests per tenant
CREATE TABLE IF NOT EXISTS tenant_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    hashed_key TEXT NOT NULL,
    label VARCHAR(100),
    last_used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    revoked_at TIMESTAMP,
    UNIQUE(tenant_id, hashed_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant ON tenant_api_keys(tenant_id);

-- Webhook receipts for idempotency (prevents duplicate processing)
CREATE TABLE IF NOT EXISTS webhook_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    topic VARCHAR(150) NOT NULL,
    external_id BIGINT,
    received_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, topic, external_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_receipts_tenant_topic ON webhook_receipts(tenant_id, topic);

-- Sync checkpoints for delta ingestion
CREATE TABLE IF NOT EXISTS sync_checkpoints (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entity VARCHAR(50) NOT NULL,
    last_updated_at TIMESTAMP,
    last_run_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (tenant_id, entity)
);

CREATE INDEX IF NOT EXISTS idx_sync_checkpoints_entity ON sync_checkpoints(entity);

-- Admin users for session-based admin authentication
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Admin sessions table storing opaque session tokens
CREATE TABLE IF NOT EXISTS admin_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    session_token TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    last_used_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_active ON admin_sessions(admin_user_id, expires_at) WHERE revoked_at IS NULL;

-- Tenant users for basic authentication (email/password per tenant)
CREATE TABLE IF NOT EXISTS tenant_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(50) DEFAULT 'member',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users(tenant_id);

-- Allow existing deployments to relax NOT NULL on access_token if previously set
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tenants' AND column_name='access_token' AND is_nullable='NO'
    ) THEN
        BEGIN
            ALTER TABLE tenants ALTER COLUMN access_token DROP NOT NULL;
        EXCEPTION WHEN others THEN
            -- ignore if already altered concurrently
            NULL;
        END;
    END IF;
END$$;
