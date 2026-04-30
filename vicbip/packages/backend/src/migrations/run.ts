import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: join(__dirname, '../../../..', '.env') });

export async function runMigrations(migrationsDir: string): Promise<void> {
  const pool = new Pool({
    connectionString: process.env['DATABASE_URL'],
  });

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const result = await client.query(
        'SELECT id FROM migrations WHERE filename = $1',
        [file],
      );

      if (result.rows.length === 0) {
        console.log(`[migrate] Applying: ${file}`);
        const sql = readFileSync(join(migrationsDir, file), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
        console.log(`[migrate] Applied: ${file}`);
      } else {
        console.log(`[migrate] Already applied: ${file}`);
      }
    }

    console.log('[migrate] All migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

// Allow running directly: ts-node src/migrations/run.ts
if (require.main === module) {
  const migrationsDir = join(__dirname, '.');
  runMigrations(migrationsDir).catch((err) => {
    console.error('[migrate] Failed:', err);
    process.exit(1);
  });
}
