import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import path from 'path';
import https from 'https';
import http from 'http';
import { parse } from 'csv-parse';
import { pool } from '../db/pool';
import {
  computeBasicSriScore,
  computeRiskTier,
  inferDesignLoadStd,
  inferOwnerCategory,
} from '../utils/scoring';

const router = Router();

// GET /api/admin/run-seed
router.get('/run-seed', (req: Request, res: Response): void => {
  const repoRoot = path.join(__dirname, '..', '..', '..', '..');
  const scriptPath = path.join(
    repoRoot,
    'packages',
    'pipeline',
    'ingest',
    'vicroads_bridges.py',
  );

  const env = { ...process.env };
  console.log(`[admin] run-seed: executing ${scriptPath}`);

  exec(
    `python3 "${scriptPath}"`,
    { env, cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
    (error, stdout, stderr) => {
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      if (error) {
        console.error('[admin] run-seed failed:', error.message);
        res.status(500).json({ success: false, error: error.message, output });
        return;
      }
      console.log('[admin] run-seed complete');
      res.json({ success: true, output });
    },
  );
});

// 50 real Victorian bridges with genuine coordinates and a mix of risk tiers
const SAMPLE_BRIDGES: Array<{
  bridge_id: string;
  name: string;
  road_name: string;
  bridge_type: string;
  construction_year: number;
  span_m: number;
  feature_crossed: string;
  owner_name: string;
  owner_category: string;
  latitude: number;
  longitude: number;
  design_load_std: string;
  sri_score: number;
  risk_tier: string;
}> = [
  // --- CRITICAL (sri_score >= 80) ---
  { bridge_id: 'sample_001', name: 'Westgate Bridge', road_name: 'West Gate Freeway', bridge_type: 'Cable-stayed', construction_year: 1978, span_m: 336, feature_crossed: 'Yarra River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.8278, longitude: 144.9007, design_load_std: 'Modified T-44', sri_score: 82.5, risk_tier: 'critical' },
  { bridge_id: 'sample_002', name: 'Princes Bridge', road_name: 'St Kilda Road', bridge_type: 'Stone arch', construction_year: 1888, span_m: 98, feature_crossed: 'Yarra River', owner_name: 'City of Melbourne Council', owner_category: 'local_govt', latitude: -37.8183, longitude: 144.9671, design_load_std: 'W7.5 / Pre-T44', sri_score: 91.0, risk_tier: 'critical' },
  { bridge_id: 'sample_003', name: 'Morell Bridge', road_name: 'Alexandra Avenue', bridge_type: 'Masonry arch', construction_year: 1899, span_m: 55, feature_crossed: 'Yarra River', owner_name: 'City of Melbourne Council', owner_category: 'local_govt', latitude: -37.8254, longitude: 144.9779, design_load_std: 'W7.5 / Pre-T44', sri_score: 89.5, risk_tier: 'critical' },
  { bridge_id: 'sample_004', name: 'Anderson Street Bridge', road_name: 'Anderson Street', bridge_type: 'Concrete beam', construction_year: 1952, span_m: 35, feature_crossed: 'Yarra River', owner_name: 'Yarra City Council', owner_category: 'local_govt', latitude: -37.8305, longitude: 144.9864, design_load_std: 'W7.5 / Pre-T44', sri_score: 85.0, risk_tier: 'critical' },
  { bridge_id: 'sample_005', name: 'Ballarat Road Rail Overpass', road_name: 'Ballarat Road', bridge_type: 'Steel girder', construction_year: 1955, span_m: 45, feature_crossed: 'Railway', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.7894, longitude: 144.7523, design_load_std: 'W7.5 / Pre-T44', sri_score: 83.0, risk_tier: 'critical' },
  { bridge_id: 'sample_006', name: 'Maribyrnong River Bridge (Footscray Rd)', road_name: 'Footscray Road', bridge_type: 'Concrete T-beam', construction_year: 1958, span_m: 60, feature_crossed: 'Maribyrnong River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.8041, longitude: 144.8889, design_load_std: 'W7.5 / Pre-T44', sri_score: 84.5, risk_tier: 'critical' },
  { bridge_id: 'sample_007', name: 'Hume Freeway Bridge Broadford', road_name: 'Hume Freeway', bridge_type: 'Prestressed concrete', construction_year: 1956, span_m: 52, feature_crossed: 'King Parrot Creek', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.2014, longitude: 145.0536, design_load_std: 'W7.5 / Pre-T44', sri_score: 81.5, risk_tier: 'critical' },
  { bridge_id: 'sample_008', name: 'Ovens River Bridge Wangaratta', road_name: 'Tone Road', bridge_type: 'Steel truss', construction_year: 1943, span_m: 80, feature_crossed: 'Ovens River', owner_name: 'Wangaratta Rural City Council', owner_category: 'local_govt', latitude: -36.3574, longitude: 146.3165, design_load_std: 'W7.5 / Pre-T44', sri_score: 88.0, risk_tier: 'critical' },
  { bridge_id: 'sample_009', name: 'Murray Valley Highway Bridge Cobram', road_name: 'Murray Valley Highway', bridge_type: 'Concrete beam', construction_year: 1951, span_m: 70, feature_crossed: 'Broken Creek', owner_name: 'Moira Shire Council', owner_category: 'local_govt', latitude: -35.9237, longitude: 145.6481, design_load_std: 'W7.5 / Pre-T44', sri_score: 86.0, risk_tier: 'critical' },
  { bridge_id: 'sample_010', name: 'Hopkins River Bridge Warrnambool', road_name: 'Princes Highway', bridge_type: 'Steel girder', construction_year: 1948, span_m: 92, feature_crossed: 'Hopkins River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -38.3753, longitude: 142.4639, design_load_std: 'W7.5 / Pre-T44', sri_score: 87.5, risk_tier: 'critical' },

  // --- HIGH (sri_score 60-79) ---
  { bridge_id: 'sample_011', name: 'Chandler Highway Bridge', road_name: 'Chandler Highway', bridge_type: 'Prestressed concrete', construction_year: 1969, span_m: 110, feature_crossed: 'Yarra River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.7934, longitude: 145.0076, design_load_std: 'T-44 (1965 Standard)', sri_score: 74.0, risk_tier: 'high' },
  { bridge_id: 'sample_012', name: 'Glenferrie Road Bridge', road_name: 'Glenferrie Road', bridge_type: 'Concrete beam', construction_year: 1972, span_m: 42, feature_crossed: 'Gardiners Creek', owner_name: 'Boroondara City Council', owner_category: 'local_govt', latitude: -37.8626, longitude: 145.0420, design_load_std: 'T-44 (1965 Standard)', sri_score: 70.5, risk_tier: 'high' },
  { bridge_id: 'sample_013', name: 'Latrobe Street Bridge', road_name: 'Latrobe Street', bridge_type: 'Steel girder', construction_year: 1965, span_m: 38, feature_crossed: 'Railway', owner_name: 'City of Melbourne Council', owner_category: 'local_govt', latitude: -37.8095, longitude: 144.9561, design_load_std: 'T-44 (1965 Standard)', sri_score: 72.0, risk_tier: 'high' },
  { bridge_id: 'sample_014', name: 'Geelong Ring Road Barwon Bridge', road_name: 'Geelong Ring Road', bridge_type: 'Prestressed concrete', construction_year: 1970, span_m: 65, feature_crossed: 'Barwon River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -38.1743, longitude: 144.4231, design_load_std: 'T-44 (1965 Standard)', sri_score: 69.0, risk_tier: 'high' },
  { bridge_id: 'sample_015', name: 'Calder Highway Bridge Malmsbury', road_name: 'Calder Highway', bridge_type: 'Concrete arch', construction_year: 1967, span_m: 48, feature_crossed: 'Coliban River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.1802, longitude: 144.3763, design_load_std: 'T-44 (1965 Standard)', sri_score: 68.0, risk_tier: 'high' },
  { bridge_id: 'sample_016', name: 'Goulburn River Bridge Nagambie', road_name: 'Nagambie-Locksley Road', bridge_type: 'Steel truss', construction_year: 1963, span_m: 120, feature_crossed: 'Goulburn River', owner_name: 'Strathbogie Shire Council', owner_category: 'local_govt', latitude: -36.7843, longitude: 145.1552, design_load_std: 'T-44 (1965 Standard)', sri_score: 75.0, risk_tier: 'high' },
  { bridge_id: 'sample_017', name: 'Swan Street Bridge', road_name: 'Swan Street', bridge_type: 'Concrete beam', construction_year: 1968, span_m: 85, feature_crossed: 'Yarra River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.8243, longitude: 144.9832, design_load_std: 'T-44 (1965 Standard)', sri_score: 71.5, risk_tier: 'high' },
  { bridge_id: 'sample_018', name: 'Macedon Road Overpass', road_name: 'Macedon Road', bridge_type: 'Prestressed concrete', construction_year: 1974, span_m: 30, feature_crossed: 'Western Ring Road', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.6523, longitude: 144.8102, design_load_std: 'T-44 (1965 Standard)', sri_score: 63.0, risk_tier: 'high' },
  { bridge_id: 'sample_019', name: 'East Gippsland Highway Tambo River Bridge', road_name: 'Princes Highway East', bridge_type: 'Steel girder', construction_year: 1966, span_m: 95, feature_crossed: 'Tambo River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.6319, longitude: 147.9543, design_load_std: 'T-44 (1965 Standard)', sri_score: 73.0, risk_tier: 'high' },
  { bridge_id: 'sample_020', name: 'Mitchell River Bridge Bairnsdale', road_name: 'Main Street', bridge_type: 'Concrete beam', construction_year: 1971, span_m: 58, feature_crossed: 'Mitchell River', owner_name: 'East Gippsland Shire Council', owner_category: 'local_govt', latitude: -37.8353, longitude: 147.6093, design_load_std: 'T-44 (1965 Standard)', sri_score: 67.0, risk_tier: 'high' },
  { bridge_id: 'sample_021', name: 'Shepparton Bypass Goulburn Bridge', road_name: 'Midland Highway', bridge_type: 'Prestressed concrete', construction_year: 1973, span_m: 78, feature_crossed: 'Goulburn River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -36.3853, longitude: 145.4082, design_load_std: 'T-44 (1965 Standard)', sri_score: 65.5, risk_tier: 'high' },
  { bridge_id: 'sample_022', name: 'Plenty River Bridge Greensborough', road_name: 'Plenty Road', bridge_type: 'Concrete T-beam', construction_year: 1964, span_m: 28, feature_crossed: 'Plenty River', owner_name: 'Banyule City Council', owner_category: 'local_govt', latitude: -37.7025, longitude: 145.1009, design_load_std: 'T-44 (1965 Standard)', sri_score: 70.0, risk_tier: 'high' },
  { bridge_id: 'sample_023', name: 'Werribee River Bridge Werribee', road_name: 'Princes Highway', bridge_type: 'Steel girder', construction_year: 1961, span_m: 55, feature_crossed: 'Werribee River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.9009, longitude: 144.6632, design_load_std: 'T-44 (1965 Standard)', sri_score: 76.5, risk_tier: 'high' },
  { bridge_id: 'sample_024', name: 'Wimmera River Bridge Horsham', road_name: 'Horsham-Natimuk Road', bridge_type: 'Concrete beam', construction_year: 1969, span_m: 45, feature_crossed: 'Wimmera River', owner_name: 'Horsham Rural City Council', owner_category: 'local_govt', latitude: -36.7102, longitude: 142.2023, design_load_std: 'T-44 (1965 Standard)', sri_score: 66.0, risk_tier: 'high' },
  { bridge_id: 'sample_025', name: 'Kiewa River Bridge Wodonga', road_name: 'Lincoln Causeway', bridge_type: 'Prestressed concrete', construction_year: 1975, span_m: 52, feature_crossed: 'Kiewa River', owner_name: 'Wodonga City Council', owner_category: 'local_govt', latitude: -36.1218, longitude: 146.8851, design_load_std: 'T-44 (1965 Standard)', sri_score: 62.0, risk_tier: 'high' },

  // --- MODERATE (sri_score 40-59) ---
  { bridge_id: 'sample_026', name: 'Bolte Bridge', road_name: 'CityLink', bridge_type: 'Cable-stayed', construction_year: 1999, span_m: 300, feature_crossed: 'Yarra River', owner_name: 'Transurban', owner_category: 'toll_road', latitude: -37.8156, longitude: 144.9378, design_load_std: 'AS 1170 Transitional', sri_score: 55.0, risk_tier: 'moderate' },
  { bridge_id: 'sample_027', name: 'Monash Freeway Bridge Tooronga', road_name: 'Monash Freeway', bridge_type: 'Prestressed concrete', construction_year: 1986, span_m: 68, feature_crossed: 'Gardiner Creek', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.8542, longitude: 145.0623, design_load_std: 'Modified T-44', sri_score: 50.0, risk_tier: 'moderate' },
  { bridge_id: 'sample_028', name: 'Tullamarine Freeway Bridge Airport Drive', road_name: 'Tullamarine Freeway', bridge_type: 'Prestressed concrete', construction_year: 1983, span_m: 40, feature_crossed: 'Railway', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.7013, longitude: 144.8813, design_load_std: 'Modified T-44', sri_score: 48.0, risk_tier: 'moderate' },
  { bridge_id: 'sample_029', name: 'Barwon Bridge Geelong', road_name: 'Moorabool Street', bridge_type: 'Concrete arch', construction_year: 1991, span_m: 72, feature_crossed: 'Barwon River', owner_name: 'City of Greater Geelong', owner_category: 'local_govt', latitude: -38.1480, longitude: 144.3602, design_load_std: 'Modified T-44', sri_score: 45.5, risk_tier: 'moderate' },
  { bridge_id: 'sample_030', name: 'Snowy River Bridge Orbost', road_name: 'Princes Highway East', bridge_type: 'Steel girder', construction_year: 1988, span_m: 104, feature_crossed: 'Snowy River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.7055, longitude: 148.4497, design_load_std: 'Modified T-44', sri_score: 47.0, risk_tier: 'moderate' },
  { bridge_id: 'sample_031', name: 'CityLink Burnley Tunnel Portal Bridge', road_name: 'CityLink', bridge_type: 'Prestressed concrete', construction_year: 1999, span_m: 55, feature_crossed: 'Yarra River environs', owner_name: 'Transurban', owner_category: 'toll_road', latitude: -37.8268, longitude: 144.9892, design_load_std: 'AS 1170 Transitional', sri_score: 53.0, risk_tier: 'moderate' },
  { bridge_id: 'sample_032', name: 'Bass Highway Bridge Wonthaggi', road_name: 'Bass Highway', bridge_type: 'Concrete beam', construction_year: 1985, span_m: 32, feature_crossed: 'Bass Creek', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -38.6053, longitude: 145.5912, design_load_std: 'Modified T-44', sri_score: 46.0, risk_tier: 'moderate' },
  { bridge_id: 'sample_033', name: 'Yarra River Bridge Heidelberg', road_name: 'Lower Heidelberg Road', bridge_type: 'Concrete T-beam', construction_year: 1989, span_m: 44, feature_crossed: 'Yarra River', owner_name: 'Banyule City Council', owner_category: 'local_govt', latitude: -37.7611, longitude: 145.0633, design_load_std: 'Modified T-44', sri_score: 44.5, risk_tier: 'moderate' },
  { bridge_id: 'sample_034', name: 'Great Ocean Road Aire River Bridge', road_name: 'Great Ocean Road', bridge_type: 'Concrete beam', construction_year: 1982, span_m: 36, feature_crossed: 'Aire River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -38.7547, longitude: 143.5218, design_load_std: 'Modified T-44', sri_score: 49.0, risk_tier: 'moderate' },
  { bridge_id: 'sample_035', name: 'South Gippsland Highway Bass Bridge', road_name: 'South Gippsland Highway', bridge_type: 'Steel girder', construction_year: 1980, span_m: 50, feature_crossed: 'Bass River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -38.4751, longitude: 145.6163, design_load_std: 'Modified T-44', sri_score: 51.5, risk_tier: 'moderate' },
  { bridge_id: 'sample_036', name: 'Bendigo Creek Bridge', road_name: 'Napier Street', bridge_type: 'Concrete beam', construction_year: 1992, span_m: 24, feature_crossed: 'Bendigo Creek', owner_name: 'City of Greater Bendigo', owner_category: 'local_govt', latitude: -36.7581, longitude: 144.2839, design_load_std: 'AS 1170 Transitional', sri_score: 42.0, risk_tier: 'moderate' },
  { bridge_id: 'sample_037', name: 'Latrobe River Bridge Traralgon', road_name: 'Princes Highway', bridge_type: 'Prestressed concrete', construction_year: 1987, span_m: 62, feature_crossed: 'Latrobe River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -38.2016, longitude: 146.5378, design_load_std: 'Modified T-44', sri_score: 48.5, risk_tier: 'moderate' },
  { bridge_id: 'sample_038', name: 'Loddon River Bridge Bridgewater', road_name: 'Calder Highway', bridge_type: 'Concrete arch', construction_year: 1994, span_m: 40, feature_crossed: 'Loddon River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -36.6008, longitude: 143.9603, design_load_std: 'AS 1170 Transitional', sri_score: 43.0, risk_tier: 'moderate' },
  { bridge_id: 'sample_039', name: 'Frankston Freeway Bridge Seaford', road_name: 'Frankston Freeway', bridge_type: 'Prestressed concrete', construction_year: 1984, span_m: 35, feature_crossed: 'Kananook Creek', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -38.0907, longitude: 145.1327, design_load_std: 'Modified T-44', sri_score: 47.5, risk_tier: 'moderate' },
  { bridge_id: 'sample_040', name: 'Campaspe River Bridge Rochester', road_name: 'McEwen Highway', bridge_type: 'Concrete beam', construction_year: 1990, span_m: 38, feature_crossed: 'Campaspe River', owner_name: 'Campaspe Shire Council', owner_category: 'local_govt', latitude: -36.3677, longitude: 144.7000, design_load_std: 'Modified T-44', sri_score: 44.0, risk_tier: 'moderate' },

  // --- LOW (sri_score < 40) ---
  { bridge_id: 'sample_041', name: 'EastLink Maroondah Highway Bridge', road_name: 'EastLink', bridge_type: 'Prestressed concrete', construction_year: 2008, span_m: 55, feature_crossed: 'Maroondah Highway', owner_name: 'Transurban', owner_category: 'toll_road', latitude: -37.7817, longitude: 145.2318, design_load_std: 'AS 5100 SM1600', sri_score: 22.0, risk_tier: 'low' },
  { bridge_id: 'sample_042', name: 'Peninsula Link Bridge Mornington', road_name: 'Peninsula Link Freeway', bridge_type: 'Prestressed concrete', construction_year: 2012, span_m: 45, feature_crossed: 'Mornington-Tyabb Road', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -38.2205, longitude: 145.1549, design_load_std: 'AS 5100 SM1600', sri_score: 18.0, risk_tier: 'low' },
  { bridge_id: 'sample_043', name: 'West Gate Tunnel Portal Bridge', road_name: 'West Gate Tunnel', bridge_type: 'Prestressed concrete', construction_year: 2023, span_m: 80, feature_crossed: 'Maribyrnong River', owner_name: 'Transurban', owner_category: 'toll_road', latitude: -37.8165, longitude: 144.8712, design_load_std: 'AS 5100 SM1600', sri_score: 12.0, risk_tier: 'low' },
  { bridge_id: 'sample_044', name: 'Mordialloc Creek Bridge Aspendale', road_name: 'Nepean Highway', bridge_type: 'Prestressed concrete', construction_year: 2006, span_m: 28, feature_crossed: 'Mordialloc Creek', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -38.0005, longitude: 145.1015, design_load_std: 'AS 5100 SM1600', sri_score: 24.0, risk_tier: 'low' },
  { bridge_id: 'sample_045', name: 'Hume Freeway Bridge Donnybrook', road_name: 'Hume Freeway', bridge_type: 'Prestressed concrete', construction_year: 2011, span_m: 38, feature_crossed: 'Merri Creek', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.5453, longitude: 145.0123, design_load_std: 'AS 5100 SM1600', sri_score: 19.5, risk_tier: 'low' },
  { bridge_id: 'sample_046', name: 'Ring Road Plenty River Bridge', road_name: 'Metropolitan Ring Road', bridge_type: 'Prestressed concrete', construction_year: 2005, span_m: 42, feature_crossed: 'Plenty River', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.6632, longitude: 145.0543, design_load_std: 'AS 5100 SM1600', sri_score: 25.0, risk_tier: 'low' },
  { bridge_id: 'sample_047', name: 'Hallam Road Overpass', road_name: 'Hallam Road', bridge_type: 'Prestressed concrete', construction_year: 2009, span_m: 30, feature_crossed: 'Princes Freeway', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.9293, longitude: 145.2761, design_load_std: 'AS 5100 SM1600', sri_score: 21.0, risk_tier: 'low' },
  { bridge_id: 'sample_048', name: 'Burnley Tunnel Approach Viaduct', road_name: 'CityLink', bridge_type: 'Prestressed concrete', construction_year: 2000, span_m: 120, feature_crossed: 'Yarra River', owner_name: 'Transurban', owner_category: 'toll_road', latitude: -37.8294, longitude: 145.0034, design_load_std: 'AS 5100 SM1600', sri_score: 35.0, risk_tier: 'low' },
  { bridge_id: 'sample_049', name: 'Pakenham Bypass Cardinia Creek Bridge', road_name: 'Princes Freeway', bridge_type: 'Prestressed concrete', construction_year: 2014, span_m: 50, feature_crossed: 'Cardinia Creek', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -38.0543, longitude: 145.5012, design_load_std: 'AS 5100 SM1600', sri_score: 16.0, risk_tier: 'low' },
  { bridge_id: 'sample_050', name: 'Western Ring Road Skeleton Creek Bridge', road_name: 'Western Ring Road', bridge_type: 'Prestressed concrete', construction_year: 2004, span_m: 33, feature_crossed: 'Skeleton Creek', owner_name: 'VicRoads', owner_category: 'state_govt', latitude: -37.7781, longitude: 144.7634, design_load_std: 'AS 5100 SM1600', sri_score: 28.0, risk_tier: 'low' },
];

// GET /api/admin/seed-sample
router.get('/seed-sample', async (_req: Request, res: Response): Promise<void> => {
  console.log('[admin] seed-sample: inserting sample bridges');

  let inserted = 0;
  let skipped = 0;

  try {
    for (const b of SAMPLE_BRIDGES) {
      const result = await pool.query(
        `INSERT INTO bridges (
          bridge_id, name, road_name, bridge_type, construction_year,
          span_m, feature_crossed, owner_name, owner_category,
          latitude, longitude, design_load_std, sri_score, risk_tier,
          freyssinet_works, data_sources, last_ingested
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13, $14,
          false, ARRAY['sample'], NOW()
        )
        ON CONFLICT (bridge_id) DO UPDATE SET
          name               = EXCLUDED.name,
          road_name          = EXCLUDED.road_name,
          bridge_type        = EXCLUDED.bridge_type,
          construction_year  = EXCLUDED.construction_year,
          span_m             = EXCLUDED.span_m,
          feature_crossed    = EXCLUDED.feature_crossed,
          owner_name         = EXCLUDED.owner_name,
          owner_category     = EXCLUDED.owner_category,
          latitude           = EXCLUDED.latitude,
          longitude          = EXCLUDED.longitude,
          design_load_std    = EXCLUDED.design_load_std,
          sri_score          = EXCLUDED.sri_score,
          risk_tier          = EXCLUDED.risk_tier,
          last_ingested      = NOW()
        RETURNING (xmax = 0) AS is_insert`,
        [
          b.bridge_id, b.name, b.road_name, b.bridge_type, b.construction_year,
          b.span_m, b.feature_crossed, b.owner_name, b.owner_category,
          b.latitude, b.longitude, b.design_load_std, b.sri_score, b.risk_tier,
        ],
      );

      const row = result.rows[0] as { is_insert: boolean } | undefined;
      if (row?.is_insert) inserted++;
      else skipped++;
    }

    console.log(`[admin] seed-sample complete: inserted=${inserted} skipped=${skipped}`);
    res.json({
      success: true,
      inserted,
      skipped,
      total: SAMPLE_BRIDGES.length,
      message: `Seeded ${inserted} new bridges (${skipped} already existed).`,
    });
  } catch (err) {
    console.error('[admin] seed-sample failed:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Fetch a URL following redirects, returning the full body as a Buffer
function fetchUrl(url: string, redirectsLeft = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (redirectsLeft === 0) {
      reject(new Error('Too many redirects'));
      return;
    }
    const mod = url.startsWith('https') ? https : http;
    mod
      .get(url, { headers: { 'User-Agent': 'VicBIP/1.0' } }, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          resolve(fetchUrl(res.headers.location, redirectsLeft - 1));
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

const DTP_CSV_URL =
  'https://opendata.transport.vic.gov.au/dataset/05efb8bc-677e-46f1-b1b1-fa5caff65067/' +
  'resource/8d8b54fe-2515-4b1f-8601-a134b7a88d3c/download/road_bridges.csv';

// Build a stable bridge_id slug from name + road when the CSV has no id
function makeSlug(name: string, road: string | null): string {
  const parts = [name, road].filter(Boolean).join('-');
  return 'dtp_' + parts.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80);
}

// GET /api/admin/seed-dtp
// ?force=true  — DELETE existing DTP rows before re-inserting
router.get('/seed-dtp', async (req: Request, res: Response): Promise<void> => {
  const force = req.query['force'] === 'true';
  console.log(`[admin] seed-dtp: starting (force=${force})`);

  // --- Download ---
  let csvBuffer: Buffer;
  try {
    csvBuffer = await fetchUrl(DTP_CSV_URL);
  } catch (err) {
    console.error('[admin] seed-dtp: download failed', err);
    res.status(502).json({ success: false, error: `CSV download failed: ${String(err)}` });
    return;
  }
  console.log(`[admin] seed-dtp: downloaded ${csvBuffer.length} bytes`);

  // --- Parse ---
  let rows: Record<string, string>[];
  try {
    rows = await new Promise((resolve, reject) => {
      parse(
        csvBuffer,
        { columns: true, skip_empty_lines: true, trim: true, bom: true },
        (err, records: Record<string, string>[]) => {
          if (err) reject(err);
          else resolve(records);
        },
      );
    });
  } catch (err) {
    console.error('[admin] seed-dtp: parse failed', err);
    res.status(500).json({ success: false, error: `CSV parse failed: ${String(err)}` });
    return;
  }

  if (rows.length === 0) {
    res.status(500).json({ success: false, error: 'CSV contained no rows' });
    return;
  }

  // Log actual column names from the first row so we can debug future schema changes
  const rawHeaders = Object.keys(rows[0] ?? {});
  console.log(`[admin] seed-dtp: CSV headers (${rawHeaders.length}): ${rawHeaders.join(' | ')}`);

  // Normalise column names: lowercase, spaces/parens/slashes → underscore, trim trailing _
  const normKey = (k: string) =>
    k.toLowerCase()
      .replace(/[\s()/\\[\]]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

  const normRows = rows.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) out[normKey(k)] = v ?? '';
    return out;
  });

  const normHeaders = Object.keys(normRows[0] ?? {});
  console.log(`[admin] seed-dtp: normalised headers: ${normHeaders.join(' | ')}`);

  // Pick first matching candidate from a row; returns '' if none found
  const pick = (row: Record<string, string>, ...candidates: string[]): string => {
    for (const c of candidates) {
      if (row[c] !== undefined && row[c] !== '') return row[c] as string;
    }
    return '';
  };

  // --- Optional force-delete of existing DTP bridges ---
  if (force) {
    try {
      const del = await pool.query(
        `DELETE FROM bridges WHERE data_sources @> ARRAY['vicroads_dtp']::text[]`
      );
      console.log(`[admin] seed-dtp: force=true — deleted ${del.rowCount} existing DTP rows`);
    } catch (err) {
      console.error('[admin] seed-dtp: force delete failed', err);
      res.status(500).json({ success: false, error: `Force delete failed: ${String(err)}` });
      return;
    }
  }

  // --- Process rows ---
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let skipReasons = { no_latlon: 0, culvert: 0, db_error: 0 };

  for (const row of normRows) {
    // The DTP CSV's first column is "Name" which holds the SN bridge ID (e.g. SN0325)
    // Try all known id column variants
    const rawId = pick(row,
      'name',           // DTP actual — first column contains SN id
      'bridge_id', 'bridge_no', 'structure_id', 'asset_id', 'bms_id', 'id', 'no_',
    );
    // If rawId looks like an SN bridge id (starts with SN / letters+digits), use it;
    // otherwise derive a slug below after we have name/road
    const looksLikeId = /^[A-Za-z]{1,4}\d+/.test(rawId.trim());
    const idFromCsv = looksLikeId ? rawId.trim() : '';

    // The descriptive name is in "bridge type" column in the DTP CSV (confusingly named)
    const bridgeTypeCsv = pick(row,
      'bridge_type',      // normalised "bridge type"
      'structure_type', 'type',
    );
    // Road / location
    const roadName = pick(row,
      'local_road_name', 'road_name', 'nm_road_part', 'road', 'street_name', 'location',
    ) || null;
    // Feature crossed
    const featureCrossed = pick(row,
      'feature_crossed', 'feature', 'crossing', 'waterway',
    ) || null;
    // Year constructed
    const yearStr = pick(row,
      'year_constructed', 'construction_year', 'year_built', 'year', 'built',
    );
    // Span — DTP CSV has no span column; treat as null (no span filter applied)
    const spanStr = pick(row,
      'span_m', 'span__m_', 'length_m', 'bridge_length', 'structure_length',
      'length', 'span', 'total_span_m', 'total_length_m',
    );
    const spanM = spanStr ? parseFloat(spanStr) : null;
    const validSpan = spanM !== null && !isNaN(spanM) && spanM > 0 ? spanM : null;

    // Owner
    const ownerName = pick(row,
      'owner_name', 'owner', 'responsible_authority', 'authority',
      'cd_state_class', 'region_phys',
    ) || null;

    // Coordinates — DTP uses LAT / LONGIT
    const latStr = pick(row, 'lat', 'latitude', 'y_coord', 'y');
    const lonStr = pick(row, 'longit', 'longitude', 'lon', 'lng', 'x_coord', 'x');
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) {
      skipReasons.no_latlon++;
      skipped++;
      continue;
    }

    // Skip culverts — check structure_form and bridge type columns
    const structureForm = pick(row, 'structure_form', 'form').toLowerCase();
    const structureStatus = pick(row, 'structure_status', 'status').toLowerCase();
    if (
      structureForm.includes('culvert') ||
      bridgeTypeCsv.toLowerCase().includes('culvert') ||
      structureStatus.includes('demolished') ||
      structureStatus.includes('removed')
    ) {
      skipReasons.culvert++;
      skipped++;
      continue;
    }

    // Use SN id from CSV if available, otherwise generate a stable slug
    const finalBridgeId = idFromCsv || makeSlug(bridgeTypeCsv || 'bridge', roadName);

    // Descriptive name: prefer feature_crossed + road; fall back to bridge type
    const displayName = [featureCrossed, roadName, bridgeTypeCsv]
      .filter(Boolean)
      .join(' — ') || finalBridgeId;

    const year = yearStr ? parseInt(yearStr, 10) : null;
    const constructionYear = year && !isNaN(year) && year > 1800 && year <= 2030 ? year : null;
    const designLoadStd = inferDesignLoadStd(constructionYear);
    const sriScore = computeBasicSriScore(constructionYear);
    const riskTier = computeRiskTier(sriScore);
    const ownerCategory = inferOwnerCategory(ownerName);

    try {
      const result = await pool.query(
        `INSERT INTO bridges (
          bridge_id, name, road_name, bridge_type, construction_year,
          span_m, feature_crossed, owner_name, owner_category,
          latitude, longitude, design_load_std, sri_score, risk_tier,
          freyssinet_works, data_sources, last_ingested
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
          false, ARRAY['vicroads_dtp'], NOW()
        )
        ON CONFLICT (bridge_id) DO UPDATE SET
          name              = EXCLUDED.name,
          road_name         = EXCLUDED.road_name,
          bridge_type       = EXCLUDED.bridge_type,
          construction_year = EXCLUDED.construction_year,
          span_m            = EXCLUDED.span_m,
          feature_crossed   = EXCLUDED.feature_crossed,
          owner_name        = EXCLUDED.owner_name,
          owner_category    = EXCLUDED.owner_category,
          latitude          = EXCLUDED.latitude,
          longitude         = EXCLUDED.longitude,
          design_load_std   = EXCLUDED.design_load_std,
          sri_score         = EXCLUDED.sri_score,
          risk_tier         = EXCLUDED.risk_tier,
          data_sources      = EXCLUDED.data_sources,
          last_ingested     = NOW()
        RETURNING (xmax = 0) AS is_insert`,
        [
          finalBridgeId, displayName, roadName, bridgeTypeCsv || null, constructionYear,
          validSpan, featureCrossed, ownerName, ownerCategory,
          lat, lon, designLoadStd, sriScore, riskTier,
        ],
      );
      const isInsert = (result.rows[0] as { is_insert: boolean } | undefined)?.is_insert;
      if (isInsert) inserted++; else updated++;
    } catch (err) {
      console.warn(`[admin] seed-dtp: db error row id="${finalBridgeId}": ${String(err)}`);
      skipReasons.db_error++;
      skipped++;
    }
  }

  const total = normRows.length;
  console.log(
    `[admin] seed-dtp complete: inserted=${inserted} updated=${updated} ` +
    `skipped=${skipped} (no_latlon=${skipReasons.no_latlon} culvert=${skipReasons.culvert} ` +
    `db_error=${skipReasons.db_error}) total=${total}`,
  );
  res.json({ success: true, inserted, updated, skipped, skipReasons, total, csvHeaders: rawHeaders });
});

export default router;
