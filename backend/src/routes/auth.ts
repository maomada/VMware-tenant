import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../db';
import { auth, AuthRequest } from '../middleware/auth';
import { sendVerificationEmail } from '../services/email';

const router = Router();

router.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email?.endsWith('@leinao.ai')) {
    return res.status(400).json({ error: '仅支持 @leinao.ai 邮箱注册' });
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    return res.status(400).json({ error: '邮箱已注册' });
  }

  const hash = await bcrypt.hash(password, 10);
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const username = email.split('@')[0];

  await pool.query(
    `INSERT INTO users (username, email, password_hash, role, verification_token, verification_expires)
     VALUES ($1, $2, $3, 'user', $4, $5)`,
    [username, email, hash, token, expires]
  );

  await sendVerificationEmail(email, token);
  res.json({ message: '注册成功，请查收验证邮件' });
});

router.get('/verify/:token', async (req, res) => {
  const { token } = req.params;
  const result = await pool.query(
    'SELECT id FROM users WHERE verification_token = $1 AND verification_expires > NOW()',
    [token]
  );

  if (result.rows.length === 0) {
    return res.status(400).json({ error: '验证链接无效或已过期' });
  }

  await pool.query(
    `UPDATE users SET email_verified = TRUE, status = 'active', verification_token = NULL WHERE id = $1`,
    [result.rows[0].id]
  );

  res.json({ message: '邮箱验证成功' });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];

  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }

  if (!user.email_verified) {
    return res.status(401).json({ error: '请先验证邮箱' });
  }

  if (user.status !== 'active') {
    return res.status(401).json({ error: '账户已被禁用' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, email: user.email, role: user.role },
    process.env.JWT_SECRET!,
    { expiresIn: '24h' }
  );
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
});

router.get('/me', auth, (req: AuthRequest, res) => {
  res.json(req.user);
});

export default router;
