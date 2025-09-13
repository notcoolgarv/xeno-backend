import { Database, pool } from './connection';
import dotenv from 'dotenv';

dotenv.config();

async function createTenant() {
  const shopDomain = process.env.SHOP_DOMAIN;
  const accessToken = process.env.ACCESS_TOKEN;

  if (!shopDomain || !accessToken) {
    console.error('Please provide SHOP_DOMAIN and ACCESS_TOKEN in your .env file.');
    return;
  }

  try {
    const result = await Database.query(`
      INSERT INTO tenants (shop_domain, access_token)
      VALUES ($1, $2)
      ON CONFLICT (shop_domain) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        updated_at = NOW()
      RETURNING *
    `, [shopDomain, accessToken]);

    console.log('Successfully created or updated tenant:');
    console.log(result.rows[0]);
  } catch (error) {
    console.error('Failed to create tenant:', error);
  } finally {
    await pool.end();
  }
}

createTenant();
