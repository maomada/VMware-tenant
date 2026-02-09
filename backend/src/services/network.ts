import { pool } from '../db';

export interface NetworkConfig {
  id: number;
  environment: string;
  network_segment: string;
  gateway: string;
  subnet_mask: string;
  dns_servers: string[];
  ip_range_start: string;
  ip_range_end: string;
}

export async function getNetworkConfig(environment: string): Promise<NetworkConfig | null> {
  const res = await pool.query(
    `SELECT id, environment, network_segment, gateway, subnet_mask, dns_servers, ip_range_start, ip_range_end
     FROM network_pools
     WHERE environment = $1 AND is_active = true
     ORDER BY id
     LIMIT 1`,
    [environment]
  );
  return res.rows[0] || null;
}

export async function allocateIP(environment: string, vmItemId: number): Promise<{
  ipAddress: string;
  gateway: string;
  dnsServers: string[];
  subnetMask: string;
  networkSegment: string;
  poolId: number;
}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const poolRes = await client.query(
      `SELECT id, network_segment, gateway, subnet_mask, dns_servers
       FROM network_pools
       WHERE environment = $1 AND is_active = true
       ORDER BY id
       LIMIT 1
       FOR UPDATE`,
      [environment]
    );
    const poolRow = poolRes.rows[0];
    if (!poolRow) {
      throw new Error(`Network pool not found for environment: ${environment}`);
    }

    const ipRes = await client.query(
      `SELECT id, ip_address
       FROM ip_allocations
       WHERE pool_id = $1 AND status IN ('available', 'released')
       ORDER BY ip_address
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [poolRow.id]
    );
    const ipRow = ipRes.rows[0];
    if (!ipRow) {
      throw new Error('No available IPs in pool');
    }

    await client.query(
      `UPDATE ip_allocations
       SET status = 'allocated',
           vm_item_id = $2,
           released_at = NULL,
           allocated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [ipRow.id, vmItemId]
    );

    await client.query(
      `UPDATE network_pools
       SET allocated_ips = allocated_ips + 1
       WHERE id = $1`,
      [poolRow.id]
    );

    await client.query('COMMIT');
    return {
      ipAddress: ipRow.ip_address,
      gateway: poolRow.gateway,
      dnsServers: poolRow.dns_servers || [],
      subnetMask: poolRow.subnet_mask,
      networkSegment: poolRow.network_segment,
      poolId: poolRow.id
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function releaseIP(ipAddress: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ipRes = await client.query(
      `SELECT id, pool_id
       FROM ip_allocations
       WHERE ip_address = $1 AND status IN ('allocated', 'reserved')
       FOR UPDATE`,
      [ipAddress]
    );
    const ipRow = ipRes.rows[0];
    if (!ipRow) {
      await client.query('COMMIT');
      return false;
    }

    await client.query(
      `UPDATE ip_allocations
       SET status = 'released',
           vm_item_id = NULL,
           vm_name = NULL,
           vcenter_vm_id = NULL,
           released_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [ipRow.id]
    );

    await client.query(
      `UPDATE network_pools
       SET allocated_ips = GREATEST(allocated_ips - 1, 0)
       WHERE id = $1`,
      [ipRow.pool_id]
    );

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
