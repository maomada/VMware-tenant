import { Router, Response } from 'express';
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
const isDevelopment = process.env.NODE_ENV === 'development';

const sendGPUError = (res: Response, err: unknown, context: string) => {
  console.error(`[GPU] ${context} error:`, err);
  const message = err instanceof Error ? err.message : 'Internal server error';
  const payload: { error: string; stack?: string } = { error: message };
  if (isDevelopment && err instanceof Error && err.stack) {
    payload.stack = err.stack;
  }
  res.status(500).json(payload);
};

router.get('/inventory', auth, adminOnly, async (req, res) => {
  try {
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
  } catch (err) {
    return sendGPUError(res, err, 'list inventory');
  }
});

router.post('/sync', auth, adminOnly, async (_req, res) => {
  try {
    const result = await syncGPUInventory();
    res.json(result);
  } catch (err) {
    return sendGPUError(res, err, 'sync');
  }
});

router.get('/availability', auth, adminOnly, async (req, res) => {
  try {
    const gpuModel = typeof req.query.gpu_model === 'string' ? req.query.gpu_model : undefined;
    const data = await getGPUAvailability(gpuModel);
    res.json({ data });
  } catch (err) {
    return sendGPUError(res, err, 'availability');
  }
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

  try {
    const updated = await updateGPUStatus(id, status as any);
    if (!updated) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(updated);
  } catch (err) {
    return sendGPUError(res, err, 'update status');
  }
});

export default router;
