import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { computeSolutionMatch } from '../utils/solutionMatch';
import type {
  BridgeGeoJSONCollection,
  BridgeDetail,
  BridgeStats,
  OwnerCategory,
  RiskTier,
} from '@vicbip/shared';

const router = Router();

const OwnerCategoryEnum = z.enum([
  'state_govt',
  'local_govt',
  'rail',
  'toll_road',
  'utility',
  'port',
  'other',
]);

const RiskTierEnum = z.enum(['critical', 'high', 'moderate', 'low']);

const BridgeFiltersSchema = z.object({
  owner_category: z
    .string()
    .optional()
    .transform((v) =>
      v ? v.split(',').map((s) => OwnerCategoryEnum.parse(s.trim())) : undefined,
    ),
  risk_tier: z
    .string()
    .optional()
    .transform((v) =>
      v ? v.split(',').map((s) => RiskTierEnum.parse(s.trim())) : undefined,
    ),
  min_year: z.coerce.number().int().min(1800).max(2100).optional(),
  max_year: z.coerce.number().int().min(1800).max(2100).optional(),
  min_span: z.coerce.number().min(0).optional(),
  max_span: z.coerce.number().min(0).optional(),
  q: z.string().max(200).optional(),
  freyssinet_only: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  exclude_freyssinet: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  sn_only: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  has_tenders: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

const ExportFiltersSchema = BridgeFiltersSchema.extend({
  format: z.enum(['csv']).optional(),
});

function buildWhere(filters: z.infer<typeof BridgeFiltersSchema>): {
  where: string;
  params: unknown[];
  nextIdx: number;
} {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.owner_category && filters.owner_category.length > 0) {
    conditions.push(`owner_category = ANY($${idx}::text[])`);
    params.push(filters.owner_category);
    idx++;
  }

  if (filters.risk_tier && filters.risk_tier.length > 0) {
    conditions.push(`risk_tier = ANY($${idx}::text[])`);
    params.push(filters.risk_tier);
    idx++;
  }

  if (filters.min_year !== undefined) {
    conditions.push(`construction_year >= $${idx}`);
    params.push(filters.min_year);
    idx++;
  }

  if (filters.max_year !== undefined) {
    conditions.push(`construction_year <= $${idx}`);
    params.push(filters.max_year);
    idx++;
  }

  if (filters.min_span !== undefined) {
    conditions.push(`span_m >= $${idx}`);
    params.push(filters.min_span);
    idx++;
  }

  if (filters.max_span !== undefined) {
    conditions.push(`span_m <= $${idx}`);
    params.push(filters.max_span);
    idx++;
  }

  if (filters.q) {
    conditions.push(
      `(name ILIKE $${idx} OR road_name ILIKE $${idx} OR owner_name ILIKE $${idx})`,
    );
    params.push(`%${filters.q}%`);
    idx++;
  }

  if (filters.freyssinet_only) {
    conditions.push('freyssinet_works = true');
  }

  if (filters.exclude_freyssinet) {
    conditions.push('freyssinet_works = false');
  }

  if (filters.sn_only) {
    conditions.push("bridge_id ILIKE 'SN%'");
  }

  if (filters.has_tenders) {
    conditions.push(
      'EXISTS (SELECT 1 FROM bridge_tenders bt WHERE bt.bridge_id = bridges.id)',
    );
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    nextIdx: idx,
  };
}

// GET /api/bridges
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = BridgeFiltersSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.format() });
    return;
  }

  const { where, params } = buildWhere(parsed.data);

  try {
    const result = await pool.query(
      `SELECT
        b.id, b.name, b.road_name, b.bridge_type, b.construction_year, b.span_m,
        b.owner_name, b.owner_category, b.sri_score, b.risk_tier, b.freyssinet_works,
        b.latitude, b.longitude,
        (b.bridge_id ILIKE 'SN%') AS is_sn,
        EXISTS (SELECT 1 FROM bridge_tenders bt WHERE bt.bridge_id = b.id) AS has_tenders
       FROM bridges b
       ${where}
       ORDER BY b.sri_score DESC`,
      params,
    );

    const collection: BridgeGeoJSONCollection = {
      type: 'FeatureCollection',
      features: result.rows.map((row) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [row.longitude as number, row.latitude as number],
        },
        properties: {
          id: row.id as string,
          name: row.name as string,
          road_name: row.road_name as string | null,
          bridge_type: row.bridge_type as string | null,
          construction_year: row.construction_year as number | null,
          span_m: row.span_m as number | null,
          owner_name: row.owner_name as string | null,
          owner_category: row.owner_category as OwnerCategory | null,
          sri_score: row.sri_score as number,
          risk_tier: row.risk_tier as RiskTier | null,
          freyssinet_works: row.freyssinet_works as boolean,
          is_sn: row.is_sn as boolean,
          has_tenders: row.has_tenders as boolean,
        },
      })),
    };

    res.json(collection);
  } catch (err) {
    console.error('GET /api/bridges error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/bridges/stats — must be before /:id route
router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [totalRes, tierRes, ownerRes, eraRes, top20Res] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total FROM bridges'),
      pool.query(
        `SELECT risk_tier, COUNT(*) AS cnt FROM bridges WHERE risk_tier IS NOT NULL GROUP BY risk_tier`,
      ),
      pool.query(
        `SELECT owner_category, COUNT(*) AS cnt FROM bridges WHERE owner_category IS NOT NULL GROUP BY owner_category`,
      ),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE construction_year < 1960) AS pre_1960,
          COUNT(*) FILTER (WHERE construction_year BETWEEN 1960 AND 1979) AS x1960_1980,
          COUNT(*) FILTER (WHERE construction_year BETWEEN 1980 AND 1999) AS x1980_2000,
          COUNT(*) FILTER (WHERE construction_year BETWEEN 2000 AND 2009) AS x2000_2010,
          COUNT(*) FILTER (WHERE construction_year >= 2010) AS x2010_plus,
          COUNT(*) FILTER (WHERE construction_year IS NULL) AS unknown
        FROM bridges
      `),
      pool.query(
        `SELECT id, name, owner_name, sri_score, risk_tier FROM bridges ORDER BY sri_score DESC LIMIT 20`,
      ),
    ]);

    const by_tier: Record<string, number> = {};
    for (const row of tierRes.rows) {
      by_tier[row.risk_tier as string] = parseInt(row.cnt as string, 10);
    }

    const by_owner_category: Record<string, number> = {};
    for (const row of ownerRes.rows) {
      by_owner_category[row.owner_category as string] = parseInt(row.cnt as string, 10);
    }

    const eraRow = eraRes.rows[0] as Record<string, string>;

    const stats: BridgeStats = {
      total: parseInt(totalRes.rows[0]?.total as string ?? '0', 10),
      by_tier: {
        critical: by_tier['critical'] ?? 0,
        high: by_tier['high'] ?? 0,
        moderate: by_tier['moderate'] ?? 0,
        low: by_tier['low'] ?? 0,
      },
      by_owner_category: {
        state_govt: by_owner_category['state_govt'] ?? 0,
        local_govt: by_owner_category['local_govt'] ?? 0,
        rail: by_owner_category['rail'] ?? 0,
        toll_road: by_owner_category['toll_road'] ?? 0,
        utility: by_owner_category['utility'] ?? 0,
        port: by_owner_category['port'] ?? 0,
        other: by_owner_category['other'] ?? 0,
      },
      by_era: {
        pre_1960: parseInt(eraRow?.['pre_1960'] ?? '0', 10),
        x1960_1980: parseInt(eraRow?.['x1960_1980'] ?? '0', 10),
        x1980_2000: parseInt(eraRow?.['x1980_2000'] ?? '0', 10),
        x2000_2010: parseInt(eraRow?.['x2000_2010'] ?? '0', 10),
        x2010_plus: parseInt(eraRow?.['x2010_plus'] ?? '0', 10),
        unknown: parseInt(eraRow?.['unknown'] ?? '0', 10),
      },
      top20: top20Res.rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        owner_name: r.owner_name as string | null,
        sri_score: r.sri_score as number,
        risk_tier: r.risk_tier as RiskTier | null,
      })),
    };

    res.json(stats);
  } catch (err) {
    console.error('GET /api/bridges/stats error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/bridges/export
router.get('/export', async (req: Request, res: Response): Promise<void> => {
  const parsed = ExportFiltersSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.format() });
    return;
  }

  const { where, params } = buildWhere(parsed.data);

  try {
    const result = await pool.query(
      `SELECT
        name, road_name, owner_name, owner_category, construction_year,
        span_m, sri_score, risk_tier, bridge_type,
        latitude, longitude,
        freyssinet_works
       FROM bridges ${where} ORDER BY sri_score DESC`,
      params,
    );

    const headers = [
      'name',
      'road_name',
      'owner_name',
      'owner_category',
      'construction_year',
      'span_m',
      'sri_score',
      'risk_tier',
      'bridge_type',
      'latitude',
      'longitude',
      'freyssinet_works',
    ];

    const csvRows = [
      headers.join(','),
      ...result.rows.map((row) =>
        headers
          .map((h) => {
            const val = row[h];
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(','),
      ),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="vicbip-bridges.csv"',
    );
    res.send(csvRows.join('\n'));
  } catch (err) {
    console.error('GET /api/bridges/export error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/bridges/:id
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const idSchema = z.string().uuid();
  const parsed = idSchema.safeParse(req.params['id']);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid bridge ID' });
    return;
  }

  const id = parsed.data;

  try {
    const [bridgeRes, trafficRes, eventsRes, tendersRes, intelligenceRes] =
      await Promise.all([
        pool.query(`SELECT * FROM bridges WHERE id = $1`, [id]),
        pool.query(
          `SELECT * FROM bridge_traffic WHERE bridge_id = $1 ORDER BY year DESC LIMIT 1`,
          [id],
        ),
        pool.query(
          `SELECT * FROM bridge_events
           WHERE bridge_id = $1
             AND (event_date IS NULL OR event_date >= NOW() - INTERVAL '5 years')
           ORDER BY event_date DESC`,
          [id],
        ),
        pool.query(
          `SELECT * FROM bridge_tenders WHERE bridge_id = $1 ORDER BY published_date DESC`,
          [id],
        ),
        pool.query(
          `SELECT * FROM bridge_intelligence
           WHERE bridge_id = $1
           ORDER BY collected_at DESC LIMIT 10`,
          [id],
        ),
      ]);

    if (bridgeRes.rows.length === 0) {
      res.status(404).json({ error: 'Bridge not found' });
      return;
    }

    const bridge = bridgeRes.rows[0] as Record<string, unknown>;
    const tenders = tendersRes.rows as BridgeDetail['tenders'];

    const solution_match = computeSolutionMatch({
      bridge_type: bridge['bridge_type'] as string | null,
      construction_year: bridge['construction_year'] as number | null,
      span_m: bridge['span_m'] as number | null,
      tenders,
    });

    const detail: BridgeDetail = {
      id: bridge['id'] as string,
      bridge_id: bridge['bridge_id'] as string | null,
      name: bridge['name'] as string,
      road_name: bridge['road_name'] as string | null,
      bridge_type: bridge['bridge_type'] as string | null,
      construction_year: bridge['construction_year'] as number | null,
      span_m: bridge['span_m'] as number | null,
      feature_crossed: bridge['feature_crossed'] as string | null,
      owner_name: bridge['owner_name'] as string | null,
      owner_category: bridge['owner_category'] as OwnerCategory | null,
      latitude: bridge['latitude'] as number,
      longitude: bridge['longitude'] as number,
      design_load_std: bridge['design_load_std'] as string | null,
      sri_score: bridge['sri_score'] as number,
      risk_tier: bridge['risk_tier'] as RiskTier | null,
      freyssinet_works: bridge['freyssinet_works'] as boolean,
      street_view_url: bridge['street_view_url'] as string | null,
      data_sources: bridge['data_sources'] as string[] | null,
      notes: bridge['notes'] as string | null,
      last_ingested: bridge['last_ingested'] as string,
      traffic: trafficRes.rows.length > 0 ? (trafficRes.rows[0] as BridgeDetail['traffic']) : null,
      events: eventsRes.rows as BridgeDetail['events'],
      tenders,
      intelligence: intelligenceRes.rows as BridgeDetail['intelligence'],
      solution_match,
    };

    res.json(detail);
  } catch (err) {
    console.error(`GET /api/bridges/${id} error:`, err);
    res.status(500).json({ error: 'Database error' });
  }
});

export default router;
