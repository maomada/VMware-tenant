import { Router, Response } from 'express';
import { pool } from '../db';
import { auth, AuthRequest } from '../middleware/auth';
import {
  generateDailyBills,
  cleanupOldBills,
  syncVMConfigsWithBinding,
  getDailyBills,
  getStatsByDimension
} from '../services/dailyBilling';

const router = Router();

// 获取每日账单列表
router.get('/daily', auth, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user?.role === 'admin';
  const { startDate, endDate, projectId } = req.query;

  const bills = await getDailyBills({
    projectId: projectId ? parseInt(projectId as string) : undefined,
    startDate: startDate as string,
    endDate: endDate as string,
    userId: isAdmin ? undefined : req.user?.id
  });

  res.json(bills);
});

// 获取账单统计（按日/月/季度聚合）
router.get('/stats', auth, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user?.role === 'admin';
  const { startDate, endDate, projectId, dimension } = req.query;

  if (!dimension || !['day', 'month'].includes(dimension as string)) {
    return res.status(400).json({ error: 'dimension must be one of: day, month' });
  }

  const stats = await getStatsByDimension({
    dimension: dimension as any,
    projectId: projectId ? parseInt(projectId as string) : undefined,
    startDate: startDate as string,
    endDate: endDate as string,
    userId: isAdmin ? undefined : req.user?.id
  });

  res.json(stats);
});

// 导出Excel账单
router.get('/export', auth, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user?.role === 'admin';
  const { startDate, endDate, projectId } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  const start = startDate as string;
  const end = endDate as string;

  const bills = await getDailyBills({
    projectId: projectId ? parseInt(projectId as string) : undefined,
    startDate: start,
    endDate: end,
    userId: isAdmin ? undefined : req.user?.id
  });

  // Group bills by project, then by VM
  const projectMap = new Map<number, { projectName: string; projectCode: string | null; vms: Map<string, any[]> }>();
  for (const bill of bills) {
    const projectKey = bill.project_id;
    if (!projectMap.has(projectKey)) {
      projectMap.set(projectKey, {
        projectName: bill.project_name,
        projectCode: bill.project_code || null,
        vms: new Map()
      });
    }
    const project = projectMap.get(projectKey)!;
    if (!project.vms.has(bill.vm_name)) {
      project.vms.set(bill.vm_name, []);
    }
    project.vms.get(bill.vm_name)!.push(bill);
  }

  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('账单明细');

  // 设置表头
  sheet.columns = [
    { header: '项目名称', key: 'project_name', width: 20 },
    { header: '项目编号', key: 'project_code', width: 16 },
    { header: '虚机名称', key: 'vm_name', width: 25 },
    { header: '虚机ID', key: 'vcenter_vm_id', width: 15 },
    { header: '计费日期', key: 'bill_date', width: 12 },
    { header: 'CPU核数', key: 'cpu_cores', width: 10 },
    { header: '内存(GB)', key: 'memory_gb', width: 10 },
    { header: '存储(GB)', key: 'storage_gb', width: 10 },
    { header: 'GPU数量', key: 'gpu_count', width: 10 },
    { header: 'GPU型号', key: 'gpu_type', width: 25 },
    { header: '资源单位', key: 'unit_price', width: 10 },
    { header: '当日费用', key: 'daily_cost', width: 12 }
  ];

  // Style header row
  sheet.getRow(1).font = { bold: true };

  let grandTotal = 0;

  // Add data in hierarchical structure
  for (const [, projectData] of projectMap) {
    let projectTotal = 0;
    let isFirstVMInProject = true;

    for (const [vmName, vmBills] of projectData.vms) {
      let vmTotal = 0;
      let isFirstBillInVM = true;

      for (const bill of vmBills) {
        const cost = parseFloat(bill.daily_cost || 0);
        vmTotal += cost;
        sheet.addRow({
          project_name: isFirstVMInProject ? projectData.projectName : '',
          project_code: isFirstVMInProject ? projectData.projectCode || '' : '',
          vm_name: isFirstBillInVM ? vmName : '',
          vcenter_vm_id: isFirstBillInVM ? bill.vcenter_vm_id : '',
          bill_date: bill.bill_date?.toISOString?.().split('T')[0] || bill.bill_date,
          cpu_cores: bill.cpu_cores,
          memory_gb: bill.memory_gb,
          storage_gb: bill.storage_gb,
          gpu_count: bill.gpu_count,
          gpu_type: bill.gpu_type || '-',
          unit_price: bill.unit_price,
          daily_cost: cost
        });
        isFirstBillInVM = false;
        isFirstVMInProject = false;
      }

      // VM subtotal row
      const vmSubtotalRow = sheet.addRow({
        project_name: '',
        project_code: '',
        vm_name: `${vmName} 小计`,
        daily_cost: vmTotal.toFixed(2)
      });
      vmSubtotalRow.font = { italic: true };
      vmSubtotalRow.getCell('daily_cost').font = { italic: true, bold: true };
      projectTotal += vmTotal;
    }

    // Project total row
    const projectTotalRow = sheet.addRow({
      project_name: `${projectData.projectName} 合计`,
      project_code: '',
      daily_cost: projectTotal.toFixed(2)
    });
    projectTotalRow.font = { bold: true };
    projectTotalRow.getCell('daily_cost').font = { bold: true };
    sheet.addRow({}); // Empty row between projects
    grandTotal += projectTotal;
  }

  // Grand total row
  sheet.addRow({});
  const grandTotalRow = sheet.addRow({
    project_name: '总计',
    project_code: '',
    daily_cost: grandTotal.toFixed(2)
  });
  grandTotalRow.font = { bold: true };
  grandTotalRow.getCell('daily_cost').font = { bold: true };

  // 设置响应头
  const filename = `bills_${start}_${end}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(filename)}`);

  await workbook.xlsx.write(res);
  res.end();
});

// 手动生成今日账单 (admin)
router.post('/generate', auth, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '权限不足' });
  }

  await syncVMConfigsWithBinding();
  const count = await generateDailyBills();
  res.json({ message: `已生成 ${count} 条账单记录` });
});

// 手动清理旧账单 (admin)
router.post('/cleanup', auth, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '权限不足' });
  }

  const count = await cleanupOldBills();
  res.json({ message: `已清理 ${count} 条过期账单` });
});

// 获取价格配置
router.get('/pricing', auth, async (_req: AuthRequest, res: Response) => {
  const result = await pool.query('SELECT * FROM pricing_config ORDER BY resource_type');
  res.json(result.rows);
});

// 更新价格配置 (admin)
router.put('/pricing', auth, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '权限不足' });
  }

  const { resourceType, unitPrice } = req.body;
  await pool.query(`
    INSERT INTO pricing_config (resource_type, unit_price)
    VALUES ($1, $2)
    ON CONFLICT (resource_type) DO UPDATE SET unit_price = $2, effective_from = CURRENT_TIMESTAMP
  `, [resourceType, unitPrice]);

  res.json({ message: '价格已更新' });
});

export default router;
