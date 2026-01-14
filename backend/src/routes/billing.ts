import { Router } from 'express';
import { pool } from '../db';
import { auth, AuthRequest } from '../middleware/auth';
import { calculateBill, generateCSV, recordUsage, syncVMConfigs, getUsageDetails } from '../services/billing';

const router = Router();

router.get('/bills', auth, async (req: AuthRequest, res) => {
  const isAdmin = req.user?.role === 'admin';
  const query = isAdmin
    ? 'SELECT * FROM bills ORDER BY billing_period DESC'
    : 'SELECT * FROM bills WHERE user_id = $1 ORDER BY billing_period DESC';
  const params = isAdmin ? [] : [req.user?.id];
  const result = await pool.query(query, params);
  res.json(result.rows);
});

router.get('/bills/:id', auth, async (req: AuthRequest, res) => {
  const result = await pool.query('SELECT * FROM bills WHERE id = $1', [req.params.id]);
  const bill = result.rows[0];
  if (!bill) return res.status(404).json({ error: 'Not found' });
  if (req.user?.role !== 'admin' && bill.user_id !== req.user?.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(bill);
});

router.get('/bills/:id/export', auth, async (req: AuthRequest, res) => {
  const result = await pool.query('SELECT * FROM bills WHERE id = $1', [req.params.id]);
  const bill = result.rows[0];
  if (!bill) return res.status(404).json({ error: 'Not found' });
  if (req.user?.role !== 'admin' && bill.user_id !== req.user?.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=bill-${bill.billing_period}.csv`);
  res.send('\uFEFF' + generateCSV(bill));
});

// 获取使用明细
router.get('/usage', auth, async (req: AuthRequest, res) => {
  const period = req.query.period as string || new Date().toISOString().slice(0, 7);
  const details = await getUsageDetails(req.user!.id, period);
  res.json(details);
});

// 生成账单 (admin only)
router.post('/generate', auth, async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { userId, period } = req.body;
  if (!userId || !period) {
    return res.status(400).json({ error: '缺少 userId 或 period 参数' });
  }
  await calculateBill(userId, period);
  res.json({ message: '账单生成成功' });
});

// 手动刷新账单（同步 VM 配置 + 记录使用量）
router.post('/refresh', auth, async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await syncVMConfigs();
  await recordUsage();
  res.json({ message: '账单数据已刷新' });
});

export default router;
