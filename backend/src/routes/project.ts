import { Router } from 'express';
import { pool } from '../db';
import { auth, AuthRequest } from '../middleware/auth';
import { vsphere } from '../services/vsphere';

const router = Router();

router.get('/', auth, async (req: AuthRequest, res) => {
  const result = await pool.query(
    'SELECT * FROM projects WHERE user_id = $1 ORDER BY id',
    [req.user?.id]
  );
  res.json(result.rows);
});

router.post('/', auth, async (req: AuthRequest, res) => {
  const { name, vcenterFolderPath } = req.body;

  const folderName = vcenterFolderPath.split('/').pop();
  let folderId = null;
  try {
    folderId = await vsphere.getFolderByName(folderName);
  } catch (e) {
    // vCenter 连接失败时继续，稍后可以同步
  }

  const result = await pool.query(
    `INSERT INTO projects (user_id, name, vcenter_folder_path, vcenter_folder_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.user?.id, name, vcenterFolderPath, folderId]
  );
  res.json(result.rows[0]);
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
  let folderId = p.vcenter_folder_id;
  console.log(`[Sync] Project: ${p.name}, FolderId: ${folderId}, Path: ${p.vcenter_folder_path}`);

  if (!folderId) {
    const folderName = p.vcenter_folder_path.split('/').pop();
    console.log(`[Sync] Looking up folder: ${folderName}`);
    folderId = await vsphere.getFolderByName(folderName);
    if (!folderId) return res.status(400).json({ error: 'Folder not found in vCenter' });
    await pool.query('UPDATE projects SET vcenter_folder_id = $1 WHERE id = $2', [folderId, p.id]);
  }

  console.log(`[Sync] Getting VMs from folder: ${folderId}`);
  const vcenterVMs = await vsphere.getVMsByFolder(folderId);
  console.log(`[Sync] Found ${vcenterVMs.length} VMs`);
  let synced = 0;

  for (const vm of vcenterVMs) {
    const details = await vsphere.getVM(vm.vm);
    const gpuInfo = await vsphere.getVmGpuInfo(vm.vm);
    await pool.query(
      `INSERT INTO virtual_machines (project_id, vcenter_vm_id, name, cpu_cores, memory_gb, storage_gb, gpu_count, gpu_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (vcenter_vm_id) DO UPDATE SET
         project_id = $1, name = $3, cpu_cores = $4, memory_gb = $5, storage_gb = $6, gpu_count = $7, gpu_type = $8, status = $9`,
      [
        p.id,
        vm.vm,
        vm.name,
        details.cpu?.count || 1,
        Math.ceil((details.memory?.size_MiB || 1024) / 1024),
        Math.ceil((details.disks ? Object.values(details.disks).reduce((sum: number, d: any) => sum + (d.capacity || 0), 0) : 0) / 1024 / 1024 / 1024),
        gpuInfo.gpuCount,
        gpuInfo.gpuType,
        vm.power_state || 'unknown'
      ]
    );
    synced++;
  }

  const vms = await pool.query('SELECT * FROM virtual_machines WHERE project_id = $1', [p.id]);
  res.json({ synced, vms: vms.rows });
});

export default router;
