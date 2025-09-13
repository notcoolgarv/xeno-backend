-- Tenants table for multi-tenant support
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_domain VARCHAR(255) UNIQUE NOT NULL,
    access_token TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_custom_events_tenant_type ON custom_events(tenant_id, event_type);
CREATE INDEX IF NOT EXISTS idx_custom_events_created_at ON custom_events(created_at);
