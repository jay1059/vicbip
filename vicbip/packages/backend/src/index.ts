import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import path, { join } from 'path';

dotenv.config({ path: join(__dirname, '../../../..', '.env') });

import bridgesRouter from './routes/bridges';
import adminRouter from './routes/admin';
import { runMigrations } from './migrations/run';

const app = express();
const PORT = process.env['PORT'] ?? 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/bridges', bridgesRouter);
app.use('/api/admin', adminRouter);

// Serve frontend static files
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));

// Catch-all: serve index.html for React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

async function start(): Promise<void> {
  // SQL files live in src/migrations/ whether running via ts-node or compiled dist
  const migrationsDir = path.join(__dirname, '../src/migrations');

  console.log('[startup] Running database migrations…');
  try {
    await runMigrations(migrationsDir);
  } catch (err) {
    console.error('[startup] Migration failed — aborting:', err);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`VicBIP backend running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('[startup] Unexpected error:', err);
  process.exit(1);
});

export default app;
