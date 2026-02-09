import { Router } from 'express';
import { auth, adminOnly } from '../middleware/auth';
import {
  GPU_STATUSES,
  listGPUInventory,
  syncGPUInventory,
  getGPUAvailability,
  updateGPUStatus
} from '../services/gpu';

const router = Router();

const allowedStatusFilters = new Set(GPU_STATUSES);
const allowedAdminStatusUpdates = new Set(['available', 'maintenance']);

router.get('/inventory', auth, adminOnly, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const gpuModel = typeof req.query.gpu_model === 'string' ? req.query.gpu_model : undefined;
  const hostName = typeof req.query.host_name === 'string' ? req.query.host_name : undefined;

  if (status && !allowedStatusFilters.has(status as any)) {
    return res.status(400).json({ error: 'Invalid status filter' });
  }

  const data = await listGPUInventory({
    status,
    gpuModel,
    hostName
  });

  res.json(data);
});

router.post('/sync', auth, adminOnly, async (_req, res) => {
  const result = await syncGPUInventory();
  res.json(result);
});

router.get('/availability', auth, adminOnly, async (req, res) => {
  const gpuModel = typeof req.query.gpu_model === 'string' ? req.query.gpu_model : undefined;
  const data = await getGPUAvailability(gpuModel);
  res.json({ data });
});

router.patch('/:id/status', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const status = typeof req.body?.status === 'string' ? req.body.status : '';
  if (!allowedAdminStatusUpdates.has(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const updated = await updateGPUStatus(id, status as any);
  if (!updated) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(updated);
});

export default router;
