import { Router } from 'express';
import { pool } from '../db';
import { auth, AuthRequest } from '../middleware/auth';
import { vsphere } from '../services/vsphere';
import { generateBillForVM } from '../services/dailyBilling';

const router = Router();

async function syncProjectVMs(
  project: any,
  options: { requireFolderId?: boolean } = {}
) {
  let folderId = project.vcenter_folder_id;
  console.log(`[Sync] Project: ${project.name}, FolderId: ${folderId}, Path: ${project.vcenter_folder_path}`);

  if (!folderId) {
    const trimmedPath = (project.vcenter_folder_path || '').replace(/\/+$/, '');
    const folderName = trimmedPath.split('/').pop();
    if (folderName) {
      console.log(`[Sync] Looking up folder: ${folderName}`);
      folderId = await vsphere.getFolderByName(folderName);
    }
    if (!folderId) {
      if (options.requireFolderId) {
        throw new Error('Folder not found in vCenter');
      }
      return { synced: 0, vms: [], didSync: false };
    }
    await pool.query('UPDATE projects SET vcenter_folder_id = $1 WHERE id = $2', [folderId, project.id]);
  }

  console.log(`[Sync] Getting VMs from folder: ${folderId}`);
  const vcenterVMs = await vsphere.getVMsByFolder(folderId);
  console.log(`[Sync] Found ${vcenterVMs.length} VMs`);
  const now = new Date();
  let synced = 0;
  const vcenterVMIds = new Set(vcenterVMs.map((v: any) => v.vm));

  for (const vm of vcenterVMs) {
    const details = await vsphere.getVM(vm.vm);
    const gpuInfo = await vsphere.getVmGpuInfo(vm.vm);
    const metadata = await vsphere.getVMMetadata(vm.vm);
    const existing = await pool.query(
      'SELECT id, project_id FROM virtual_machines WHERE vcenter_vm_id = $1',
      [vm.vm]
    );
    const oldProjectId = existing.rows[0]?.project_id;
    const isNewBinding = existing.rows.length === 0 || oldProjectId !== project.id;

    const upserted = await pool.query(
      `INSERT INTO virtual_machines (
        project_id, vcenter_vm_id, name, cpu_cores, memory_gb, storage_gb,
        gpu_count, gpu_type, status, bound_at, create_time, end_time, owner
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, $10), $12, $13)
       ON CONFLICT (vcenter_vm_id) DO UPDATE SET
         project_id = $1, name = $3, cpu_cores = $4, memory_gb = $5, storage_gb = $6, gpu_count = $7, gpu_type = $8, status = $9,
         bound_at = CASE WHEN virtual_machines.project_id IS DISTINCT FROM $1 THEN $10 ELSE virtual_machines.bound_at END,
         unbound_at = CASE WHEN virtual_machines.project_id IS DISTINCT FROM $1 THEN NULL ELSE virtual_machines.unbound_at END,
         create_time = COALESCE($11, virtual_machines.create_time),
         end_time = $12,
         owner = COALESCE($13, virtual_machines.owner)
       RETURNING id`,
      [
        project.id,
        vm.vm,
        vm.name,
        details.cpu?.count || 1,
        Math.ceil((details.memory?.size_MiB || 1024) / 1024),
        Math.ceil((details.disks ? Object.values(details.disks).reduce((sum: number, d: any) => sum + (d.capacity || 0), 0) : 0) / 1024 / 1024 / 1024),
        gpuInfo.gpuCount,
        gpuInfo.gpuType,
        vm.power_state || 'unknown',
        now,
        metadata.createTime,
        metadata.deadline,
        metadata.owner
      ]
    );
    if (isNewBinding) {
      const vmId = upserted.rows[0]?.id ?? existing.rows[0]?.id;
      if (vmId) {
        await generateBillForVM(vmId);
      }
    }
    synced++;
  }

  // Mark VMs removed from folder as unbound
  const dbVMs = await pool.query(
    'SELECT id, vcenter_vm_id, name FROM virtual_machines WHERE project_id = $1 AND unbound_at IS NULL',
    [project.id]
  );
  for (const dbVM of dbVMs.rows) {
    if (!vcenterVMIds.has(dbVM.vcenter_vm_id)) {
      await pool.query('UPDATE virtual_machines SET unbound_at = $1 WHERE id = $2', [now, dbVM.id]);
      console.log(`[Sync] VM ${dbVM.name} unbound from project`);
    }
  }

  const vms = await pool.query('SELECT * FROM virtual_machines WHERE project_id = $1 AND unbound_at IS NULL', [project.id]);
  return { synced, vms: vms.rows, didSync: true };
}

router.get('/', auth, async (req: AuthRequest, res) => {
  const result = await pool.query(
    'SELECT * FROM projects WHERE user_id = $1 ORDER BY id',
    [req.user?.id]
  );
  res.json(result.rows);
});

router.post('/', auth, async (req: AuthRequest, res) => {
  const { name, projectCode, vcenterFolderPath } = req.body;

  const trimmedCode = String(projectCode || '').trim();
  if (!trimmedCode) {
    return res.status(400).json({ error: 'project_code is required' });
  }
  if (!/^[A-Z0-9_-]+$/.test(trimmedCode)) {
    return res.status(400).json({ error: 'Invalid project_code format' });
  }

  const existingCode = await pool.query('SELECT 1 FROM projects WHERE project_code = $1', [trimmedCode]);
  if (existingCode.rows.length > 0) {
    return res.status(400).json({ error: 'project_code already exists' });
  }

  const folderName = vcenterFolderPath.split('/').pop();
  let folderId = null;
  try {
    folderId = await vsphere.getFolderByName(folderName);
  } catch (e) {
    // vCenter 连接失败时继续，稍后可以同步
  }

  try {
    const result = await pool.query(
      `INSERT INTO projects (user_id, name, project_code, vcenter_folder_path, vcenter_folder_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user?.id, name, trimmedCode, vcenterFolderPath, folderId]
    );
    const project = result.rows[0];
    let vmCount = 0;
    let firstSyncDone = false;

    try {
      const syncResult = await syncProjectVMs(project);
      vmCount = syncResult.vms.length;
      firstSyncDone = syncResult.didSync;
    } catch (err) {
      console.warn(`[Sync] Initial sync failed for project ${project.id}:`, err);
    }

    res.json({ ...project, vmCount, firstSyncDone });
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(400).json({ error: 'project_code already exists' });
    }
    throw err;
  }
});

router.get('/:id', auth, async (req: AuthRequest, res) => {
  const result = await pool.query(
    'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user?.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(result.rows[0]);
});

router.delete('/:id', auth, async (req: AuthRequest, res) => {
  await pool.query('DELETE FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, req.user?.id]);
  res.json({ success: true });
});

router.post('/:id/sync', auth, async (req: AuthRequest, res) => {
  console.log(`[Sync] Starting sync for project ${req.params.id}`);
  const project = await pool.query(
    'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user?.id]
  );
  if (!project.rows[0]) return res.status(404).json({ error: 'Not found' });

  const p = project.rows[0];

  try {
    const { synced, vms } = await syncProjectVMs(p, { requireFolderId: true });
    res.json({ synced, vms });
  } catch (err: any) {
    if (err instanceof Error && err.message === 'Folder not found in vCenter') {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
});

export default router;
