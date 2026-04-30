import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import path from 'path';

const router = Router();

// GET /api/admin/run-seed
// Executes the VicRoads bridge ingestion pipeline script and streams the output.
router.get('/run-seed', (req: Request, res: Response): void => {
  // Script lives at packages/pipeline/ingest/vicroads_bridges.py relative to the
  // monorepo root. __dirname is dist/ or src/ depending on environment, so we
  // walk up to the repo root (four levels: dist → backend → packages → vicbip).
  const repoRoot = path.join(__dirname, '..', '..', '..', '..');
  const scriptPath = path.join(
    repoRoot,
    'packages',
    'pipeline',
    'ingest',
    'vicroads_bridges.py',
  );

  // Forward DATABASE_URL and any other env vars already in the process environment.
  const env = { ...process.env };

  console.log(`[admin] run-seed: executing ${scriptPath}`);

  exec(
    `python3 "${scriptPath}"`,
    { env, cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
    (error, stdout, stderr) => {
      const output = [
        stdout.trim(),
        stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n');

      if (error) {
        console.error('[admin] run-seed failed:', error.message);
        res.status(500).json({
          success: false,
          error: error.message,
          output,
        });
        return;
      }

      console.log('[admin] run-seed complete');
      res.json({ success: true, output });
    },
  );
});

export default router;
