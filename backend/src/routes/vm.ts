import { Router } from 'express';
import { pool } from '../db';
import { auth, AuthRequest } from '../middleware/auth';
import { vsphere } from '../services/vsphere';

const router = Router();

router.get('/', auth, async (req: AuthRequest, res) => {
  const { projectId } = req.query;
  const isAdmin = req.user?.role === 'admin';

  let query: string;
  let params: any[];

  if (isAdmin) {
    query = projectId
      ? 'SELECT vm.*, p.name as project_name FROM virtual_machines vm LEFT JOIN projects p ON vm.project_id = p.id WHERE vm.project_id = $1 ORDER BY vm.id'
      : 'SELECT vm.*, p.name as project_name FROM virtual_machines vm LEFT JOIN projects p ON vm.project_id = p.id ORDER BY vm.id';
    params = projectId ? [projectId] : [];
  } else {
    query = projectId
      ? `SELECT vm.*, p.name as project_name FROM virtual_machines vm
         JOIN projects p ON vm.project_id = p.id
         WHERE p.user_id = $1 AND vm.project_id = $2 ORDER BY vm.id`
      : `SELECT vm.*, p.name as project_name FROM virtual_machines vm
         JOIN projects p ON vm.project_id = p.id
         WHERE p.user_id = $1 ORDER BY vm.id`;
    params = projectId ? [req.user?.id, projectId] : [req.user?.id];
  }

  const result = await pool.query(query, params);
  res.json(result.rows);
});

router.get('/:id', auth, async (req: AuthRequest, res) => {
  const result = await pool.query(
    `SELECT vm.*, p.user_id FROM virtual_machines vm
     LEFT JOIN projects p ON vm.project_id = p.id WHERE vm.id = $1`,
    [req.params.id]
  );
  const vm = result.rows[0];
  if (!vm) return res.status(404).json({ error: 'Not found' });
  if (req.user?.role !== 'admin' && vm.user_id !== req.user?.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(vm);
});

router.post('/:id/power-on', auth, async (req: AuthRequest, res) => {
  const result = await pool.query(
    `SELECT vm.*, p.user_id FROM virtual_machines vm
     LEFT JOIN projects p ON vm.project_id = p.id WHERE vm.id = $1`,
    [req.params.id]
  );
  const vm = result.rows[0];
  if (!vm) return res.status(404).json({ error: 'Not found' });
  if (req.user?.role !== 'admin' && vm.user_id !== req.user?.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    await vsphere.powerOn(vm.vcenter_vm_id);
    await pool.query('UPDATE virtual_machines SET status = $1 WHERE id = $2', ['POWERED_ON', req.params.id]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/power-off', auth, async (req: AuthRequest, res) => {
  const result = await pool.query(
    `SELECT vm.*, p.user_id FROM virtual_machines vm
     LEFT JOIN projects p ON vm.project_id = p.id WHERE vm.id = $1`,
    [req.params.id]
  );
  const vm = result.rows[0];
  if (!vm) return res.status(404).json({ error: 'Not found' });
  if (req.user?.role !== 'admin' && vm.user_id !== req.user?.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    await vsphere.powerOff(vm.vcenter_vm_id);
    await pool.query('UPDATE virtual_machines SET status = $1 WHERE id = $2', ['POWERED_OFF', req.params.id]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
