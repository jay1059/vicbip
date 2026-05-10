// VicBIP Backend v3.1
import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import path, { join } from 'path';

dotenv.config({ path: join(__dirname, '../../../..', '.env') });

import bridgesRouter from './routes/bridges';
import adminRouter from './routes/admin';
import contentRouter from './routes/content';
import { runMigrations } from './migrations/run';

const app = express();
const PORT = process.env['PORT'] ?? 3001;

// ─── Server-rendered admin page ──────────────────────────────────────────────
const adminHtml = `<!DOCTYPE html>
<html>
<head>
  <title>VicBIP Admin</title>
  <meta charset="utf-8">
  <style>
    *{box-sizing:border-box}
    body{font-family:sans-serif;padding:20px;background:#0f172a;color:white;margin:0}
    h2{color:#E8731A;margin:0 0 4px}
    h3{color:#93c5fd;margin:20px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.05em}
    p.sub{color:#94a3b8;font-size:13px;margin:0 0 16px}
    button{padding:9px 18px;background:#1B4F8C;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px}
    button:hover{opacity:.9} button:disabled{opacity:.5}
    pre{color:#94a3b8;font-size:11px;font-family:monospace;max-width:680px;word-break:break-all;white-space:pre-wrap;margin:0;background:#1e293b;padding:8px;border-radius:4px;display:none}
    .row{margin:10px 0;display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
  </style>
</head>
<body>
<h2>VicBIP Admin Panel</h2>
<p class="sub">
  <a href="https://vicbip.up.railway.app" target="_blank" style="color:#60a5fa">↗ Open VicBIP live site</a>
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="/" style="color:#60a5fa">← Back to app</a>
</p>

<h3>Pipeline Actions</h3>
<div id="actions"></div>

<script>
const endpoints = [
  ['Seed DTP Bridges','seed-dtp?force=true','#1B4F8C'],
  ['Remap Owners','remap-owners','#1B4F8C'],
  ['Run Traffic AADT','run-traffic-aadt','#166534'],
  ['Run TIRTL','run-traffic-tirtl','#166534'],
  ['Run Crash Data (10min)','run-crash-data','#991B1B'],
  ['Run Disruptions','run-disruptions','#92400E'],
  ['Run Tender Scraper','run-tender-scrape','#5B21B6'],
  ['Seed Prequal','seed-prequal','#166534'],
  ['Run Prequal Match','run-prequal-match','#166534'],
  ['Seed Budget','seed-budget','#166534'],
  ['Seed Future Projects','seed-future-projects','#7C3AED'],
  ['Run Conflict Detection (~2 min)','run-project-conflicts','#7C3AED'],
  ['Run All Data','run-all-data','#92400E']
];
const div = document.getElementById('actions');
endpoints.forEach(([label,ep,color]) => {
  const row = document.createElement('div');
  row.className = 'row';
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = 'padding:9px 18px;background:'+color+';color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px';
  const status = document.createElement('pre');
  btn.onclick = async () => {
    btn.disabled=true;
    status.style.display='block';
    status.textContent='Running...';
    const t=Date.now();
    try {
      const r=await fetch('/api/admin/'+ep);
      const d=await r.json();
      status.textContent=(((Date.now()-t)/1000).toFixed(1))+'s: '+JSON.stringify(d,null,2);
      btn.style.background='#166534';
    } catch(e) {
      status.textContent='Error: '+e;
      btn.style.background='#991B1B';
    }
    btn.disabled=false;
  };
  row.appendChild(btn);
  row.appendChild(status);
  div.appendChild(row);
});
</script>
</body></html>`;

app.get('/admin-direct', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.send(adminHtml); });

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });

app.use('/api/bridges', bridgesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/content', contentRouter);

const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (_req, res) => { res.sendFile(path.join(frontendDist, 'index.html')); });

async function start(): Promise<void> {
  const migrationsDir = path.join(__dirname, '../src/migrations');
  console.log('[startup] Running database migrations…');
  try { await runMigrations(migrationsDir); } catch (err) {
    console.error('[startup] Migration failed — aborting:', err); process.exit(1);
  }
  console.log('[startup] VicBIP v3.1 - all endpoints active');
  app.listen(PORT, () => { console.log(`VicBIP backend running on port ${PORT}`); });
}

start().catch((err) => { console.error('[startup] Unexpected error:', err); process.exit(1); });
export default app;
