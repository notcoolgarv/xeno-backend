import { Router } from 'express';
import { Database } from '../database/connection';
import { DataIngestionService } from '../services/data-ingestion';

const router = Router();
const ingestionService = new DataIngestionService();

// Create tenant
router.post('/tenants', async (req, res) => {
  try {
    const { shop_domain, access_token } = req.body;
    
    if (!shop_domain || !access_token) {
      return res.status(400).json({ error: 'shop_domain and access_token are required' });
    }

    const result = await Database.query(`
      INSERT INTO tenants (shop_domain, access_token)
      VALUES ($1, $2)
      RETURNING *
    `, [shop_domain, access_token]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create tenant error:', error);
    res.status(500).json({ error: 'Failed to create tenant' });
  }
});

// Get all tenants
router.get('/tenants', async (req, res) => {
  try {
    const result = await Database.query(`
      SELECT id, shop_domain, status, created_at, updated_at 
      FROM tenants 
      ORDER BY created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Get tenants error:', error);
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
});

// Trigger data ingestion for a tenant
router.post('/tenants/:tenantId/ingest', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { data_types } = req.body; // ['customers', 'products', 'orders']
    
    const tenant = await Database.query(`
      SELECT * FROM tenants WHERE id = $1
    `, [tenantId]);

    if (tenant.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantData = tenant.rows[0];
    const results = {};

    if (!data_types || data_types.includes('customers')) {
      results['customers'] = await ingestionService.ingestCustomers(
        tenantId, tenantData.shop_domain, tenantData.access_token
      );
    }

    if (!data_types || data_types.includes('products')) {
      results['products'] = await ingestionService.ingestProducts(
        tenantId, tenantData.shop_domain, tenantData.access_token
      );
    }

    if (!data_types || data_types.includes('orders')) {
      results['orders'] = await ingestionService.ingestOrders(
        tenantId, tenantData.shop_domain, tenantData.access_token
      );
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('Data ingestion error:', error);
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    res.status(500).json({ error: 'Data ingestion failed', details: errorMessage });
  }
});

// Get ingestion logs
router.get('/tenants/:tenantId/logs', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
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

// Get analytics data
router.get('/tenants/:tenantId/analytics', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
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

// Get overall stats
router.get('/stats', async (req, res) => {
  try {
    // Aggregate stats across all tenants
    const customerResult = await Database.query('SELECT COUNT(*) as count FROM customers');
    const orderResult = await Database.query('SELECT COUNT(*) as count, COALESCE(SUM(total_price),0) as revenue FROM orders');
    const stats = {
      totalCustomers: parseInt(customerResult.rows[0].count),
      totalOrders: parseInt(orderResult.rows[0].count),
      totalRevenue: parseFloat(orderResult.rows[0].revenue)
    };
    res.json(stats);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get orders (optionally filtered by date)
router.get('/orders', async (req, res) => {
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
router.get('/customers/top-spenders', async (req, res) => {
  try {
    const result = await Database.query(`
      SELECT id, first_name || ' ' || last_name AS name, email, total_spent
      FROM customers
      ORDER BY total_spent DESC
      LIMIT 10
    `);
    const customers = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      total_spend: parseFloat(row.total_spent)
    }));
    res.json(customers);
  } catch (error) {
    console.error('Get top customers error:', error);
    res.status(500).json({ error: 'Failed to fetch top customers' });
  }
});

export default router;
