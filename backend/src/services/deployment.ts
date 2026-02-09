import { pool } from '../db';
import { vsphere } from './vsphere';
import { allocateIP, getNetworkConfig, releaseIP } from './network';
import { generateBillForVM } from './dailyBilling';

const DEFAULT_TIMEOUT_MS = Number(process.env.DEPLOYMENT_TIMEOUT) || 30 * 60 * 1000;
const MONITOR_TIMEOUT_MS = Number(process.env.DEPLOYMENT_MONITOR_TIMEOUT) || 30 * 60 * 1000;

const ENV_FOLDER_MAP: Record<string, string> = {
  development: 'Development',
  testing: 'Testing',
  production: 'Production'
};

export interface DeploymentVmConfig {
  vm_item_id: number;
  vm_name?: string;
  template_name?: string;
  datastore?: string;
  vcenter_folder?: string;
}

export interface ExecuteDeploymentOptions {
  vm_configs?: DeploymentVmConfig[];
  operatorId?: number;
}

interface DeploymentContext {
  vmItemId: number;
  vmName: string;
  ipAddress?: string;
  gpuIds: string[];
  vcenterVmId?: string;
}

async function logDeployment(params: {
  requestId: number;
  vmItemId?: number | null;
  level: 'info' | 'warning' | 'error' | 'debug';
  message: string;
  details?: any;
  operation?: string;
  operatorId?: number;
}) {
  await pool.query(
    `INSERT INTO deployment_logs (request_id, vm_item_id, log_level, message, details, operation, operator_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.requestId,
      params.vmItemId ?? null,
      params.level,
      params.message,
      params.details ? JSON.stringify(params.details) : null,
      params.operation || null,
      params.operatorId || null
    ]
  );
}

async function recordTask(vmItemId: number, taskId: string, taskType: string) {
  await pool.query(
    `INSERT INTO deployment_tasks (vm_item_id, task_id, task_type, status, progress)
     VALUES ($1, $2, $3, 'running', 0)
     ON CONFLICT (task_id) DO NOTHING`,
    [vmItemId, taskId, taskType]
  );
}

async function updateTaskStatus(taskId: string, status: 'running' | 'success' | 'error', progress: number, errorMessage?: string) {
  await pool.query(
    `UPDATE deployment_tasks
     SET status = $2,
         progress = $3,
         error_message = $4,
         end_time = CASE WHEN $2 IN ('success', 'error') THEN CURRENT_TIMESTAMP ELSE end_time END
     WHERE task_id = $1`,
    [taskId, status, progress, errorMessage || null]
  );
}

async function waitForTask(vmItemId: number, taskId: string, taskType: string, timeoutMs: number) {
  await recordTask(vmItemId, taskId, taskType);
  const status = await vsphere.waitForTask(taskId, timeoutMs);
  await updateTaskStatus(taskId, status.status === 'success' ? 'success' : 'error', status.progress, status.errorMessage);
  if (status.status !== 'success') {
    throw new Error(status.errorMessage || `${taskType} failed`);
  }
  return status;
}

async function waitForPowerOn(vmId: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await vsphere.getPowerState(vmId);
    const powerState = typeof state?.state === 'string' ? state.state : state?.power_state;
    if (powerState === 'POWERED_ON') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('Power on timeout');
}

async function ensureProjectForRequest(request: any) {
  if (request.project_id) {
    const existing = await pool.query('SELECT * FROM projects WHERE id = $1', [request.project_id]);
    if (!existing.rows[0]) {
      throw new Error('Project not found');
    }
    return existing.rows[0];
  }

  const baseCode = String(request.request_number || '').trim() || `REQ-${request.id}`;
  const baseName = baseCode;
  let projectCode = baseCode;
  let projectName = baseName;
  let suffix = 1;

  while (true) {
    const codeExists = await pool.query('SELECT 1 FROM projects WHERE project_code = $1', [projectCode]);
    const nameExists = await pool.query('SELECT 1 FROM projects WHERE user_id = $1 AND name = $2', [request.user_id, projectName]);
    if (!codeExists.rows[0] && !nameExists.rows[0]) break;
    projectCode = `${baseCode}-${suffix}`;
    projectName = `${baseName}-${suffix}`;
    suffix += 1;
  }

  let folderId: string | null = null;
  try {
    folderId = await vsphere.getFolderByName(projectName);
  } catch {
    folderId = null;
  }

  const insertRes = await pool.query(
    `INSERT INTO projects (user_id, name, project_code, vcenter_folder_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [request.user_id, projectName, projectCode, folderId]
  );

  const project = insertRes.rows[0];
  await pool.query('UPDATE resource_requests SET project_id = $1 WHERE id = $2', [project.id, request.id]);
  return project;
}

async function bindVMToProject(params: {
  project: any;
  vmId: string;
  vmName: string;
  item: any;
}) {
  const existing = await pool.query(
    'SELECT id, project_id FROM virtual_machines WHERE vcenter_vm_id = $1',
    [params.vmId]
  );
  const isNewBinding = !existing.rows[0] || existing.rows[0].project_id !== params.project.id;
  const now = new Date();

  const upserted = await pool.query(
    `INSERT INTO virtual_machines (
      project_id, vcenter_vm_id, name, cpu_cores, memory_gb, storage_gb,
      gpu_count, gpu_type, status, bound_at, create_time
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (vcenter_vm_id) DO UPDATE SET
       project_id = $1, name = $3, cpu_cores = $4, memory_gb = $5, storage_gb = $6,
       gpu_count = $7, gpu_type = $8, status = $9,
       bound_at = CASE WHEN virtual_machines.project_id IS DISTINCT FROM $1 THEN $10 ELSE virtual_machines.bound_at END,
       unbound_at = CASE WHEN virtual_machines.project_id IS DISTINCT FROM $1 THEN NULL ELSE virtual_machines.unbound_at END
     RETURNING id`,
    [
      params.project.id,
      params.vmId,
      params.vmName,
      params.item.cpu_cores,
      params.item.memory_gb,
      params.item.disk_gb,
      params.item.gpu_count || 0,
      params.item.gpu_model || null,
      'POWERED_ON',
      now,
      now
    ]
  );

  const vmDbId = upserted.rows[0]?.id ?? existing.rows[0]?.id;
  if (isNewBinding && vmDbId) {
    await generateBillForVM(vmDbId);
  }
}

async function performRollback(
  requestId: number,
  context: DeploymentContext,
  step: string,
  operatorId?: number
) {
  try {
    if (context.ipAddress) {
      await releaseIP(context.ipAddress);
    }
  } catch (err) {
    await logDeployment({
      requestId,
      vmItemId: context.vmItemId,
      level: 'warning',
      message: 'Rollback: failed to release IP',
      details: { error: String(err) },
      operation: 'rollback_ip',
      operatorId
    });
  }

  try {
    if (context.gpuIds.length) {
      await vsphere.releaseGPUs(context.gpuIds);
    }
  } catch (err) {
    await logDeployment({
      requestId,
      vmItemId: context.vmItemId,
      level: 'warning',
      message: 'Rollback: failed to release GPUs',
      details: { error: String(err) },
      operation: 'rollback_gpu',
      operatorId
    });
  }

  await logDeployment({
    requestId,
    vmItemId: context.vmItemId,
    level: 'error',
    message: `Rollback triggered after ${step}`,
    details: { step },
    operation: 'rollback',
    operatorId
  });
}

export async function rollbackDeployment(requestId: number, step: string) {
  const itemsRes = await pool.query(
    `SELECT id, ip_address, gpu_assigned_ids
     FROM vm_request_items
     WHERE request_id = $1`,
    [requestId]
  );

  for (const item of itemsRes.rows) {
    const context: DeploymentContext = {
      vmItemId: item.id,
      vmName: '',
      ipAddress: item.ip_address || undefined,
      gpuIds: item.gpu_assigned_ids || []
    };
    await performRollback(requestId, context, step);
  }
}

async function deployVmItem(params: {
  request: any;
  item: any;
  config?: DeploymentVmConfig;
  operatorId?: number;
}) {
  const vmName = params.config?.vm_name || params.item.vm_name || `${params.request.request_number}-${params.item.id}`;
  const templateName = params.config?.template_name || params.item.template_name;
  const datastoreName = params.config?.datastore;
  const folderPath =
    params.config?.vcenter_folder ||
    params.request.project_name ||
    ENV_FOLDER_MAP[params.request.environment] ||
    params.request.environment;

  const context: DeploymentContext = {
    vmItemId: params.item.id,
    vmName,
    gpuIds: []
  };

  try {
    await logDeployment({
      requestId: params.request.id,
      vmItemId: params.item.id,
      level: 'info',
      message: 'Starting deployment',
      details: { vmName, templateName, datastore: datastoreName, folderPath },
      operation: 'preflight',
      operatorId: params.operatorId
    });

    const allocation = await allocateIP(params.request.environment, params.item.id);
    context.ipAddress = allocation.ipAddress;

    let gpuIds: string[] = [];
    if (params.item.requires_gpu) {
      gpuIds = await vsphere.reserveGPUs(params.item.gpu_model, params.item.gpu_count || 0);
      if (gpuIds.length < (params.item.gpu_count || 0)) {
        throw new Error('Insufficient GPU resources');
      }
      context.gpuIds = gpuIds;
    }

    await pool.query(
      `UPDATE vm_request_items
       SET vm_name = $1,
           network_segment = $2,
           ip_address = $3,
           gateway = $4,
           dns_servers = $5,
           gpu_assigned_ids = $6
       WHERE id = $7`,
      [
        vmName,
        allocation.networkSegment,
        allocation.ipAddress,
        allocation.gateway,
        allocation.dnsServers,
        gpuIds.length ? gpuIds : null,
        params.item.id
      ]
    );

    await logDeployment({
      requestId: params.request.id,
      vmItemId: params.item.id,
      level: 'info',
      message: 'Resources allocated',
      details: { ipAddress: allocation.ipAddress, gpuIds },
      operation: 'allocate_resources',
      operatorId: params.operatorId
    });

    const clone = await vsphere.cloneVM({
      templateName,
      vmName,
      datastoreName,
      folderPath
    });
    const cloneStatus = await waitForTask(params.item.id, clone.taskId, 'CloneVM_Task', DEFAULT_TIMEOUT_MS);
    const vmId = cloneStatus.resultId;
    if (!vmId) {
      throw new Error('Clone completed without VM id');
    }
    context.vcenterVmId = vmId;

    await pool.query(
      `UPDATE vm_request_items
       SET vcenter_vm_id = $1,
           vcenter_folder = $2
       WHERE id = $3`,
      [vmId, folderPath, params.item.id]
    );

    await pool.query(
      `UPDATE ip_allocations
       SET vm_name = $1,
           vcenter_vm_id = $2
       WHERE ip_address = $3 AND status = 'allocated'`,
      [vmName, vmId, allocation.ipAddress]
    );

    await logDeployment({
      requestId: params.request.id,
      vmItemId: params.item.id,
      level: 'info',
      message: 'VM cloned',
      details: { vmId },
      operation: 'clone_vm',
      operatorId: params.operatorId
    });

    const reconfigTask = await vsphere.reconfigureVM(vmId, {
      cpuCores: params.item.cpu_cores,
      memoryMB: params.item.memory_gb * 1024,
      diskGB: params.item.disk_gb
    });
    await waitForTask(params.item.id, reconfigTask, 'ReconfigVM_Task', DEFAULT_TIMEOUT_MS);

    await logDeployment({
      requestId: params.request.id,
      vmItemId: params.item.id,
      level: 'info',
      message: 'Hardware configured',
      operation: 'reconfigure_vm',
      operatorId: params.operatorId
    });

    const networkTask = await vsphere.configureNetwork(vmId, {
      ipAddress: allocation.ipAddress,
      gateway: allocation.gateway,
      subnetMask: allocation.subnetMask,
      dnsServers: allocation.dnsServers,
      hostName: vmName
    });
    await waitForTask(params.item.id, networkTask, 'CustomizeVM_Task', DEFAULT_TIMEOUT_MS);

    await logDeployment({
      requestId: params.request.id,
      vmItemId: params.item.id,
      level: 'info',
      message: 'Network configured',
      operation: 'configure_network',
      operatorId: params.operatorId
    });

    if (params.item.requires_gpu && gpuIds.length) {
      const gpuRows = await pool.query(
        `SELECT device_id, host_id, device_name, vendor_id
         FROM gpu_inventory
         WHERE device_id = ANY($1::text[])`,
        [gpuIds]
      );
      const attachTask = await vsphere.attachGPUPassthrough(vmId, {
        devices: gpuRows.rows.map((row: any) => ({
          deviceId: row.device_id,
          hostId: row.host_id,
          deviceName: row.device_name,
          vendorId: row.vendor_id || undefined
        }))
      });
      await waitForTask(params.item.id, attachTask, 'ReconfigVM_Task_GPU', DEFAULT_TIMEOUT_MS);

      await logDeployment({
        requestId: params.request.id,
        vmItemId: params.item.id,
        level: 'info',
        message: 'GPU passthrough attached',
        details: { gpuIds },
        operation: 'attach_gpu',
        operatorId: params.operatorId
      });
    }

    await vsphere.powerOn(vmId);
    await waitForPowerOn(vmId, DEFAULT_TIMEOUT_MS);

    await logDeployment({
      requestId: params.request.id,
      vmItemId: params.item.id,
      level: 'info',
      message: 'VM powered on',
      operation: 'power_on',
      operatorId: params.operatorId
    });

    if (gpuIds.length) {
      await pool.query(
        `UPDATE gpu_inventory
         SET status = 'in_use',
             allocated_to_vm = $2,
             allocated_at = CURRENT_TIMESTAMP
         WHERE device_id = ANY($1::text[])`,
        [gpuIds, vmId]
      );
    }

    const project = await ensureProjectForRequest(params.request);
    params.request.project_id = project.id;
    params.request.project_name = project.name;
    await bindVMToProject({
      project,
      vmId,
      vmName,
      item: params.item
    });

    await pool.query(
      `UPDATE vm_request_items
       SET deployment_status = 'deployed',
           deployment_error = NULL,
           deployed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [params.item.id]
    );

    await logDeployment({
      requestId: params.request.id,
      vmItemId: params.item.id,
      level: 'info',
      message: 'Deployment finalized',
      operation: 'finalize',
      operatorId: params.operatorId
    });
  } catch (err) {
    await performRollback(params.request.id, context, 'deploy', params.operatorId);
    throw err;
  }
}

export async function executeDeployment(requestId: number, options: ExecuteDeploymentOptions = {}) {
  const requestRes = await pool.query(
    `SELECT rr.*, u.id AS user_id, u.username AS user_name, p.name AS project_name
     FROM resource_requests rr
     JOIN users u ON rr.user_id = u.id
     LEFT JOIN projects p ON rr.project_id = p.id
     WHERE rr.id = $1`,
    [requestId]
  );
  const request = requestRes.rows[0];
  if (!request) {
    throw new Error('Request not found');
  }

  if (!['approved', 'failed'].includes(request.status)) {
    throw new Error('Request status conflict');
  }

  const itemsRes = await pool.query(
    `SELECT * FROM vm_request_items WHERE request_id = $1 ORDER BY id`,
    [requestId]
  );
  const items = itemsRes.rows;
  if (!items.length) {
    throw new Error('No VM items to deploy');
  }

  const configMap = new Map<number, DeploymentVmConfig>();
  for (const cfg of options.vm_configs || []) {
    configMap.set(cfg.vm_item_id, cfg);
  }

  const vcenterVMs = await vsphere.listVMs();
  const existingNames = new Set((vcenterVMs || []).map((vm: any) => String(vm.name || '').toLowerCase()));
  const vmNameSet = new Set<string>();
  for (const item of items) {
    const cfg = configMap.get(item.id);
    const vmName = cfg?.vm_name || item.vm_name || `${request.request_number}-${item.id}`;
    const nameKey = vmName.toLowerCase();
    if (vmNameSet.has(nameKey)) {
      throw new Error(`Duplicate VM name: ${vmName}`);
    }
    if (existingNames.has(nameKey)) {
      throw new Error(`VM name already exists: ${vmName}`);
    }
    vmNameSet.add(nameKey);

    const templateName = cfg?.template_name || item.template_name;
    if (!templateName) {
      throw new Error(`Template name missing for VM item ${item.id}`);
    }
    const templateExists = (vcenterVMs || []).some((vm: any) => String(vm.name || '') === templateName);
    if (!templateExists) {
      throw new Error(`Template not found: ${templateName}`);
    }

    if (item.requires_gpu) {
      const ok = await vsphere.validateGPUAvailability(item.gpu_model, item.gpu_count || 0);
      if (!ok) {
        throw new Error(`Insufficient GPU availability for ${item.gpu_model}`);
      }
    }
  }

  const networkConfig = await getNetworkConfig(request.environment);
  if (!networkConfig) {
    throw new Error(`Network config not found for ${request.environment}`);
  }

  const updateRes = await pool.query(
    `UPDATE resource_requests
     SET status = 'deploying', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status IN ('approved', 'failed')
     RETURNING id`,
    [requestId]
  );
  if (!updateRes.rows[0]) {
    throw new Error('Request status conflict');
  }

  await pool.query(
    `UPDATE vm_request_items
     SET deployment_status = 'deploying',
         deployment_error = NULL
     WHERE request_id = $1`,
    [requestId]
  );

  await logDeployment({
    requestId,
    level: 'info',
    message: 'Deployment started',
    details: { vmCount: items.length },
    operation: 'start',
    operatorId: options.operatorId
  });

  let allSucceeded = true;
  for (const item of items) {
    try {
      await deployVmItem({
        request,
        item,
        config: configMap.get(item.id),
        operatorId: options.operatorId
      });
    } catch (err: any) {
      allSucceeded = false;
      const errorMessage = err instanceof Error ? err.message : String(err);
      await pool.query(
        `UPDATE vm_request_items
         SET deployment_status = 'failed',
             deployment_error = $2
         WHERE id = $1`,
        [item.id, errorMessage]
      );
      await logDeployment({
        requestId,
        vmItemId: item.id,
        level: 'error',
        message: 'Deployment failed',
        details: { error: errorMessage },
        operation: 'error',
        operatorId: options.operatorId
      });
      await pool.query(
        `UPDATE vm_request_items
         SET deployment_status = 'failed',
             deployment_error = COALESCE(deployment_error, 'Deployment aborted')
         WHERE request_id = $1 AND deployment_status = 'deploying'`,
        [requestId]
      );
      break;
    }
  }

  if (allSucceeded) {
    await pool.query(
      `UPDATE resource_requests
       SET status = 'deployed',
           deployed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [requestId]
    );
    await logDeployment({
      requestId,
      level: 'info',
      message: 'Deployment completed',
      operation: 'complete',
      operatorId: options.operatorId
    });
  } else {
    await pool.query(
      `UPDATE resource_requests
       SET status = 'failed'
       WHERE id = $1`,
      [requestId]
    );
    await logDeployment({
      requestId,
      level: 'error',
      message: 'Deployment marked as failed',
      operation: 'failed',
      operatorId: options.operatorId
    });
  }

  return {
    requestId,
    status: allSucceeded ? 'deployed' : 'failed'
  };
}

export async function monitorDeploymentTimeouts() {
  const cutoff = new Date(Date.now() - MONITOR_TIMEOUT_MS);
  const deploying = await pool.query(
    `SELECT id, request_number, updated_at
     FROM resource_requests
     WHERE status = 'deploying' AND updated_at < $1`,
    [cutoff]
  );

  for (const req of deploying.rows) {
    await pool.query(
      `UPDATE resource_requests
       SET status = 'failed'
       WHERE id = $1`,
      [req.id]
    );

    await pool.query(
      `UPDATE vm_request_items
       SET deployment_status = 'failed',
           deployment_error = 'Deployment timeout'
       WHERE request_id = $1 AND deployment_status = 'deploying'`,
      [req.id]
    );

    await logDeployment({
      requestId: req.id,
      level: 'error',
      message: 'Deployment timeout',
      details: { updatedAt: req.updated_at },
      operation: 'timeout'
    });
  }

  return deploying.rows.length;
}
