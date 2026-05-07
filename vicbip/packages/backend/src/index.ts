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
    .row{margin:10px 0;display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
    button{padding:9px 18px;background:#1B4F8C;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px}
    button:hover{opacity:.9} button:disabled{opacity:.5}
    pre{color:#94a3b8;font-size:11px;font-family:monospace;max-width:680px;word-break:break-all;white-space:pre-wrap;margin:0;background:#1e293b;padding:8px;border-radius:4px}
    .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:680px}
    .form-grid .full{grid-column:1/-1}
    label{display:block;font-size:12px;color:#94a3b8;margin-bottom:3px}
    input,select,textarea{width:100%;padding:7px 10px;background:#1e293b;color:white;border:1px solid #334155;border-radius:4px;font-size:13px}
    textarea{resize:vertical;min-height:60px}
    .submit-btn{background:#5B21B6;margin-top:4px;padding:10px 24px;font-size:14px}
    #tender-result{margin-top:10px}
  </style>
</head>
<body>
<h2>VicBIP Admin Panel</h2>
<p class="sub">
  <a href="https://vicbip.up.railway.app" target="_blank" style="color:#60a5fa">↗ Open VicBIP live site</a>
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="/" style="color:#60a5fa">← Back to app</a>
</p>

<h3>Manual Tender Entry</h3>
<p class="sub">Add a tender record manually and optionally link it to a bridge.</p>
<form id="tender-form" onsubmit="submitTender(event)">
  <div class="form-grid">
    <div class="full">
      <label>Tender Title *</label>
      <input type="text" name="title" required placeholder="e.g. Princes Bridge Strengthening Works">
    </div>
    <div class="full">
      <label>Tender URL *</label>
      <input type="url" name="url" required placeholder="https://...">
    </div>
    <div>
      <label>Published Date</label>
      <input type="date" name="published_date">
    </div>
    <div>
      <label>Status</label>
      <select name="status">
        <option value="open">Open</option>
        <option value="closed">Closed</option>
        <option value="awarded">Awarded</option>
      </select>
    </div>
    <div>
      <label>Agency / Council</label>
      <input type="text" name="agency" placeholder="e.g. City of Melbourne">
    </div>
    <div>
      <label>Estimated Value (AUD)</label>
      <input type="text" name="value_aud" placeholder="e.g. 2500000 or $2.5M">
    </div>
    <div class="full">
      <label>Bridge Name Match (leave blank to skip auto-link)</label>
      <input type="text" name="bridge_name" placeholder="e.g. Princes Bridge — partial match works">
    </div>
    <div class="full">
      <label>Notes / Summary</label>
      <textarea name="notes" placeholder="Optional description or context"></textarea>
    </div>
  </div>
  <button type="submit" class="submit-btn">Add Tender</button>
</form>
<div id="tender-result"></div>

<h3>Pipeline Actions</h3>
<div id="actions"></div>

<script>
const endpoints = [
  ['Seed DTP Bridges','seed-dtp?force=true','#1B4F8C'],
  ['Seed Budget','seed-budget','#166534'],
  ['Seed Prequal','seed-prequal','#166534'],
  ['Run Prequal Match','run-prequal-match','#166534'],
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
  row.style.cssText='margin:10px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap';
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText='padding:9px 18px;background:'+color+';color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px';
  const status = document.createElement('pre');
  status.style.cssText='color:#94a3b8;font-size:11px;font-family:monospace;max-width:680px;word-break:break-all;white-space:pre-wrap;margin:0;background:#1e293b;padding:8px;border-radius:4px;display:none';
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

function parseValue(raw) {
  if (!raw) return null;
  const n = raw.replace(/[$,\\s]/g,'');
  const m = n.match(/[\\d.]+/);
  if (!m) return null;
  let v = parseFloat(m[0]);
  if (/million|\\dm/i.test(n)) v *= 1e6;
  else if (/thousand|\\dk/i.test(n)) v *= 1e3;
  return isNaN(v) ? null : Math.round(v);
}

async function submitTender(e) {
  e.preventDefault();
  const form = e.target;
  const result = document.getElementById('tender-result');
  result.innerHTML = '<pre>Submitting...</pre>';
  const data = {
    title: form.title.value.trim(),
    url: form.url.value.trim(),
    published_date: form.published_date.value || null,
    status: form.status.value,
    agency: form.agency.value.trim() || null,
    value_aud: parseValue(form.value_aud.value),
    bridge_name: form.bridge_name.value.trim() || null,
    notes: form.notes.value.trim() || null,
  };
  try {
    const r = await fetch('/api/admin/add-tender', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(data)
    });
    const d = await r.json();
    result.innerHTML = '<pre style="color:'+(d.success?'#86efac':'#fca5a5')+'">'+JSON.stringify(d,null,2)+'</pre>';
    if (d.success) form.reset();
  } catch(err) {
    result.innerHTML = '<pre style="color:#fca5a5">Error: '+err+'</pre>';
  }
}
</script>
</body></html>`;

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
