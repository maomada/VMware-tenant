import { Router } from 'express';
import bcrypt from 'bcrypt';
import { pool } from '../db';
import { auth, adminOnly } from '../middleware/auth';

const router = Router();

// 用户管理
router.get('/users', auth, adminOnly, async (req, res) => {
  const result = await pool.query(
    'SELECT id, username, email, role, email_verified, status, created_at FROM users ORDER BY id'
  );
  res.json(result.rows);
});

router.put('/users/:id/password', auth, adminOnly, async (req, res) => {
  const { password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
  res.json({ success: true });
});

router.put('/users/:id/status', auth, adminOnly, async (req, res) => {
  const { status } = req.body;
  await pool.query('UPDATE users SET status = $1 WHERE id = $2', [status, req.params.id]);
  res.json({ success: true });
});

router.delete('/users/:id', auth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM users WHERE id = $1 AND role != $2', [req.params.id, 'admin']);
  res.json({ success: true });
});

// 项目管理
router.get('/projects', auth, adminOnly, async (req, res) => {
  const result = await pool.query(
    `SELECT p.*, u.username, u.email as user_email,
     (SELECT COUNT(*) FROM virtual_machines WHERE project_id = p.id) as vm_count
     FROM projects p LEFT JOIN users u ON p.user_id = u.id ORDER BY p.id`
  );
  res.json(result.rows);
});

router.put('/projects/:id/user', auth, adminOnly, async (req, res) => {
  const { userId } = req.body;
  await pool.query('UPDATE projects SET user_id = $1 WHERE id = $2', [userId, req.params.id]);
  res.json({ success: true });
});

// VM 管理
router.get('/vms', auth, adminOnly, async (req, res) => {
  const result = await pool.query(
    `SELECT vm.*, p.name as project_name, u.username
     FROM virtual_machines vm
     LEFT JOIN projects p ON vm.project_id = p.id
     LEFT JOIN users u ON p.user_id = u.id
     ORDER BY vm.id`
  );
  res.json(result.rows);
});

router.put('/vms/:id/project', auth, adminOnly, async (req, res) => {
  const { projectId } = req.body;
  await pool.query('UPDATE virtual_machines SET project_id = $1 WHERE id = $2', [projectId, req.params.id]);
  res.json({ success: true });
});

// 价格管理
router.get('/pricing', auth, adminOnly, async (req, res) => {
  const result = await pool.query('SELECT * FROM pricing_config ORDER BY resource_type');
  res.json(result.rows);
});

router.put('/pricing', auth, adminOnly, async (req, res) => {
  const { prices } = req.body;
  for (const p of prices) {
    await pool.query('UPDATE pricing_config SET unit_price = $1 WHERE resource_type = $2', [p.unitPrice, p.resourceType]);
  }
  res.json({ success: true });
});

export default router;
