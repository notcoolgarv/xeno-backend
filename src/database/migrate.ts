import { Database } from './connection';
import * as fs from 'fs';
import * as path from 'path';

export async function runMigrations(): Promise<void> {
  console.log('Running database migrations...');
  const migrationSql = fs.readFileSync(
    path.join(__dirname, 'migrations.sql'),
    'utf8'
  );
  await Database.query(migrationSql);
  console.log('Migrations completed successfully!');
}

if (require.main === module) {
  runMigrations().then(() => process.exit(0)).catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
