import { Router } from 'express';
import { pool } from '../db';
import { auth, adminOnly, AuthRequest } from '../middleware/auth';
import bcrypt from 'bcrypt';

const router = Router();

router.get('/', auth, adminOnly, async (req, res) => {
  const result = await pool.query('SELECT * FROM tenants ORDER BY id');
  res.json(result.rows);
});

router.post('/', auth, adminOnly, async (req, res) => {
  const { name, contactEmail } = req.body;
  const result = await pool.query(
    'INSERT INTO tenants (name, contact_email) VALUES ($1, $2) RETURNING *',
    [name, contactEmail]
  );
  res.json(result.rows[0]);
});

router.get('/:id', auth, adminOnly, async (req, res) => {
  const result = await pool.query('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(result.rows[0]);
});

router.put('/:id', auth, adminOnly, async (req, res) => {
  const { name, contactEmail, status } = req.body;
  const result = await pool.query(
    'UPDATE tenants SET name = $1, contact_email = $2, status = $3 WHERE id = $4 RETURNING *',
    [name, contactEmail, status, req.params.id]
  );
  res.json(result.rows[0]);
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM tenants WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

router.get('/:id/users', auth, adminOnly, async (req, res) => {
  const result = await pool.query('SELECT id, username, role, created_at FROM users WHERE tenant_id = $1', [req.params.id]);
  res.json(result.rows);
});

router.post('/:id/users', auth, adminOnly, async (req, res) => {
  const { username, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    'INSERT INTO users (username, password_hash, role, tenant_id) VALUES ($1, $2, $3, $4) RETURNING id, username, role',
    [username, hash, 'tenant', req.params.id]
  );
  res.json(result.rows[0]);
});

export default router;
