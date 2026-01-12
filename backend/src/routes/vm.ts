import { Router } from 'express';
import { pool } from '../db';
import { auth, adminOnly, AuthRequest } from '../middleware/auth';
import { vsphere } from '../services/vsphere';

const router = Router();

router.get('/', auth, async (req: AuthRequest, res) => {
  const isAdmin = req.user?.role === 'admin';
  const query = isAdmin
    ? 'SELECT * FROM virtual_machines ORDER BY id'
    : 'SELECT * FROM virtual_machines WHERE tenant_id = $1 ORDER BY id';
  const params = isAdmin ? [] : [req.user?.tenantId];
  const result = await pool.query(query, params);
  res.json(result.rows);
});

router.post('/', auth, adminOnly, async (req, res) => {
  const { tenantId, vcenterVmId, name, cpuCores, memoryGb, storageGb, gpuCount } = req.body;
  const result = await pool.query(
    `INSERT INTO virtual_machines (tenant_id, vcenter_vm_id, name, cpu_cores, memory_gb, storage_gb, gpu_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [tenantId, vcenterVmId, name, cpuCores, memoryGb, storageGb, gpuCount || 0]
  );
  res.json(result.rows[0]);
});

router.get('/:id', auth, async (req: AuthRequest, res) => {
  const result = await pool.query('SELECT * FROM virtual_machines WHERE id = $1', [req.params.id]);
  const vm = result.rows[0];
  if (!vm) return res.status(404).json({ error: 'Not found' });
  if (req.user?.role !== 'admin' && vm.tenant_id !== req.user?.tenantId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(vm);
});

router.post('/:id/power-on', auth, async (req: AuthRequest, res) => {
  const result = await pool.query('SELECT * FROM virtual_machines WHERE id = $1', [req.params.id]);
  const vm = result.rows[0];
  if (!vm) return res.status(404).json({ error: 'Not found' });
  if (req.user?.role !== 'admin' && vm.tenant_id !== req.user?.tenantId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    await vsphere.powerOn(vm.vcenter_vm_id);
    await pool.query('UPDATE virtual_machines SET status = $1 WHERE id = $2', ['poweredOn', req.params.id]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/power-off', auth, async (req: AuthRequest, res) => {
  const result = await pool.query('SELECT * FROM virtual_machines WHERE id = $1', [req.params.id]);
  const vm = result.rows[0];
  if (!vm) return res.status(404).json({ error: 'Not found' });
  if (req.user?.role !== 'admin' && vm.tenant_id !== req.user?.tenantId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    await vsphere.powerOff(vm.vcenter_vm_id);
    await pool.query('UPDATE virtual_machines SET status = $1 WHERE id = $2', ['poweredOff', req.params.id]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/sync/vcenter', auth, adminOnly, async (req, res) => {
  try {
    const vms = await vsphere.listVMs();
    res.json(vms);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
