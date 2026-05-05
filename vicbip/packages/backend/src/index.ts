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

// Server-rendered admin page — bypasses the React bundle for reliable access
app.get('/admin-direct', (_req, res) => {
  const endpoints = [
    'seed-dtp?force=true',
    'remap-owners',
    'run-traffic-aadt',
    'run-traffic-tirtl',
    'run-crash-data',
    'run-disruptions',
    'run-tender-scrape',
    'run-all-data',
  ];

  const buttons = endpoints
    .map((e) => {
      const id = e.replace(/[^a-z0-9]/gi, '-');
      const warning =
        e === 'run-crash-data'
          ? ' <span style="color:#b45309;font-size:12px">⚠ Takes ~10 min (large file)</span>'
          : e === 'run-all-data'
            ? ' <span style="color:#b45309;font-size:12px">⚠ Allow 15+ min</span>'
            : '';
      return `<div style="margin:10px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
  <button onclick="run('${e}','${id}')" style="padding:8px 20px;background:#1B4F8C;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px">${e.replace(/\?.*/, '')}</button>${warning}
  <span id="${id}" style="color:#555;font-size:13px;font-family:monospace;max-width:600px;word-break:break-all"></span>
</div>`;
    })
    .join('\n');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>VicBIP Admin</title>
  <style>body{font-family:system-ui,sans-serif;padding:24px;max-width:900px;margin:0 auto}
  h1{color:#1B4F8C}a{color:#1B4F8C}</style>
</head>
<body>
  <h1>VicBIP Admin</h1>
  <p style="color:#666">Server-rendered fallback admin page. <a href="/">← Back to app</a></p>
  <hr style="margin:16px 0">
  ${buttons}
  <script>
  async function run(endpoint, id) {
    const el = document.getElementById(id);
    el.style.color = '#555';
    el.textContent = 'Running\u2026';
    const t0 = Date.now();
    try {
      const r = await fetch('/api/admin/' + endpoint);
      const d = await r.json();
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      el.style.color = r.ok ? '#166534' : '#991b1b';
      el.textContent = elapsed + 's \u2192 ' + JSON.stringify(d).substring(0, 300);
    } catch(e) {
      el.style.color = '#991b1b';
      el.textContent = 'Error: ' + e;
    }
  }
  </script>
</body>
</html>`);
});

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
