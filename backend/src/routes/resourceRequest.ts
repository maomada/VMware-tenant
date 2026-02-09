import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { auth, adminOnly, AuthRequest } from '../middleware/auth';
import { executeDeployment } from '../services/deployment';

const router = Router();
const adminRouter = Router();

const allowedStatuses = new Set(['pending', 'approved', 'deploying', 'deployed', 'rejected', 'failed']);
const allowedEnvironments = new Set(['development', 'testing', 'production']);

const idSchema = z.coerce.number().int().positive();
const optionalIdSchema = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  z.coerce.number().int().positive().optional()
);

const vmItemSchema = z.object({
  template_name: z.string().min(1).max(100),
  cpu_cores: z.coerce.number().int().min(1).max(64),
  memory_gb: z.coerce.number().int().min(1).max(512),
  disk_gb: z.coerce.number().int().min(1).max(4096),
  requires_gpu: z.boolean(),
  gpu_model: z.string().min(1).max(100).optional(),
  gpu_count: z.coerce.number().int().min(0).max(8).optional()
}).superRefine((val, ctx) => {
  if (val.requires_gpu) {
    if (!val.gpu_model) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['gpu_model'], message: 'gpu_model is required' });
    }
    if (!val.gpu_count || val.gpu_count < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['gpu_count'], message: 'gpu_count must be between 1 and 8' });
    }
  } else {
    if (val.gpu_model) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['gpu_model'], message: 'gpu_model must be empty when GPU is not required' });
    }
    if (val.gpu_count && val.gpu_count !== 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['gpu_count'], message: 'gpu_count must be 0 when GPU is not required' });
    }
  }
});

const createRequestSchema = z.object({
  purpose: z.string().min(10).max(500),
  environment: z.enum(['development', 'testing', 'production']),
  project_id: optionalIdSchema,
  vm_items: z.array(vmItemSchema).min(1).max(10)
});

const approveSchema = z.object({
  admin_notes: z.string().max(2000).optional()
});

const rejectSchema = z.object({
  rejection_reason: z.string().min(1).max(2000),
  admin_notes: z.string().max(2000).optional()
});

const deploySchema = z.object({
  vm_configs: z.array(z.object({
    vm_item_id: z.coerce.number().int().positive(),
    vm_name: z.string().min(1).max(100).optional(),
    template_name: z.string().min(1).max(100).optional(),
    datastore: z.string().min(1).max(200).optional(),
    vcenter_folder: z.string().max(200).optional()
  })).optional()
});

const parseId = (value: unknown, res: any) => {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  return parsed.data;
};

const parseListParams = (req: AuthRequest, res: any) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const environment = typeof req.query.environment === 'string' ? req.query.environment : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));

  if (status && !allowedStatuses.has(status)) {
    res.status(400).json({ error: 'Invalid status filter' });
    return null;
  }
  if (environment && !allowedEnvironments.has(environment)) {
    res.status(400).json({ error: 'Invalid environment filter' });
    return null;
  }

  return { status, environment, search, page, limit };
};

router.post('/', auth, async (req: AuthRequest, res) => {
  const parsed = createRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request payload' });
  }

  const payload = parsed.data;
  const projectId = payload.project_id ?? null;

  if (projectId) {
    const project = await pool.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [projectId, req.user?.id]);
    if (!project.rows[0]) {
      return res.status(404).json({ error: 'Project not found' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const numberRes = await client.query('SELECT generate_request_number() AS request_number');
    const requestNumber = numberRes.rows[0]?.request_number;

    const requestRes = await client.query(
      `INSERT INTO resource_requests (request_number, user_id, project_id, purpose, environment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, request_number, status, created_at`,
      [requestNumber, req.user?.id, projectId, payload.purpose, payload.environment]
    );

    const request = requestRes.rows[0];
    const vmItems: any[] = [];

    for (const item of payload.vm_items) {
      const gpuCount = item.requires_gpu ? item.gpu_count ?? 0 : 0;
      const gpuModel = item.requires_gpu ? item.gpu_model : null;
      const vmRes = await client.query(
        `INSERT INTO vm_request_items (request_id, template_name, cpu_cores, memory_gb, disk_gb, requires_gpu, gpu_model, gpu_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, template_name, cpu_cores, memory_gb, disk_gb, requires_gpu, gpu_model, gpu_count`,
        [request.id, item.template_name, item.cpu_cores, item.memory_gb, item.disk_gb, item.requires_gpu, gpuModel, gpuCount]
      );
      vmItems.push(vmRes.rows[0]);
    }

    await client.query('COMMIT');
    res.status(201).json({
      ...request,
      vm_items: vmItems
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.get('/', auth, async (req: AuthRequest, res) => {
  const filters = parseListParams(req, res);
  if (!filters) return;

  const { status, environment, search, page, limit } = filters;
  const conditions = ['rr.user_id = $1'];
  const params: any[] = [req.user?.id];

  if (status) {
    params.push(status);
    conditions.push(`rr.status = $${params.length}`);
  }
  if (environment) {
    params.push(environment);
    conditions.push(`rr.environment = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(rr.request_number ILIKE $${params.length} OR rr.purpose ILIKE $${params.length})`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM resource_requests rr ${whereClause}`,
    params
  );

  params.push(limit);
  params.push((page - 1) * limit);

  const listRes = await pool.query(
    `SELECT rr.id, rr.request_number, rr.user_id, u.username AS user_name, rr.purpose, rr.environment,
            rr.status, rr.created_at, rr.approved_at, rr.deployed_at,
            (SELECT COUNT(*) FROM vm_request_items v WHERE v.request_id = rr.id) AS vm_count
     FROM resource_requests rr
     JOIN users u ON rr.user_id = u.id
     ${whereClause}
     ORDER BY rr.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    data: listRes.rows,
    pagination: {
      total: countRes.rows[0]?.total || 0,
      page,
      limit,
      total_pages: Math.ceil((countRes.rows[0]?.total || 0) / limit) || 1
    }
  });
});

router.get('/:id', auth, async (req: AuthRequest, res) => {
  const requestId = parseId(req.params.id, res);
  if (!requestId) return;

  const isAdmin = req.user?.role === 'admin';
  const params: any[] = [requestId];
  let whereClause = 'WHERE rr.id = $1';
  if (!isAdmin) {
    params.push(req.user?.id);
    whereClause += ` AND rr.user_id = $2`;
  }

  const requestRes = await pool.query(
    `SELECT rr.*, u.username AS user_name, p.name AS project_name, approver.username AS approver_name
     FROM resource_requests rr
     LEFT JOIN users u ON rr.user_id = u.id
     LEFT JOIN projects p ON rr.project_id = p.id
     LEFT JOIN users approver ON rr.approved_by = approver.id
     ${whereClause}`,
    params
  );

  if (!requestRes.rows[0]) {
    return res.status(404).json({ error: 'Not found' });
  }

  const itemsRes = await pool.query(
    `SELECT id, vm_name, template_name, cpu_cores, memory_gb, disk_gb, requires_gpu,
            gpu_model, gpu_count, gpu_assigned_ids, ip_address, gateway, dns_servers,
            deployment_status, deployment_error, deployed_at
     FROM vm_request_items
     WHERE request_id = $1
     ORDER BY id`,
    [requestId]
  );

  res.json({
    ...requestRes.rows[0],
    vm_items: itemsRes.rows
  });
});

router.delete('/:id', auth, async (req: AuthRequest, res) => {
  const requestId = parseId(req.params.id, res);
  if (!requestId) return;

  const existing = await pool.query(
    'SELECT status FROM resource_requests WHERE id = $1 AND user_id = $2',
    [requestId, req.user?.id]
  );

  if (!existing.rows[0]) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (existing.rows[0].status !== 'pending') {
    return res.status(409).json({ error: 'Only pending requests can be deleted' });
  }

  await pool.query('DELETE FROM resource_requests WHERE id = $1 AND user_id = $2', [requestId, req.user?.id]);
  res.json({ success: true });
});

adminRouter.get('/', auth, adminOnly, async (req: AuthRequest, res) => {
  const filters = parseListParams(req, res);
  if (!filters) return;

  const { status, environment, search, page, limit } = filters;
  const conditions: string[] = [];
  const params: any[] = [];

  if (status) {
    params.push(status);
    conditions.push(`rr.status = $${params.length}`);
  }
  if (environment) {
    params.push(environment);
    conditions.push(`rr.environment = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(rr.request_number ILIKE $${params.length} OR rr.purpose ILIKE $${params.length})`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM resource_requests rr ${whereClause}`,
    params
  );

  params.push(limit);
  params.push((page - 1) * limit);

  const listRes = await pool.query(
    `SELECT rr.id, rr.request_number, rr.user_id, u.username AS user_name, rr.purpose, rr.environment,
            rr.status, rr.created_at, rr.approved_at, rr.deployed_at,
            (SELECT COUNT(*) FROM vm_request_items v WHERE v.request_id = rr.id) AS vm_count
     FROM resource_requests rr
     JOIN users u ON rr.user_id = u.id
     ${whereClause}
     ORDER BY rr.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    data: listRes.rows,
    pagination: {
      total: countRes.rows[0]?.total || 0,
      page,
      limit,
      total_pages: Math.ceil((countRes.rows[0]?.total || 0) / limit) || 1
    }
  });
});

adminRouter.get('/stats', auth, adminOnly, async (_req: AuthRequest, res) => {
  const [statusRes, envRes, gpuRes, trendRes] = await Promise.all([
    pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM resource_requests
       GROUP BY status`
    ),
    pool.query(
      `SELECT environment, COUNT(*)::int AS count
       FROM resource_requests
       WHERE status = 'deployed'
       GROUP BY environment`
    ),
    pool.query(
      `SELECT gpu_model, SUM(gpu_count)::int AS count
       FROM vm_request_items
       WHERE requires_gpu = TRUE AND deployment_status = 'deployed'
       GROUP BY gpu_model
       ORDER BY gpu_model`
    ),
    pool.query(
      `SELECT TO_CHAR(day, 'YYYY-MM-DD') AS date,
              COALESCE(COUNT(rr.id), 0)::int AS count
       FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS day
       LEFT JOIN resource_requests rr ON rr.created_at::date = day::date
       GROUP BY day
       ORDER BY day`
    )
  ]);

  const statusCounts: Record<string, number> = {};
  for (const status of allowedStatuses) {
    statusCounts[status] = 0;
  }
  for (const row of statusRes.rows) {
    statusCounts[row.status] = row.count;
  }

  const environmentCounts: Record<string, number> = {
    development: 0,
    testing: 0,
    production: 0
  };
  for (const row of envRes.rows) {
    environmentCounts[row.environment] = row.count;
  }

  res.json({
    status_counts: statusCounts,
    environment_counts: environmentCounts,
    gpu_usage: gpuRes.rows,
    daily_requests: trendRes.rows
  });
});

adminRouter.patch('/:id/approve', auth, adminOnly, async (req: AuthRequest, res) => {
  const requestId = parseId(req.params.id, res);
  if (!requestId) return;

  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request payload' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updateRes = await client.query(
      `UPDATE resource_requests
       SET status = 'approved',
           admin_notes = $2,
           rejection_reason = NULL,
           approved_at = CURRENT_TIMESTAMP,
           approved_by = $3
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [requestId, parsed.data.admin_notes || null, req.user?.id]
    );

    if (!updateRes.rows[0]) {
      const exists = await client.query('SELECT id, status FROM resource_requests WHERE id = $1', [requestId]);
      await client.query('ROLLBACK');
      if (!exists.rows[0]) {
        return res.status(404).json({ error: 'Not found' });
      }
      return res.status(409).json({ error: 'Request status conflict' });
    }

    await client.query(
      `INSERT INTO request_approvals (request_id, action, admin_id, admin_notes)
       VALUES ($1, 'approved', $2, $3)`,
      [requestId, req.user?.id, parsed.data.admin_notes || null]
    );

    await client.query('COMMIT');
    res.json(updateRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

adminRouter.patch('/:id/reject', auth, adminOnly, async (req: AuthRequest, res) => {
  const requestId = parseId(req.params.id, res);
  if (!requestId) return;

  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request payload' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updateRes = await client.query(
      `UPDATE resource_requests
       SET status = 'rejected',
           admin_notes = $2,
           rejection_reason = $3,
           approved_at = NULL,
           approved_by = NULL
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [requestId, parsed.data.admin_notes || null, parsed.data.rejection_reason]
    );

    if (!updateRes.rows[0]) {
      const exists = await client.query('SELECT id, status FROM resource_requests WHERE id = $1', [requestId]);
      await client.query('ROLLBACK');
      if (!exists.rows[0]) {
        return res.status(404).json({ error: 'Not found' });
      }
      return res.status(409).json({ error: 'Request status conflict' });
    }

    await client.query(
      `INSERT INTO request_approvals (request_id, action, admin_id, admin_notes, rejection_reason)
       VALUES ($1, 'rejected', $2, $3, $4)`,
      [requestId, req.user?.id, parsed.data.admin_notes || null, parsed.data.rejection_reason]
    );

    await client.query('COMMIT');
    res.json(updateRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

adminRouter.post('/:id/deploy', auth, adminOnly, async (req: AuthRequest, res) => {
  const requestId = parseId(req.params.id, res);
  if (!requestId) return;

  const parsed = deploySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request payload' });
  }

  const requestRes = await pool.query(
    'SELECT id, status FROM resource_requests WHERE id = $1',
    [requestId]
  );
  const request = requestRes.rows[0];
  if (!request) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (request.status !== 'approved' && request.status !== 'failed') {
    return res.status(409).json({ error: 'Request status conflict' });
  }

  const vmItemsRes = await pool.query(
    'SELECT id, vm_name FROM vm_request_items WHERE request_id = $1 ORDER BY id',
    [requestId]
  );
  const vmItems = vmItemsRes.rows;

  void executeDeployment(requestId, {
    vm_configs: parsed.data.vm_configs,
    operatorId: req.user?.id
  }).catch((err) => {
    console.error('[Deployment] execution error:', err);
  });

  res.status(202).json({
    message: 'Deployment started',
    deployment_tasks: vmItems.map((item: any) => ({
      vm_item_id: item.id,
      vm_name: item.vm_name || null,
      status: 'queued'
    }))
  });
});

adminRouter.get('/:id/deployment-logs', auth, adminOnly, async (req: AuthRequest, res) => {
  const requestId = parseId(req.params.id, res);
  if (!requestId) return;

  const logsRes = await pool.query(
    `SELECT id, request_id, vm_item_id, log_level, message, details, operation, operator_id, created_at
     FROM deployment_logs
     WHERE request_id = $1
     ORDER BY created_at ASC`,
    [requestId]
  );

  res.json({ data: logsRes.rows });
});

export { adminRouter };
export default router;
