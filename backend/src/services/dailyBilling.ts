import { pool } from '../db';
import { vsphere } from './vsphere';

// 获取所有价格配置
async function getPricingConfig(): Promise<Record<string, number>> {
  const result = await pool.query('SELECT resource_type, unit_price FROM pricing_config');
  const config: Record<string, number> = {};
  for (const row of result.rows) {
    config[row.resource_type] = parseFloat(row.unit_price);
  }
  return config;
}

// 计算VM每日费用，返回费用明细
interface CostBreakdown {
  cpuCost: number;
  memoryCost: number;
  storageCost: number;
  gpuCost: number;
  totalCost: number;
}

function calculateDailyCost(
  vm: { cpu_cores: number; memory_gb: number; storage_gb: number; gpu_count: number; gpu_type?: string },
  pricing: Record<string, number>
): CostBreakdown {
  const cpuCost = vm.cpu_cores * (pricing.cpu || 0.08);
  const memoryCost = vm.memory_gb * (pricing.memory || 0.16);
  const storageCost = (vm.storage_gb / 100) * (pricing.storage || 0.5);

  let gpuCost = 0;
  if (vm.gpu_count > 0 && vm.gpu_type) {
    const gpuTypeLower = vm.gpu_type.toLowerCase();
    if (gpuTypeLower.includes('3090')) {
      gpuCost = vm.gpu_count * (pricing.gpu_3090 || 11);
    } else if (gpuTypeLower.includes('t4')) {
      gpuCost = vm.gpu_count * (pricing.gpu_t4 || 5);
    } else {
      gpuCost = vm.gpu_count * (pricing.gpu || 5);
    }
  }

  const totalCost = Math.round((cpuCost + memoryCost + storageCost + gpuCost) * 100) / 100;
  return { cpuCost, memoryCost, storageCost, gpuCost, totalCost };
}

// 生成每日账单（每天调用一次）
export async function generateDailyBills() {
  const today = new Date().toISOString().split('T')[0];
  const pricing = await getPricingConfig();

  // 获取所有绑定到项目的VM
  const vms = await pool.query(`
    SELECT vm.*, p.id as project_id, p.name as project_name
    FROM virtual_machines vm
    JOIN projects p ON vm.project_id = p.id
    WHERE vm.project_id IS NOT NULL
      AND (vm.unbound_at IS NULL OR vm.unbound_at::date >= $1::date)
  `, [today]);

  let created = 0;
  for (const vm of vms.rows) {
    // 检查今天是否已有账单
    const existing = await pool.query(
      'SELECT id FROM daily_bills WHERE vm_id = $1 AND bill_date = $2',
      [vm.id, today]
    );
    if (existing.rows.length > 0) continue;

    const cost = calculateDailyCost(vm, pricing);
    // unit_price = sum of resource units (cpu + memory + storage/100 + gpu), daily_cost = actual cost
    const resourceUnits = vm.cpu_cores + vm.memory_gb + (vm.storage_gb / 100) + vm.gpu_count;

    await pool.query(`
      INSERT INTO daily_bills (project_id, vm_id, bill_date, cpu_cores, memory_gb, storage_gb, gpu_count, gpu_type, unit_price, daily_cost)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (vm_id, bill_date) DO NOTHING
    `, [
      vm.project_id, vm.id, today,
      vm.cpu_cores, vm.memory_gb, vm.storage_gb,
      vm.gpu_count, vm.gpu_type,
      Math.round(resourceUnits * 100) / 100, cost.totalCost
    ]);
    created++;
  }

  console.log(`[DailyBilling] Generated ${created} daily bills for ${today}`);
  return created;
}

// 为单个VM生成当天账单（绑定时调用）
export async function generateBillForVM(vmId: number) {
  const today = new Date().toISOString().split('T')[0];
  const pricing = await getPricingConfig();

  const vm = await pool.query(`
    SELECT vm.*, p.id as project_id
    FROM virtual_machines vm
    JOIN projects p ON vm.project_id = p.id
    WHERE vm.id = $1 AND vm.project_id IS NOT NULL
  `, [vmId]);

  if (vm.rows.length === 0) return false;

  const v = vm.rows[0];
  const cost = calculateDailyCost(v, pricing);
  const resourceUnits = v.cpu_cores + v.memory_gb + (v.storage_gb / 100) + v.gpu_count;
  await pool.query(`
    INSERT INTO daily_bills (project_id, vm_id, bill_date, cpu_cores, memory_gb, storage_gb, gpu_count, gpu_type, unit_price, daily_cost)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (vm_id, bill_date) DO NOTHING
  `, [v.project_id, v.id, today, v.cpu_cores, v.memory_gb, v.storage_gb, v.gpu_count, v.gpu_type, Math.round(resourceUnits * 100) / 100, cost.totalCost]);

  return true;
}

// 清理超过3个月的账单数据
export async function cleanupOldBills() {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - 3);
  cutoffDate.setDate(cutoffDate.getDate() - 7);
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

  const result = await pool.query(
    'DELETE FROM daily_bills WHERE bill_date < $1',
    [cutoffDateStr]
  );

  console.log(`[DailyBilling] Cleaned up ${result.rowCount} old bills before ${cutoffDateStr}`);
  return result.rowCount;
}

// 同步VM配置并记录绑定时间
export async function syncVMConfigsWithBinding() {
  const projects = await pool.query('SELECT * FROM projects');
  const now = new Date();

  for (const project of projects.rows) {
    try {
      let folderId = project.vcenter_folder_id;
      if (!folderId) {
        const folderName = String(project.name || '').trim();
        if (folderName) {
          folderId = await vsphere.getFolderByName(folderName);
          if (folderId) {
            await pool.query('UPDATE projects SET vcenter_folder_id = $1 WHERE id = $2', [folderId, project.id]);
          }
        }
      }

      if (!folderId) {
        console.warn(`[DailyBilling] Skip project ${project.name} (missing vcenter_folder_id)`);
        continue;
      }

      const vcenterVMs = await vsphere.getVMsByFolder(folderId);

      for (const vm of vcenterVMs) {
        const details = await vsphere.getVM(vm.vm);
        const gpuInfo = await vsphere.getVmGpuInfo(vm.vm);
        const metadata = await vsphere.getVMMetadata(vm.vm);
        const createTimeForInsert = metadata.createTime ?? now;
        const newConfig = {
          name: vm.name,
          cpu_cores: details.cpu?.count || 1,
          memory_gb: Math.ceil((details.memory?.size_MiB || 1024) / 1024),
          storage_gb: Math.ceil((details.disks ? Object.values(details.disks).reduce((sum: number, d: any) => sum + (d.capacity || 0), 0) : 0) / 1024 / 1024 / 1024),
          gpu_count: gpuInfo.gpuCount,
          gpu_type: gpuInfo.gpuType,
          status: vm.power_state || 'unknown',
          create_time: metadata.createTime,
          end_time: metadata.deadline,
          owner: metadata.owner
        };

        const existing = await pool.query('SELECT * FROM virtual_machines WHERE vcenter_vm_id = $1', [vm.vm]);

        if (existing.rows[0]) {
          // 更新现有VM
          await pool.query(`
            UPDATE virtual_machines SET
              name=$1, cpu_cores=$2, memory_gb=$3, storage_gb=$4, gpu_count=$5, gpu_type=$6, status=$7,
              create_time=COALESCE($8, create_time),
              end_time=$9,
              owner=COALESCE($10, owner)
            WHERE vcenter_vm_id=$11
          `, [
            newConfig.name, newConfig.cpu_cores, newConfig.memory_gb, newConfig.storage_gb,
            newConfig.gpu_count, newConfig.gpu_type, newConfig.status,
            newConfig.create_time, newConfig.end_time, newConfig.owner,
            vm.vm
          ]);

          // 如果之前没有绑定项目，现在绑定了，记录绑定时间并生成账单
          if (existing.rows[0].project_id !== project.id) {
            await pool.query(
              'UPDATE virtual_machines SET project_id = $1, bound_at = $2, unbound_at = NULL WHERE vcenter_vm_id = $3',
              [project.id, now, vm.vm]
            );
            await generateBillForVM(existing.rows[0].id);
          }
        } else {
          // 新VM，记录绑定时间并生成账单
          const inserted = await pool.query(`
            INSERT INTO virtual_machines (
              project_id, vcenter_vm_id, name, cpu_cores, memory_gb, storage_gb,
              gpu_count, gpu_type, status, bound_at, create_time, end_time, owner
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id
          `, [
            project.id, vm.vm, newConfig.name, newConfig.cpu_cores, newConfig.memory_gb,
            newConfig.storage_gb, newConfig.gpu_count, newConfig.gpu_type, newConfig.status,
            now, createTimeForInsert, newConfig.end_time, newConfig.owner
          ]);
          await generateBillForVM(inserted.rows[0].id);
        }
      }

      // 检查已移出项目的VM
      const dbVMs = await pool.query(
        'SELECT * FROM virtual_machines WHERE project_id = $1 AND unbound_at IS NULL',
        [project.id]
      );
      const vcenterVMIds = new Set(vcenterVMs.map((v: any) => v.vm));

      for (const dbVM of dbVMs.rows) {
        if (!vcenterVMIds.has(dbVM.vcenter_vm_id)) {
          // VM已从vCenter移出，记录移出时间
          await pool.query(
            'UPDATE virtual_machines SET unbound_at = $1 WHERE id = $2',
            [now, dbVM.id]
          );
          console.log(`[DailyBilling] VM ${dbVM.name} unbound from project`);
        }
      }
    } catch (err) {
      console.error(`[DailyBilling] Error syncing project ${project.name}:`, err);
    }
  }
}

// 获取账单列表（支持时间范围筛选）
export async function getDailyBills(options: {
  projectId?: number;
  startDate?: string;
  endDate?: string;
  userId?: number;
}) {
  let query = `
    SELECT db.*, vm.name as vm_name, vm.vcenter_vm_id, p.name as project_name, p.project_code, u.username
    FROM daily_bills db
    JOIN virtual_machines vm ON db.vm_id = vm.id
    JOIN projects p ON db.project_id = p.id
    JOIN users u ON p.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];
  let paramIndex = 1;

  if (options.projectId) {
    query += ` AND db.project_id = $${paramIndex++}`;
    params.push(options.projectId);
  }
  if (options.userId) {
    query += ` AND p.user_id = $${paramIndex++}`;
    params.push(options.userId);
  }
  if (options.startDate) {
    query += ` AND db.bill_date >= $${paramIndex++}`;
    params.push(options.startDate);
  }
  if (options.endDate) {
    query += ` AND db.bill_date <= $${paramIndex++}`;
    params.push(options.endDate);
  }

  query += ' ORDER BY db.bill_date DESC, p.name, vm.name';

  const result = await pool.query(query, params);
  return result.rows;
}

// 获取账单汇总统计
export async function getBillSummary(options: {
  projectId?: number;
  startDate?: string;
  endDate?: string;
  userId?: number;
}) {
  let query = `
    SELECT
      p.name as project_name,
      p.project_code as project_code,
      vm.name as vm_name,
      vm.vcenter_vm_id,
      COUNT(DISTINCT db.bill_date) as bill_days,
      SUM(db.daily_cost) as total_cost,
      MIN(db.bill_date) as first_bill_date,
      MAX(db.bill_date) as last_bill_date
    FROM daily_bills db
    JOIN virtual_machines vm ON db.vm_id = vm.id
    JOIN projects p ON db.project_id = p.id
    WHERE 1=1
  `;
  const params: any[] = [];
  let paramIndex = 1;

  if (options.projectId) {
    query += ` AND db.project_id = $${paramIndex++}`;
    params.push(options.projectId);
  }
  if (options.userId) {
    query += ` AND p.user_id = $${paramIndex++}`;
    params.push(options.userId);
  }
  if (options.startDate) {
    query += ` AND db.bill_date >= $${paramIndex++}`;
    params.push(options.startDate);
  }
  if (options.endDate) {
    query += ` AND db.bill_date <= $${paramIndex++}`;
    params.push(options.endDate);
  }

  query += ' GROUP BY p.name, p.project_code, vm.name, vm.vcenter_vm_id ORDER BY p.name, vm.name';

  const result = await pool.query(query, params);
  return result.rows;
}

export type DailyBillingStatsDimension = 'day' | 'month';

// Aggregate daily bills by time bucket (day/month).
export async function getStatsByDimension(options: {
  dimension: DailyBillingStatsDimension;
  projectId?: number;
  startDate?: string;
  endDate?: string;
  userId?: number;
}) {
  let periodSelect: string;
  let groupByExpr: string;
  let orderByExpr: string;

  switch (options.dimension) {
    case 'day':
      periodSelect = "to_char(db.bill_date, 'YYYY-MM-DD')";
      groupByExpr = 'db.bill_date';
      orderByExpr = 'db.bill_date';
      break;
    case 'month':
      periodSelect = "to_char(date_trunc('month', db.bill_date), 'YYYY-MM')";
      groupByExpr = "date_trunc('month', db.bill_date)";
      orderByExpr = "date_trunc('month', db.bill_date)";
      break;
    default:
      throw new Error(`Invalid dimension: ${options.dimension}`);
  }

  let query = `
    SELECT
      ${periodSelect} as period,
      COUNT(DISTINCT db.vm_id) as vm_count,
      COUNT(DISTINCT db.bill_date) as bill_days,
      COALESCE(SUM(db.daily_cost), 0) as total_cost
    FROM daily_bills db
    JOIN projects p ON db.project_id = p.id
    WHERE 1=1
  `;
  const params: any[] = [];
  let paramIndex = 1;

  if (options.projectId) {
    query += ` AND db.project_id = $${paramIndex++}`;
    params.push(options.projectId);
  }
  if (options.userId) {
    query += ` AND p.user_id = $${paramIndex++}`;
    params.push(options.userId);
  }
  if (options.startDate) {
    query += ` AND db.bill_date >= $${paramIndex++}`;
    params.push(options.startDate);
  }
  if (options.endDate) {
    query += ` AND db.bill_date <= $${paramIndex++}`;
    params.push(options.endDate);
  }

  query += ` GROUP BY ${groupByExpr} ORDER BY ${orderByExpr} DESC`;

  const result = await pool.query(query, params);
  return result.rows;
}
