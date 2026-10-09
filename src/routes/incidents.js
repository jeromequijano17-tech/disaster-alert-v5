const express = require('express');
const pool = require('../../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../middleware/audit');
const { incidentUpload } = require('../middleware/upload');
const { haversineMeters } = require('../services/pushService');

const router = express.Router();

const STATUSES = ['reported', 'verified', 'responding', 'resolved'];
const INCIDENT_TYPES = ['fire', 'flood', 'landslide', 'medical', 'accident', 'storm_damage', 'earthquake', 'other'];

// Find the nearest barangay to a coordinate (used to auto-tag incidents)
async function nearestBarangay(lat, lng) {
  const [rows] = await pool.query(
    'SELECT id, name, latitude, longitude FROM barangays WHERE latitude IS NOT NULL');
  let best = null;
  let bestDist = Infinity;
  for (const b of rows) {
    const d = haversineMeters(lat, lng, Number(b.latitude), Number(b.longitude));
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return bestDist <= 15000 ? best : null; // only auto-tag within 15 km
}

// ---------- Public ----------

// Map + list feed. Verified and beyond are public; freshly reported ones
// appear publicly only with their (unverified) status after moderation, so
// include all but let the client style them.
router.get('/', async (req, res) => {
  try {
    const params = [];
    let where = '';
    if (req.query.status && STATUSES.includes(req.query.status)) {
      where = 'WHERE i.status = ?';
      params.push(req.query.status);
    }
    const [rows] = await pool.query(
      `SELECT i.id, i.incident_type, i.description, i.latitude, i.longitude, i.address,
              i.photo_path, i.status, i.created_at, i.updated_at,
              b.name AS barangay, t.name AS assigned_team
       FROM incidents i
       LEFT JOIN barangays b ON b.id = i.barangay_id
       LEFT JOIN rescue_teams t ON t.id = i.assigned_team_id
       ${where}
       ORDER BY i.created_at DESC LIMIT 200`, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load incidents.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*, b.name AS barangay, u.name AS reporter, t.name AS assigned_team
       FROM incidents i
       LEFT JOIN barangays b ON b.id = i.barangay_id
       LEFT JOIN users u ON u.id = i.reporter_id
       LEFT JOIN rescue_teams t ON t.id = i.assigned_team_id
       WHERE i.id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Incident not found.' });
    const [history] = await pool.query(
      `SELECT h.status, h.note, h.created_at, u.name AS changed_by
       FROM incident_history h LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.incident_id = ? ORDER BY h.id`, [req.params.id]);
    res.json({ ...rows[0], history });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load incident.' });
  }
});

// ---------- Reporting (any logged-in user, including residents) ----------

router.post('/', requireAuth, incidentUpload.single('photo'), async (req, res) => {
  try {
    const { incident_type, description, latitude, longitude, address } = req.body;
    if (!description || !String(description).trim()) {
      return res.status(400).json({ error: 'Description is required.' });
    }
    if (incident_type && !INCIDENT_TYPES.includes(incident_type)) {
      return res.status(400).json({ error: 'Invalid incident type.' });
    }
    let barangay_id = req.body.barangay_id ? Number(req.body.barangay_id) : null;
    const lat = latitude ? Number(latitude) : null;
    const lng = longitude ? Number(longitude) : null;
    if (!barangay_id && lat != null && lng != null) {
      const nb = await nearestBarangay(lat, lng);
      if (nb) barangay_id = nb.id;
    }
    const photoPath = req.file ? `/uploads/incidents/${req.file.filename}` : null;
    const [result] = await pool.query(
      `INSERT INTO incidents (reporter_id, incident_type, description, latitude, longitude, address, photo_path, barangay_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [req.session.user.id, INCIDENT_TYPES.includes(incident_type) ? incident_type : 'other',
       String(description).trim(), lat, lng, address || null, photoPath, barangay_id]);
    await pool.query(
      'INSERT INTO incident_history (incident_id, status, changed_by, note) VALUES (?,?,?,?)',
      [result.insertId, 'reported', req.session.user.id, 'Report submitted']);
    await logActivity(req, 'incident.reported', 'incident', result.insertId, incident_type || 'other');
    res.status(201).json({ id: result.insertId, status: 'reported' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit report.' });
  }
});

// My reports (tracking for the resident who filed them)
router.get('/mine/list', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.id, i.incident_type, i.description, i.status, i.photo_path, i.created_at, i.updated_at,
              b.name AS barangay
       FROM incidents i LEFT JOIN barangays b ON b.id = i.barangay_id
       WHERE i.reporter_id = ? ORDER BY i.created_at DESC`, [req.session.user.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load your reports.' });
  }
});

// ---------- Status tracking (staff roles) ----------

// Reported -> Verified -> Responding -> Resolved
router.post('/:id/status', requireRole('admin', 'barangay_official', 'responder'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { status, note, team_id } = req.body;
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Use: reported, verified, responding, resolved.' });
    }
    const [rows] = await conn.query('SELECT * FROM incidents WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Incident not found.' });
    const incident = rows[0];

    await conn.beginTransaction();
    await conn.query('UPDATE incidents SET status = ? WHERE id = ?', [status, incident.id]);
    await conn.query(
      'INSERT INTO incident_history (incident_id, status, changed_by, note) VALUES (?,?,?,?)',
      [incident.id, status, req.session.user.id, note || null]);

    // Dispatching a rescue team when moving to 'responding'
    if (status === 'responding' && team_id) {
      const [teams] = await conn.query('SELECT * FROM rescue_teams WHERE id = ?', [team_id]);
      if (!teams.length) {
        await conn.rollback();
        return res.status(400).json({ error: 'Rescue team not found.' });
      }
      await conn.query('UPDATE incidents SET assigned_team_id = ? WHERE id = ?', [team_id, incident.id]);
      await conn.query("UPDATE rescue_teams SET status = 'dispatched' WHERE id = ?", [team_id]);
      await conn.query(
        'INSERT INTO team_dispatches (team_id, incident_id, dispatched_by) VALUES (?,?,?)',
        [team_id, incident.id, req.session.user.id]);
    }
    // Release the team when resolved
    if (status === 'resolved' && incident.assigned_team_id) {
      await conn.query("UPDATE rescue_teams SET status = 'available' WHERE id = ?", [incident.assigned_team_id]);
      await conn.query(
        'UPDATE team_dispatches SET returned_at = NOW() WHERE incident_id = ? AND returned_at IS NULL',
        [incident.id]);
    }
    await conn.commit();
    await logActivity(req, `incident.status.${status}`, 'incident', incident.id, note || '');
    res.json({ ok: true, status });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Failed to update incident status.' });
  } finally {
    conn.release();
  }
});

module.exports = router;
