import { pool } from '../db';
import { vsphere } from './vsphere';

// 记录 VM 使用量（每小时调用）
export async function recordUsage() {
  const today = new Date().toISOString().split('T')[0];
  const vms = await pool.query(`
    SELECT vm.*, p.user_id FROM virtual_machines vm
    JOIN projects p ON vm.project_id = p.id
  `);

  for (const vm of vms.rows) {
    // 关机 VM: CPU/MEM/GPU 计为 0
    const isPoweredOn = vm.status === 'POWERED_ON';
    const cpuHours = isPoweredOn ? vm.cpu_cores : 0;
    const memHours = isPoweredOn ? vm.memory_gb : 0;
    const gpuHours = isPoweredOn ? vm.gpu_count : 0;

    await pool.query(`
      INSERT INTO usage_records (vm_id, project_id, record_date, cpu_hours, memory_gb_hours, storage_gb_hours, gpu_hours, gpu_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (vm_id, record_date) DO UPDATE SET
        cpu_hours = usage_records.cpu_hours + $4,
        memory_gb_hours = usage_records.memory_gb_hours + $5,
        storage_gb_hours = usage_records.storage_gb_hours + $6,
        gpu_hours = usage_records.gpu_hours + $7
    `, [vm.id, vm.project_id, today, cpuHours, memHours, vm.storage_gb, gpuHours, vm.gpu_type]);
  }
}

// 同步 VM 配置并检测变更（参考 BillCheck 逻辑）
export async function syncVMConfigs() {
  const projects = await pool.query('SELECT * FROM projects WHERE vcenter_folder_path IS NOT NULL');
  const now = new Date();

  for (const project of projects.rows) {
    let folderId = project.vcenter_folder_id;
    if (!folderId) {
      const trimmedPath = (project.vcenter_folder_path || '').replace(/\/+$/, '');
      const folderName = trimmedPath.split('/').pop();
      if (folderName) {
        folderId = await vsphere.getFolderByName(folderName);
        if (folderId) {
          await pool.query('UPDATE projects SET vcenter_folder_id = $1 WHERE id = $2', [folderId, project.id]);
        }
      }
    }

    if (!folderId) {
      console.warn(`[Billing] Skip project ${project.name} (missing vcenter_folder_id)`);
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

      // 检查是否存在该 VM
      const existing = await pool.query('SELECT * FROM virtual_machines WHERE vcenter_vm_id = $1', [vm.vm]);

      if (existing.rows[0]) {
        const old = existing.rows[0];
        // 检测配置变更
        if (old.cpu_cores !== newConfig.cpu_cores ||
            old.memory_gb !== newConfig.memory_gb ||
            old.storage_gb !== newConfig.storage_gb ||
            old.gpu_count !== newConfig.gpu_count ||
            (old.gpu_type || null) !== (newConfig.gpu_type || null)) {
          console.log(`[Billing] VM ${vm.name} config changed`);
        }

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
      } else {
        await pool.query(`
          INSERT INTO virtual_machines (
            project_id, vcenter_vm_id, name, cpu_cores, memory_gb, storage_gb,
            gpu_count, gpu_type, status, create_time, end_time, owner
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
          project.id, vm.vm, newConfig.name, newConfig.cpu_cores, newConfig.memory_gb,
          newConfig.storage_gb, newConfig.gpu_count, newConfig.gpu_type, newConfig.status,
          createTimeForInsert, newConfig.end_time, newConfig.owner
        ]);
      }
    }
  }
}

// 计算账单
export async function calculateBill(userId: number, period: string) {
  const [year, month] = period.split('-').map(Number);
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const usage = await pool.query(`
    SELECT SUM(cpu_hours) as cpu, SUM(memory_gb_hours) as memory,
           SUM(storage_gb_hours) as storage, SUM(gpu_hours) as gpu
    FROM usage_records ur
    JOIN projects p ON ur.project_id = p.id
    WHERE p.user_id = $1 AND ur.record_date BETWEEN $2 AND $3
  `, [userId, startDate, endDate]);

  const prices = await pool.query('SELECT resource_type, unit_price FROM pricing_config');
  const priceMap = Object.fromEntries(prices.rows.map(r => [r.resource_type, parseFloat(r.unit_price)]));

  const u = usage.rows[0];
  const cpuCost = (parseFloat(u.cpu) || 0) * (priceMap.cpu || 0);
  const memoryCost = (parseFloat(u.memory) || 0) * (priceMap.memory || 0);
  const storageCost = (parseFloat(u.storage) || 0) * (priceMap.storage || 0);
  const gpuCost = (parseFloat(u.gpu) || 0) * (priceMap.gpu || 0);

  await pool.query(`
    INSERT INTO bills (user_id, billing_period, cpu_cost, memory_cost, storage_cost, gpu_cost, total_cost)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (user_id, billing_period) DO UPDATE SET
      cpu_cost = $3, memory_cost = $4, storage_cost = $5, gpu_cost = $6, total_cost = $7
  `, [userId, period, cpuCost, memoryCost, storageCost, gpuCost, cpuCost + memoryCost + storageCost + gpuCost]);
}

// 获取使用明细
export async function getUsageDetails(userId: number, period: string) {
  const [year, month] = period.split('-').map(Number);
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const result = await pool.query(`
    SELECT vm.name as vm_name, vm.vcenter_vm_id, ur.record_date,
           ur.cpu_hours, ur.memory_gb_hours, ur.storage_gb_hours, ur.gpu_hours, ur.gpu_type
    FROM usage_records ur
    JOIN virtual_machines vm ON ur.vm_id = vm.id
    JOIN projects p ON ur.project_id = p.id
    WHERE p.user_id = $1 AND ur.record_date BETWEEN $2 AND $3
    ORDER BY ur.record_date, vm.name
  `, [userId, startDate, endDate]);

  return result.rows;
}

export function generateCSV(bill: any) {
  return `用户ID,账期,CPU费用,内存费用,存储费用,GPU费用,总费用,状态
${bill.user_id},${bill.billing_period},${bill.cpu_cost},${bill.memory_cost},${bill.storage_cost},${bill.gpu_cost},${bill.total_cost},${bill.status}`;
}
