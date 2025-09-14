import dotenv from 'dotenv';
dotenv.config();
import { Database } from '../database/connection';
import { generateApiKey } from '../middleware/auth';

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error('Usage: ts-node src/scripts/generate-api-key.ts <tenantId> [label]');
    process.exit(1);
  }
  const label = process.argv[3] || null;

  const tenant = await Database.query('SELECT id, shop_domain FROM tenants WHERE id = $1', [tenantId]);
  if (tenant.rows.length === 0) {
    console.error('Tenant not found');
    process.exit(1);
  }

  const { raw, hashed } = generateApiKey();
  await Database.query(
    `INSERT INTO tenant_api_keys (tenant_id, hashed_key, label) VALUES ($1, $2, $3)`,
    [tenantId, hashed, label]
  );

  console.log('API key created for tenant:', tenant.rows[0].shop_domain);
  console.log('Store this secret securely; it will not be shown again:');
  console.log(raw);
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
