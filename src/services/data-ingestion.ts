import { Database } from '../database/connection';
import { ShopifyAPIService } from './shopify-api';
import { ShopifyCustomer, ShopifyOrder, ShopifyProduct, TenantConfig } from '../types/shopify';

export class DataIngestionService {
  async ingestCustomers(tenantId: string, shopDomain: string, accessToken: string): Promise<{ success: boolean; processed: number }> {
    const shopify = new ShopifyAPIService(shopDomain, accessToken);
    let hasMore = true;
    let sinceId: number | undefined;
    let totalProcessed = 0;

  const checkpoint = await Database.query(`SELECT last_updated_at FROM sync_checkpoints WHERE tenant_id = $1 AND entity = 'customers'`, [tenantId]);
  const lastUpdatedAt: Date | null = checkpoint.rows[0]?.last_updated_at || null;

    const logId = await this.createSyncLog(tenantId, 'customers');

    try {
      let maxUpdatedInRun: Date | null = null;
      while (hasMore) {
  const { customers }: { customers: ShopifyCustomer[] } = await shopify.getCustomers(250, sinceId, lastUpdatedAt ?? undefined);
        
        if (customers.length === 0) {
          hasMore = false;
          break;
        }

        await Database.transaction(async (query) => {
          for (const customer of customers) {
            await query(`
              INSERT INTO customers (
                tenant_id, shopify_customer_id, email, first_name, last_name, 
                phone, total_spent, orders_count, shopify_created_at, shopify_updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              ON CONFLICT (tenant_id, shopify_customer_id) 
              DO UPDATE SET
                email = EXCLUDED.email,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                phone = EXCLUDED.phone,
                total_spent = EXCLUDED.total_spent,
                orders_count = EXCLUDED.orders_count,
                updated_at = NOW(),
                shopify_updated_at = EXCLUDED.shopify_updated_at
            `, [
              tenantId, customer.id, customer.email, customer.first_name,
              customer.last_name, customer.phone, parseFloat(customer.total_spent),
              customer.orders_count, customer.created_at, customer.updated_at
            ]);
          }
        });

        totalProcessed += customers.length;
        sinceId = customers[customers.length - 1].id;
        // Track max updated_at for checkpoint advancement
        for (const c of customers) {
          const updatedAt = new Date(c.updated_at || c.created_at);
          if (!maxUpdatedInRun || updatedAt > maxUpdatedInRun) {
            maxUpdatedInRun = updatedAt;
          }
        }
        
        if (customers.length < 250) {
          hasMore = false;
        }

        console.log(`Processed ${totalProcessed} customers for tenant ${tenantId}`);
      }

      await this.completeSyncLog(logId, 'completed', totalProcessed);
      if (totalProcessed > 0 && maxUpdatedInRun) {
        const latestUpdated = maxUpdatedInRun;
        await Database.query(`
          INSERT INTO sync_checkpoints (tenant_id, entity, last_updated_at, last_run_at)
          VALUES ($1, 'customers', $2, NOW())
          ON CONFLICT (tenant_id, entity)
          DO UPDATE SET last_updated_at = GREATEST(sync_checkpoints.last_updated_at, EXCLUDED.last_updated_at), last_run_at = NOW()
        `, [tenantId, latestUpdated]);
      }
      return { success: true, processed: totalProcessed };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      await this.completeSyncLog(logId, 'failed', totalProcessed, errorMessage);
      throw error;
    }
  }

  async ingestProducts(tenantId: string, shopDomain: string, accessToken: string): Promise<{ success: boolean; processed: number }> {
    const shopify = new ShopifyAPIService(shopDomain, accessToken);
    let hasMore = true;
    let sinceId: number | undefined;
    let totalProcessed = 0;

    const logId = await this.createSyncLog(tenantId, 'products');
    const checkpoint = await Database.query(`SELECT last_updated_at FROM sync_checkpoints WHERE tenant_id = $1 AND entity = 'products'`, [tenantId]);
    const lastUpdatedAt: Date | null = checkpoint.rows[0]?.last_updated_at || null;

    try {
      let maxUpdatedInRun: Date | null = null;
      while (hasMore) {
  const { products }: { products: ShopifyProduct[] } = await shopify.getProducts(250, sinceId, lastUpdatedAt ?? undefined);
        
        if (products.length === 0) {
          hasMore = false;
          break;
        }

        await Database.transaction(async (query) => {
          for (const product of products) {
            // Insert product
            const productResult = await query(`
              INSERT INTO products (
                tenant_id, shopify_product_id, title, body_html, vendor, 
                product_type, handle, tags, status, shopify_created_at, 
                shopify_updated_at, shopify_published_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              ON CONFLICT (tenant_id, shopify_product_id) 
              DO UPDATE SET
                title = EXCLUDED.title,
                body_html = EXCLUDED.body_html,
                vendor = EXCLUDED.vendor,
                product_type = EXCLUDED.product_type,
                handle = EXCLUDED.handle,
                tags = EXCLUDED.tags,
                status = EXCLUDED.status,
                updated_at = NOW(),
                shopify_updated_at = EXCLUDED.shopify_updated_at,
                shopify_published_at = EXCLUDED.shopify_published_at
              RETURNING id
            `, [
              tenantId, product.id, product.title, product.body_html,
              product.vendor, product.product_type, product.handle,
              product.tags, product.status, product.created_at,
              product.updated_at, product.published_at
            ]);

            const productId = productResult.rows[0].id;

            // Insert variants
            for (const variant of product.variants) {
              await query(`
                INSERT INTO product_variants (
                  tenant_id, product_id, shopify_variant_id, title, price, 
                  sku, inventory_quantity, weight, shopify_created_at, shopify_updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (tenant_id, shopify_variant_id)
                DO UPDATE SET
                  product_id = EXCLUDED.product_id,
                  title = EXCLUDED.title,
                  price = EXCLUDED.price,
                  sku = EXCLUDED.sku,
                  inventory_quantity = EXCLUDED.inventory_quantity,
                  weight = EXCLUDED.weight,
                  updated_at = NOW(),
                  shopify_updated_at = EXCLUDED.shopify_updated_at
              `, [
                tenantId, productId, variant.id, variant.title,
                parseFloat(variant.price), variant.sku, variant.inventory_quantity,
                variant.weight, variant.created_at, variant.updated_at
              ]);
            }
          }
        });

        totalProcessed += products.length;
        sinceId = products[products.length - 1].id;
        for (const p of products) {
          const updatedAt = new Date(p.updated_at || p.created_at);
          if (!maxUpdatedInRun || updatedAt > maxUpdatedInRun) {
            maxUpdatedInRun = updatedAt;
          }
        }
        
        if (products.length < 250) {
          hasMore = false;
        }

        console.log(`Processed ${totalProcessed} products for tenant ${tenantId}`);
      }

      await this.completeSyncLog(logId, 'completed', totalProcessed);
      if (totalProcessed > 0 && maxUpdatedInRun) {
        const latestUpdated = maxUpdatedInRun;
        await Database.query(`
          INSERT INTO sync_checkpoints (tenant_id, entity, last_updated_at, last_run_at)
          VALUES ($1, 'products', $2, NOW())
          ON CONFLICT (tenant_id, entity)
          DO UPDATE SET last_updated_at = GREATEST(sync_checkpoints.last_updated_at, EXCLUDED.last_updated_at), last_run_at = NOW()
        `, [tenantId, latestUpdated]);
      }
      return { success: true, processed: totalProcessed };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      await this.completeSyncLog(logId, 'failed', totalProcessed, errorMessage);
      throw error;
    }
  }

  async ingestOrders(tenantId: string, shopDomain: string, accessToken: string): Promise<{ success: boolean; processed: number }> {
    const shopify = new ShopifyAPIService(shopDomain, accessToken);
    let hasMore = true;
    let sinceId: number | undefined;
    let totalProcessed = 0;

    const logId = await this.createSyncLog(tenantId, 'orders');
    const checkpoint = await Database.query(`SELECT last_updated_at FROM sync_checkpoints WHERE tenant_id = $1 AND entity = 'orders'`, [tenantId]);
    const lastUpdatedAt: Date | null = checkpoint.rows[0]?.last_updated_at || null;

    try {
      let maxUpdatedInRun: Date | null = null;
      while (hasMore) {
  const { orders }: { orders: ShopifyOrder[] } = await shopify.getOrders(250, sinceId, lastUpdatedAt ?? undefined);
        
        if (orders.length === 0) {
          hasMore = false;
          break;
        }

        await Database.transaction(async (query) => {
          for (const order of orders) {
            // Get customer ID if exists
            let customerId = null;
            if (order.customer) {
              const customerResult = await query(`
                SELECT id FROM customers 
                WHERE tenant_id = $1 AND shopify_customer_id = $2
              `, [tenantId, order.customer.id]);
              
              if (customerResult.rows.length > 0) {
                customerId = customerResult.rows[0].id;
              }
            }

            // Insert order
            const orderResult = await query(`
              INSERT INTO orders (
                tenant_id, customer_id, shopify_order_id, order_number, 
                total_price, subtotal_price, total_tax, currency, 
                financial_status, fulfillment_status, shipping_address, 
                billing_address, shopify_created_at, shopify_updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
              ON CONFLICT (tenant_id, shopify_order_id)
              DO UPDATE SET
                customer_id = EXCLUDED.customer_id,
                order_number = EXCLUDED.order_number,
                total_price = EXCLUDED.total_price,
                subtotal_price = EXCLUDED.subtotal_price,
                total_tax = EXCLUDED.total_tax,
                financial_status = EXCLUDED.financial_status,
                fulfillment_status = EXCLUDED.fulfillment_status,
                updated_at = NOW(),
                shopify_updated_at = EXCLUDED.shopify_updated_at
              RETURNING id
            `, [
              tenantId, customerId, order.id, order.order_number,
              parseFloat(order.total_price), parseFloat(order.subtotal_price),
              parseFloat(order.total_tax), order.currency, order.financial_status,
              order.fulfillment_status, JSON.stringify(order.shipping_address),
              JSON.stringify(order.billing_address), order.created_at, order.updated_at
            ]);

            const orderId = orderResult.rows[0].id;

            // Insert line items
            for (const lineItem of order.line_items) {
              await query(`
                INSERT INTO order_line_items (
                  tenant_id, order_id, shopify_line_item_id, quantity, 
                  price, title, variant_title, sku
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (tenant_id, shopify_line_item_id)
                DO UPDATE SET
                  order_id = EXCLUDED.order_id,
                  quantity = EXCLUDED.quantity,
                  price = EXCLUDED.price,
                  title = EXCLUDED.title,
                  variant_title = EXCLUDED.variant_title,
                  sku = EXCLUDED.sku
              `, [
                tenantId, orderId, lineItem.id, lineItem.quantity,
                parseFloat(lineItem.price), lineItem.title,
                lineItem.variant_title, lineItem.sku
              ]);
            }
          }
        });

        totalProcessed += orders.length;
        sinceId = orders[orders.length - 1].id;
        for (const o of orders) {
          const updatedAt = new Date(o.updated_at || o.created_at);
          if (!maxUpdatedInRun || updatedAt > maxUpdatedInRun) {
            maxUpdatedInRun = updatedAt;
          }
        }
        
        if (orders.length < 250) {
          hasMore = false;
        }

        console.log(`Processed ${totalProcessed} orders for tenant ${tenantId}`);
      }

      await this.completeSyncLog(logId, 'completed', totalProcessed);
      if (totalProcessed > 0 && maxUpdatedInRun) {
        const latestUpdated = maxUpdatedInRun;
        await Database.query(`
          INSERT INTO sync_checkpoints (tenant_id, entity, last_updated_at, last_run_at)
          VALUES ($1, 'orders', $2, NOW())
          ON CONFLICT (tenant_id, entity)
          DO UPDATE SET last_updated_at = GREATEST(sync_checkpoints.last_updated_at, EXCLUDED.last_updated_at), last_run_at = NOW()
        `, [tenantId, latestUpdated]);
      }
      return { success: true, processed: totalProcessed };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      await this.completeSyncLog(logId, 'failed', totalProcessed, errorMessage);
      throw error;
    }
  }

  private async createSyncLog(tenantId: string, syncType: string): Promise<string> {
    const result = await Database.query(`
      INSERT INTO sync_logs (tenant_id, sync_type, status)
      VALUES ($1, $2, 'running')
      RETURNING id
    `, [tenantId, syncType]);
    
    return result.rows[0].id;
  }

  private async completeSyncLog(logId: string, status: string, recordsProcessed: number, errorMessage?: string): Promise<void> {
    await Database.query(`
      UPDATE sync_logs 
      SET status = $1, records_processed = $2, error_message = $3, completed_at = NOW()
      WHERE id = $4
    `, [status, recordsProcessed, errorMessage, logId]);
  }

  async ingestAll(config: TenantConfig, entities: Array<'customers' | 'products' | 'orders'> = ['customers','products','orders']) {
    const results: Record<string, any> = {};
    if (entities.includes('customers')) {
      results.customers = await this.ingestCustomers(config.id, config.shop_domain, config.access_token);
    }
    if (entities.includes('products')) {
      results.products = await this.ingestProducts(config.id, config.shop_domain, config.access_token);
    }
    if (entities.includes('orders')) {
      results.orders = await this.ingestOrders(config.id, config.shop_domain, config.access_token);
    }
    return results;
  }
}