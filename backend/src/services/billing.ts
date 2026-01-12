import { pool } from '../db';

export async function calculateBill(tenantId: number, period: string) {
  const [year, month] = period.split('-').map(Number);
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const usage = await pool.query(`
    SELECT SUM(cpu_hours) as cpu, SUM(memory_gb_hours) as memory,
           SUM(storage_gb_hours) as storage, SUM(gpu_hours) as gpu
    FROM usage_records WHERE tenant_id = $1 AND record_date BETWEEN $2 AND $3
  `, [tenantId, startDate, endDate]);

  const prices = await pool.query('SELECT resource_type, unit_price FROM pricing_config');
  const priceMap = Object.fromEntries(prices.rows.map(r => [r.resource_type, parseFloat(r.unit_price)]));

  const u = usage.rows[0];
  const cpuCost = (parseFloat(u.cpu) || 0) * (priceMap.cpu || 0);
  const memoryCost = (parseFloat(u.memory) || 0) * (priceMap.memory || 0);
  const storageCost = (parseFloat(u.storage) || 0) * (priceMap.storage || 0);
  const gpuCost = (parseFloat(u.gpu) || 0) * (priceMap.gpu || 0);

  await pool.query(`
    INSERT INTO bills (tenant_id, billing_period, cpu_cost, memory_cost, storage_cost, gpu_cost, total_cost)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (tenant_id, billing_period) DO UPDATE SET
      cpu_cost = $3, memory_cost = $4, storage_cost = $5, gpu_cost = $6, total_cost = $7
  `, [tenantId, period, cpuCost, memoryCost, storageCost, gpuCost, cpuCost + memoryCost + storageCost + gpuCost]);
}

export function generateCSV(bill: any) {
  return `租户ID,账期,CPU费用,内存费用,存储费用,GPU费用,总费用,状态
${bill.tenant_id},${bill.billing_period},${bill.cpu_cost},${bill.memory_cost},${bill.storage_cost},${bill.gpu_cost},${bill.total_cost},${bill.status}`;
}
