import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import path, { join } from 'path';

dotenv.config({ path: join(__dirname, '../../../..', '.env') });

import bridgesRouter from './routes/bridges';

const app = express();
const PORT = process.env['PORT'] ?? 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/bridges', bridgesRouter);

// Serve frontend static files
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));

// Catch-all: serve index.html for React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`VicBIP backend running on port ${PORT}`);
});

export default app;
