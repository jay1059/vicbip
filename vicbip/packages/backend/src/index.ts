// VicBIP Backend v3.0 - Node.js ingest pipeline - May 2026
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

// ─── Server-rendered admin page ─────────────────────────────────────────────
// Defined as a const so it is compiled into the bundle and cannot be affected
// by static-file middleware or the catch-all. Registered as the VERY FIRST
// route so Express never reaches express.static() or the catch-all for this path.
const adminHtml = `<!DOCTYPE html>
<html><head><title>VicBIP Admin</title></head>
<body style="font-family:sans-serif;padding:20px;background:#0f172a;color:white">
<h2 style="color:#E8731A">VicBIP Admin Panel</h2>
<p style="color:#94a3b8;font-size:13px">Server-rendered — no React bundle required. <a href="/" style="color:#60a5fa">&#8592; Back to app</a></p>
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
  ['Run All Data','run-all-data','#92400E']
];
const div = document.getElementById('actions');
endpoints.forEach(([label,ep,color]) => {
  const row = document.createElement('div');
  row.style.cssText='margin:12px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap';
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText='padding:10px 20px;background:'+color+';color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px';
  const status = document.createElement('span');
  status.style.cssText='color:#94a3b8;font-size:13px;font-family:monospace;max-width:600px;word-break:break-all';
  btn.onclick = async () => {
    btn.disabled=true;
    status.textContent='Running...';
    const t=Date.now();
    try {
      const r=await fetch('/api/admin/'+ep);
      const d=await r.json();
      status.textContent=(((Date.now()-t)/1000).toFixed(1))+'s: '+JSON.stringify(d).substring(0,300);
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
</script></body></html>`;

// /admin-direct must be registered before ALL other middleware including express.static
app.get('/admin-direct', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(adminHtml);
});

// ─── Core middleware ──────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── API routes ───────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/bridges', bridgesRouter);
app.use('/api/admin', adminRouter);

// ─── Frontend static files ────────────────────────────────────────────────────
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));

// Catch-all: serve index.html for React client-side routing
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// ─── Startup ───────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  const migrationsDir = path.join(__dirname, '../src/migrations');
  console.log('[startup] Running database migrations…');
  try {
    await runMigrations(migrationsDir);
  } catch (err) {
    console.error('[startup] Migration failed — aborting:', err);
    process.exit(1);
  }
  console.log('[startup] VicBIP v3.0 - ingest endpoints active');
  app.listen(PORT, () => {
    console.log(`VicBIP backend running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('[startup] Unexpected error:', err);
  process.exit(1);
});

export default app;
