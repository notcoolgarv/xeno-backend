import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10, // Reduced pool size for better compatibility with external poolers
  idleTimeoutMillis: 10000, // Reduced idle timeout
  connectionTimeoutMillis: 5000, // Increased connection timeout
  // @ts-ignore - `validate` is not in the type definitions but is supported by `pg-pool`
  validate: (client) => {
    // This function is called before a client is returned from the pool.
    // It helps to prevent using a connection that has been terminated by an external pooler.
    return client.query('SELECT 1').then(() => true).catch(() => false);
  }
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  // process.exit(-1); // Optional: exit the process if a serious error occurs
});

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

export class Database {
  static async query(text: string, params?: any[]) {
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const client = await pool.connect();
        try {
          const result = await client.query(text, params);
          return result;
        } finally {
          client.release();
        }
      } catch (error: any) {
        // Check if the error is a connection error that might be retried
        if (error.code === 'ECONNRESET' || (error.message && error.message.includes('Connection terminated'))) {
          console.warn(`Query failed, attempt ${i + 1}/${MAX_RETRIES}. Retrying...`, { query: text, error: error.message });
          if (i < MAX_RETRIES - 1) {
            await new Promise(res => setTimeout(res, RETRY_DELAY_MS * (i + 1)));
            continue;
          }
        }
        // For non-retriable errors or after max retries, throw the error
        throw error;
      }
    }
    // This should not be reached, but typescript needs a return path.
    throw new Error('Query failed after multiple retries.');
  }

  static async transaction<T>(callback: (query: (text: string, params?: any[]) => Promise<any>) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const query = (text: string, params?: any[]) => client.query(text, params);
      const result = await callback(query);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
