import { pool } from '../db';
import { vsphere } from './vsphere';

export const GPU_STATUSES = ['available', 'in_use', 'reserved', 'maintenance'] as const;
export type GPUStatus = typeof GPU_STATUSES[number];

export interface VSphereGPUInventoryItem {
  deviceId: string;
  deviceName: string;
  gpuModel: string;
  hostId: string;
  hostName: string;
}

export const normalizeGpuModel = (name?: string | null) => {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.includes('3090')) return 'RTX3090';
  if (lower.includes('t4')) return 'T4';
  return null;
};

export async function syncGPUInventory() {
  const devices = await vsphere.syncGPUInventory();
  const now = new Date();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const device of devices) {
      const modelSource = device.gpuModel || device.deviceName;
      const normalized = normalizeGpuModel(modelSource) || modelSource || 'UNKNOWN';
      await client.query(
        `INSERT INTO gpu_inventory (device_id, device_name, gpu_model, host_name, host_id, last_synced_at, sync_error)
         VALUES ($1, $2, $3, $4, $5, $6, NULL)
         ON CONFLICT (device_id) DO UPDATE SET
           device_name = EXCLUDED.device_name,
           gpu_model = EXCLUDED.gpu_model,
           host_name = EXCLUDED.host_name,
           host_id = EXCLUDED.host_id,
           last_synced_at = EXCLUDED.last_synced_at,
           sync_error = NULL`,
        [device.deviceId, device.deviceName, normalized, device.hostName, device.hostId, now]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { synced: devices.length, lastSyncedAt: now };
}

export async function listGPUInventory(filters: { status?: string; gpuModel?: string; hostName?: string }) {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.gpuModel) {
    params.push(filters.gpuModel);
    conditions.push(`gpu_model = $${params.length}`);
  }
  if (filters.hostName) {
    params.push(`%${filters.hostName}%`);
    conditions.push(`host_name ILIKE $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const listRes = await pool.query(
    `SELECT id, device_id, device_name, gpu_model, host_name, host_id, status,
            allocated_to_vm, allocated_at, last_synced_at, sync_error
     FROM gpu_inventory
     ${whereClause}
     ORDER BY host_name, gpu_model, device_id`,
    params
  );
  const lastSyncRes = await pool.query('SELECT MAX(last_synced_at) AS last_synced_at FROM gpu_inventory');

  return {
    data: listRes.rows,
    last_synced_at: lastSyncRes.rows[0]?.last_synced_at || null
  };
}

export async function getGPUAvailability(gpuModel?: string) {
  const params: any[] = [];
  const conditions: string[] = [];
  if (gpuModel) {
    params.push(gpuModel);
    conditions.push(`gpu_model = $${params.length}`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await pool.query(
    `SELECT gpu_model,
            COUNT(*) FILTER (WHERE status = 'available')::int AS available,
            COUNT(*) FILTER (WHERE status = 'reserved')::int AS reserved,
            COUNT(*) FILTER (WHERE status = 'in_use')::int AS in_use,
            COUNT(*) FILTER (WHERE status = 'maintenance')::int AS maintenance,
            COUNT(*)::int AS total
     FROM gpu_inventory
     ${whereClause}
     GROUP BY gpu_model
     ORDER BY gpu_model`,
    params
  );

  return res.rows;
}

export async function validateGPUAvailability(gpuType: string, count: number) {
  if (count <= 0) return true;
  const normalizedType = normalizeGpuModel(gpuType) || gpuType;
  const res = await pool.query(
    `SELECT COUNT(*)::int AS available
     FROM gpu_inventory
     WHERE gpu_model = $1 AND status = 'available'`,
    [normalizedType]
  );
  return (res.rows[0]?.available || 0) >= count;
}

export async function reserveGPUs(gpuType: string, count: number) {
  if (count <= 0) return [];
  const normalizedType = normalizeGpuModel(gpuType) || gpuType;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const availableRes = await client.query(
      `SELECT id, device_id
       FROM gpu_inventory
       WHERE gpu_model = $1 AND status = 'available'
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [normalizedType, count]
    );

    if (availableRes.rows.length < count) {
      await client.query('ROLLBACK');
      return [];
    }

    const ids = availableRes.rows.map((row) => row.id);
    await client.query(
      `UPDATE gpu_inventory
       SET status = 'reserved', allocated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1::int[])`,
      [ids]
    );

    await client.query('COMMIT');
    return availableRes.rows.map((row) => row.device_id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function releaseGPUs(gpuIds: string[]) {
  if (!gpuIds.length) return 0;
  const res = await pool.query(
    `UPDATE gpu_inventory
     SET status = 'available', allocated_to_vm = NULL, allocated_at = NULL
     WHERE device_id = ANY($1::text[])`,
    [gpuIds]
  );
  return res.rowCount || 0;
}

export async function updateGPUStatus(id: number, status: GPUStatus) {
  const clearAllocation = status === 'available' || status === 'maintenance';
  const res = await pool.query(
    `UPDATE gpu_inventory
     SET status = $1,
         allocated_to_vm = CASE WHEN $2 THEN NULL ELSE allocated_to_vm END,
         allocated_at = CASE WHEN $2 THEN NULL ELSE allocated_at END
     WHERE id = $3
     RETURNING *`,
    [status, clearAllocation, id]
  );
  return res.rows[0] || null;
}
