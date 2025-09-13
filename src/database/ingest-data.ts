import axios from 'axios';
import { Database, pool } from './connection';

async function ingestData() {
  console.log('Starting data ingestion for all tenants...');

  try {
    // 1. Get all active tenants from the database
    const tenantsResult = await Database.query("SELECT id FROM tenants WHERE status = 'active' ORDER BY created_at");
    
    if (tenantsResult.rows.length === 0) {
      console.error('❌ No active tenants found. Please run "npm run create-tenant" or check tenant statuses.');
      return;
    }
    
    console.log(`Found ${tenantsResult.rows.length} active tenant(s).`);

    // 2. Loop through each tenant and call the data ingestion API endpoint
    for (const tenant of tenantsResult.rows) {
      const tenantId = tenant.id;
      console.log(`\n--- Triggering ingestion for tenant ID: ${tenantId} ---`);
      try {
        const response = await axios.post(`http://localhost:3000/api/tenants/${tenantId}/ingest`);

        if (response.status === 200 && response.data.success) {
          console.log(`✅ Data ingestion started successfully for tenant ${tenantId}.`);
          console.log('Ingestion results:', response.data.results);
        } else {
          console.error(`❌ Failed to start data ingestion for tenant ${tenantId}. API response:`, response.data);
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error(`❌ An API error occurred during ingestion for tenant ${tenantId}:`, error.response?.data || error.message);
        } else {
          console.error(`❌ An unexpected error occurred for tenant ${tenantId}:`, error);
        }
      }
    }

  } catch (error) {
    console.error('❌ An unexpected error occurred while fetching tenants:', error);
  } finally {
    // Close the pool to allow the script to exit cleanly.
    await pool.end();
    console.log('\nIngestion script finished.');
  }
}

ingestData();
