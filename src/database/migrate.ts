import { Database } from './connection';
import * as fs from 'fs';
import * as path from 'path';

async function runMigrations() {
  try {
    console.log('Running database migrations...');
    
    const migrationSql = fs.readFileSync(
      path.join(__dirname, 'migrations.sql'),
      'utf8'
    );
    
    await Database.query(migrationSql);
    
    console.log('Migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
