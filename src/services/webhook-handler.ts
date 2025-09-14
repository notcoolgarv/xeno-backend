import { Request, Response } from 'express';
import crypto from 'crypto';
import { Database } from '../database/connection';

interface RequestWithRawBody extends Request {
  rawBody: Buffer;
}

export class WebhookHandler {
  private webhookSecret: string;

  constructor(webhookSecret: string) {
    this.webhookSecret = webhookSecret;
  }

  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    hmac.update(rawBody);
    const hash = hmac.digest('base64');
    return hash === signature;
  }

  async handleCustomerUpdate(req: RequestWithRawBody, res: Response) {
    try {
      const shopDomain = req.get('X-Shopify-Shop-Domain');
      const signature = req.get('X-Shopify-Hmac-Sha256');
      
      if (!this.verifyWebhook(req.rawBody, signature!)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const tenant = await this.getTenantByDomain(shopDomain!);
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      const customer = req.body;

      try {
        await Database.query(`
          INSERT INTO webhook_receipts (tenant_id, topic, external_id)
          VALUES ($1, $2, $3)
        `, [tenant.id, 'customers/update', customer.id]);
      } catch (e: any) {
        if (e.code === '23505') { // unique violation
          return res.status(200).json({ success: true, duplicate: true });
        }
        throw e;
      }
      
      await Database.query(`
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
        tenant.id, customer.id, customer.email, customer.first_name,
        customer.last_name, customer.phone, parseFloat(customer.total_spent || '0'),
        customer.orders_count, customer.created_at, customer.updated_at
      ]);

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Customer webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async handleCartAbandoned(req: RequestWithRawBody, res: Response) {
    try {
      const shopDomain = req.get('X-Shopify-Shop-Domain');
      const signature = req.get('X-Shopify-Hmac-Sha256');
      
      if (!this.verifyWebhook(req.rawBody, signature!)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const tenant = await this.getTenantByDomain(shopDomain!);
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      const cartData = req.body;

      try {
        await Database.query(`
          INSERT INTO webhook_receipts (tenant_id, topic, external_id)
          VALUES ($1, $2, $3)
        `, [tenant.id, 'carts/abandoned', cartData?.token ? parseInt(Buffer.from(cartData.token).toString('hex').slice(0,12), 16) : null]);
      } catch (e: any) {
        if (e.code === '23505') {
          return res.status(200).json({ success: true, duplicate: true });
        }
        throw e;
      }
      
      // Get customer ID if exists
      let customerId = null;
      if (cartData.customer) {
        const customerResult = await Database.query(`
          SELECT id FROM customers 
          WHERE tenant_id = $1 AND shopify_customer_id = $2
        `, [tenant.id, cartData.customer.id]);
        
        if (customerResult.rows.length > 0) {
          customerId = customerResult.rows[0].id;
        }
      }

      await Database.query(`
        INSERT INTO custom_events (
          tenant_id, customer_id, event_type, event_data, cart_token
        ) VALUES ($1, $2, $3, $4, $5)
      `, [
        tenant.id, customerId, 'cart_abandoned', 
        JSON.stringify(cartData), cartData.token
      ]);

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Cart abandoned webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async handleCheckoutStarted(req: RequestWithRawBody, res: Response) {
    try {
      const shopDomain = req.get('X-Shopify-Shop-Domain');
      const signature = req.get('X-Shopify-Hmac-Sha256');
      
      if (!this.verifyWebhook(req.rawBody, signature!)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const tenant = await this.getTenantByDomain(shopDomain!);
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      const checkoutData = req.body;

      try {
        await Database.query(`
          INSERT INTO webhook_receipts (tenant_id, topic, external_id)
          VALUES ($1, $2, $3)
        `, [tenant.id, 'checkouts/create', checkoutData?.id]);
      } catch (e: any) {
        if (e.code === '23505') {
          return res.status(200).json({ success: true, duplicate: true });
        }
        throw e;
      }
      
      let customerId = null;
      if (checkoutData.customer) {
        const customerResult = await Database.query(`
          SELECT id FROM customers 
          WHERE tenant_id = $1 AND shopify_customer_id = $2
        `, [tenant.id, checkoutData.customer.id]);
        
        if (customerResult.rows.length > 0) {
          customerId = customerResult.rows[0].id;
        }
      }

      await Database.query(`
        INSERT INTO custom_events (
          tenant_id, customer_id, event_type, event_data, cart_token
        ) VALUES ($1, $2, $3, $4, $5)
      `, [
        tenant.id, customerId, 'checkout_started', 
        JSON.stringify(checkoutData), checkoutData.cart_token
      ]);

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Checkout started webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async getTenantByDomain(shopDomain: string) {
    const result = await Database.query(`
      SELECT * FROM tenants WHERE shop_domain = $1
    `, [shopDomain]);
    
    return result.rows[0] || null;
  }
}
