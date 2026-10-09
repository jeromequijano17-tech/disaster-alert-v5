const express = require('express');
const pool = require('../../config/db');
const { requireRole } = require('../middleware/auth');
const { logActivity } = require('../middleware/audit');

const router = express.Router();
const RISK_LEVELS = ['low', 'moderate', 'high', 'critical'];

// Public: barangay list with risk levels (Disaster Risk Dashboard data)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.id, b.name, b.risk_level, b.latitude, b.longitude, b.population,
              (SELECT COUNT(*) FROM incidents i WHERE i.barangay_id = b.id AND i.status <> 'resolved') AS open_incidents,
              (SELECT COALESCE(SUM(e.occupants),0) FROM evacuation_centers e WHERE e.barangay_id = b.id) AS evacuees
       FROM barangays b
       ORDER BY FIELD(b.risk_level,'critical','high','moderate','low'), b.name`);
    const summary = { critical: 0, high: 0, moderate: 0, low: 0 };
    for (const r of rows) summary[r.risk_level]++;
    res.json({ barangays: rows, summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load barangays.' });
  }
});

// Update risk level / coordinates (admin)
router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { risk_level, latitude, longitude, population } = req.body;
    if (risk_level && !RISK_LEVELS.includes(risk_level)) {
      return res.status(400).json({ error: 'Invalid risk level.' });
    }
    const [rows] = await pool.query('SELECT id FROM barangays WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Barangay not found.' });
    await pool.query(
      `UPDATE barangays SET
         risk_level = COALESCE(?, risk_level),
         latitude = COALESCE(?, latitude),
         longitude = COALESCE(?, longitude),
         population = COALESCE(?, population)
       WHERE id = ?`,
      [risk_level || null, latitude !== undefined ? Number(latitude) : null,
       longitude !== undefined ? Number(longitude) : null,
       population !== undefined ? Number(population) : null, req.params.id]);
    await logActivity(req, 'barangay.updated', 'barangay', req.params.id, `risk=${risk_level || 'unchanged'}`);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update barangay.' });
  }
});

router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, risk_level, latitude, longitude, population } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    const [result] = await pool.query(
      'INSERT INTO barangays (name, risk_level, latitude, longitude, population) VALUES (?,?,?,?,?)',
      [name.trim(), RISK_LEVELS.includes(risk_level) ? risk_level : 'low',
       latitude != null ? Number(latitude) : null,
       longitude != null ? Number(longitude) : null,
       Number(population) || 0]);
    await logActivity(req, 'barangay.created', 'barangay', result.insertId, name);
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Barangay name already exists.' });
    res.status(500).json({ error: 'Failed to create barangay.' });
  }
});

module.exports = router;
