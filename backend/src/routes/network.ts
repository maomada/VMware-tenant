import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { auth, adminOnly } from '../middleware/auth';

const router = Router();

const environmentSchema = z.enum(['development', 'testing', 'production']);
const dnsSchema = z.array(z.string().min(1).max(200)).min(1);

const networkPoolSchema = z.object({
  environment: environmentSchema,
  network_segment: z.string().min(1).max(50),
  gateway: z.string().min(1).max(50),
  subnet_mask: z.string().min(1).max(50),
  dns_servers: dnsSchema,
  ip_range_start: z.string().min(1).max(50),
  ip_range_end: z.string().min(1).max(50),
  is_active: z.boolean().optional(),
  description: z.string().max(2000).optional()
});

const idSchema = z.coerce.number().int().positive();

const parseId = (value: unknown, res: any) => {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  return parsed.data;
};

const parseIPv4 = (value: string): number | null => {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return null;
    result = result * 256 + num;
  }
  return result;
};

const formatIPv4 = (value: number): string => {
  const part1 = Math.floor(value / (256 ** 3));
  const part2 = Math.floor((value % (256 ** 3)) / (256 ** 2));
  const part3 = Math.floor((value % (256 ** 2)) / 256);
  const part4 = value % 256;
  return `${part1}.${part2}.${part3}.${part4}`;
};

const buildIpRange = (start: string, end: string) => {
  const startNum = parseIPv4(start);
  const endNum = parseIPv4(end);
  if (startNum === null || endNum === null) return null;
  if (endNum < startNum) return null;

  const total = endNum - startNum + 1;
  if (total <= 0 || total > 65536) return null;

  const ips: string[] = [];
  for (let current = startNum; current <= endNum; current += 1) {
    ips.push(formatIPv4(current));
  }
  return { total, ips };
};

router.get('/', auth, adminOnly, async (_req, res) => {
  const result = await pool.query(
    `SELECT id, environment, network_segment, gateway, subnet_mask, dns_servers,
            ip_range_start, ip_range_end, total_ips, allocated_ips, is_active, description,
            created_at, updated_at
     FROM network_pools
     ORDER BY environment, id`
  );
  res.json(result.rows);
});

router.post('/', auth, adminOnly, async (req, res) => {
  const parsed = networkPoolSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request payload' });
  }

  const range = buildIpRange(parsed.data.ip_range_start, parsed.data.ip_range_end);
  if (!range) {
    return res.status(400).json({ error: 'Invalid IP range' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertRes = await client.query(
      `INSERT INTO network_pools (
        environment, network_segment, gateway, subnet_mask, dns_servers,
        ip_range_start, ip_range_end, total_ips, is_active, description
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        parsed.data.environment,
        parsed.data.network_segment,
        parsed.data.gateway,
        parsed.data.subnet_mask,
        parsed.data.dns_servers,
        parsed.data.ip_range_start,
        parsed.data.ip_range_end,
        range.total,
        parsed.data.is_active ?? true,
        parsed.data.description || null
      ]
    );

    const poolRow = insertRes.rows[0];
    if (range.ips.length) {
      await client.query(
        `INSERT INTO ip_allocations (pool_id, ip_address, status)
         SELECT $1, unnest($2::inet[]), 'released'`,
        [poolRow.id, range.ips]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(poolRow);
  } catch (err: any) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.put('/:id', auth, adminOnly, async (req, res) => {
  const poolId = parseId(req.params.id, res);
  if (!poolId) return;

  const parsed = networkPoolSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request payload' });
  }

  const range = buildIpRange(parsed.data.ip_range_start, parsed.data.ip_range_end);
  if (!range) {
    return res.status(400).json({ error: 'Invalid IP range' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingRes = await client.query(
      `SELECT id, ip_range_start, ip_range_end, is_active, description
       FROM network_pools
       WHERE id = $1
       FOR UPDATE`,
      [poolId]
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const rangeChanged =
      String(existing.ip_range_start) !== parsed.data.ip_range_start ||
      String(existing.ip_range_end) !== parsed.data.ip_range_end;

    if (rangeChanged) {
      const inUseRes = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM ip_allocations
         WHERE pool_id = $1 AND status IN ('allocated', 'reserved')`,
        [poolId]
      );
      if (inUseRes.rows[0]?.count > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'IP range has active allocations' });
      }

      await client.query('DELETE FROM ip_allocations WHERE pool_id = $1', [poolId]);
      if (range.ips.length) {
        await client.query(
          `INSERT INTO ip_allocations (pool_id, ip_address, status)
           SELECT $1, unnest($2::inet[]), 'released'`,
          [poolId, range.ips]
        );
      }
    }

    const isActive = parsed.data.is_active ?? existing.is_active;
    const description = parsed.data.description ?? existing.description;

    const updateRes = await client.query(
      `UPDATE network_pools
       SET environment = $2,
           network_segment = $3,
           gateway = $4,
           subnet_mask = $5,
           dns_servers = $6,
           ip_range_start = $7,
           ip_range_end = $8,
           total_ips = $9,
           is_active = $10,
           description = $11,
           allocated_ips = CASE WHEN $12 THEN 0 ELSE allocated_ips END
       WHERE id = $1
       RETURNING *`,
      [
        poolId,
        parsed.data.environment,
        parsed.data.network_segment,
        parsed.data.gateway,
        parsed.data.subnet_mask,
        parsed.data.dns_servers,
        parsed.data.ip_range_start,
        parsed.data.ip_range_end,
        range.total,
        isActive,
        description || null,
        rangeChanged
      ]
    );

    const updatedRow = updateRes.rows[0];
    await client.query('COMMIT');
    res.json(updatedRow);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  const poolId = parseId(req.params.id, res);
  if (!poolId) return;

  const inUseRes = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM ip_allocations
     WHERE pool_id = $1 AND status IN ('allocated', 'reserved')`,
    [poolId]
  );
  if (inUseRes.rows[0]?.count > 0) {
    return res.status(409).json({ error: 'Network pool has active IP allocations' });
  }

  const deleteRes = await pool.query('DELETE FROM network_pools WHERE id = $1 RETURNING id', [poolId]);
  if (!deleteRes.rows[0]) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ success: true });
});

router.get('/:id/ip-allocations', auth, adminOnly, async (req, res) => {
  const poolId = parseId(req.params.id, res);
  if (!poolId) return;

  const result = await pool.query(
    `SELECT ia.id,
            ia.ip_address,
            CASE WHEN ia.status = 'released' THEN 'available' ELSE ia.status END AS status,
            ia.vm_item_id,
            COALESCE(ia.vm_name, vmi.vm_name) AS vm_name,
            ia.vcenter_vm_id,
            ia.allocated_at,
            ia.released_at,
            rr.request_number
     FROM ip_allocations ia
     LEFT JOIN vm_request_items vmi ON ia.vm_item_id = vmi.id
     LEFT JOIN resource_requests rr ON vmi.request_id = rr.id
     WHERE ia.pool_id = $1
     ORDER BY ia.ip_address`,
    [poolId]
  );
  res.json(result.rows);
});

export default router;
