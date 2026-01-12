import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { auth, AuthRequest } from '../middleware/auth';

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = result.rows[0];

  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, tenantId: user.tenant_id },
    process.env.JWT_SECRET!,
    { expiresIn: '24h' }
  );
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, tenantId: user.tenant_id } });
});

router.get('/me', auth, (req: AuthRequest, res) => {
  res.json(req.user);
});

export default router;
