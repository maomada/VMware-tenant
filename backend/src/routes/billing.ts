import { Router } from 'express';
import { pool } from '../db';
import { auth, adminOnly, AuthRequest } from '../middleware/auth';
import { calculateBill, generateCSV } from '../services/billing';

const router = Router();

router.get('/bills', auth, async (req: AuthRequest, res) => {
  const isAdmin = req.user?.role === 'admin';
  const query = isAdmin
    ? 'SELECT * FROM bills ORDER BY billing_period DESC'
    : 'SELECT * FROM bills WHERE tenant_id = $1 ORDER BY billing_period DESC';
  const params = isAdmin ? [] : [req.user?.tenantId];
  const result = await pool.query(query, params);
  res.json(result.rows);
});

router.get('/bills/:id', auth, async (req: AuthRequest, res) => {
  const result = await pool.query('SELECT * FROM bills WHERE id = $1', [req.params.id]);
  const bill = result.rows[0];
  if (!bill) return res.status(404).json({ error: 'Not found' });
  if (req.user?.role !== 'admin' && bill.tenant_id !== req.user?.tenantId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(bill);
});

router.get('/bills/:id/export', auth, async (req: AuthRequest, res) => {
  const result = await pool.query('SELECT * FROM bills WHERE id = $1', [req.params.id]);
  const bill = result.rows[0];
  if (!bill) return res.status(404).json({ error: 'Not found' });
  if (req.user?.role !== 'admin' && bill.tenant_id !== req.user?.tenantId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=bill-${bill.billing_period}.csv`);
  res.send('\uFEFF' + generateCSV(bill));
});

router.post('/generate', auth, adminOnly, async (req, res) => {
  const { tenantId, period } = req.body;
  await calculateBill(tenantId, period);
  res.json({ success: true });
});

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

router.get('/usage', auth, async (req: AuthRequest, res) => {
  const { startDate, endDate } = req.query;
  const isAdmin = req.user?.role === 'admin';
  const query = isAdmin
    ? 'SELECT * FROM usage_records WHERE record_date BETWEEN $1 AND $2'
    : 'SELECT * FROM usage_records WHERE tenant_id = $3 AND record_date BETWEEN $1 AND $2';
  const params = isAdmin ? [startDate, endDate] : [startDate, endDate, req.user?.tenantId];
  const result = await pool.query(query, params);
  res.json(result.rows);
});

export default router;
