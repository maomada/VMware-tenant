import { Router, Response } from 'express';
import { pool } from '../db';
import { auth, AuthRequest } from '../middleware/auth';
import {
  generateDailyBills,
  cleanupOldBills,
  syncVMConfigsWithBinding,
  getDailyBills,
  getBillSummary,
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

// 获取账单汇总
router.get('/summary', auth, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user?.role === 'admin';
  const { startDate, endDate, projectId } = req.query;

  const summary = await getBillSummary({
    projectId: projectId ? parseInt(projectId as string) : undefined,
    startDate: startDate as string,
    endDate: endDate as string,
    userId: isAdmin ? undefined : req.user?.id
  });

  res.json(summary);
});

// 获取账单统计（按日/月/季度聚合）
router.get('/stats', auth, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user?.role === 'admin';
  const { startDate, endDate, projectId, dimension } = req.query;

  if (!dimension || !['day', 'month', 'quarter'].includes(dimension as string)) {
    return res.status(400).json({ error: 'dimension must be one of: day, month, quarter' });
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
  const { type, startDate, endDate, projectId } = req.query;

  // 计算日期范围
  let start: string, end: string;
  const today = new Date();

  switch (type) {
    case 'day':
      start = end = (startDate as string) || today.toISOString().split('T')[0];
      break;
    case 'month':
      const monthDate = startDate ? new Date(startDate as string) : today;
      start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).toISOString().split('T')[0];
      end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).toISOString().split('T')[0];
      break;
    case 'quarter':
    default:
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      start = startDate as string || threeMonthsAgo.toISOString().split('T')[0];
      end = endDate as string || today.toISOString().split('T')[0];
  }

  const bills = await getDailyBills({
    projectId: projectId ? parseInt(projectId as string) : undefined,
    startDate: start,
    endDate: end,
    userId: isAdmin ? undefined : req.user?.id
  });

  // 生成Excel (使用简单的CSV格式，前端可转换)
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('账单明细');

  // 设置表头
  sheet.columns = [
    { header: '项目名称', key: 'project_name', width: 20 },
    { header: '虚机名称', key: 'vm_name', width: 25 },
    { header: '虚机ID', key: 'vcenter_vm_id', width: 15 },
    { header: '计费日期', key: 'bill_date', width: 12 },
    { header: 'CPU核数', key: 'cpu_cores', width: 10 },
    { header: '内存(GB)', key: 'memory_gb', width: 10 },
    { header: '存储(GB)', key: 'storage_gb', width: 10 },
    { header: 'GPU数量', key: 'gpu_count', width: 10 },
    { header: 'GPU型号', key: 'gpu_type', width: 25 },
    { header: '单价', key: 'unit_price', width: 10 },
    { header: '当日费用', key: 'daily_cost', width: 12 },
    { header: '创建时间', key: 'created_at', width: 20 }
  ];

  // 添加数据
  for (const bill of bills) {
    sheet.addRow({
      project_name: bill.project_name,
      vm_name: bill.vm_name,
      vcenter_vm_id: bill.vcenter_vm_id,
      bill_date: bill.bill_date?.toISOString?.().split('T')[0] || bill.bill_date,
      cpu_cores: bill.cpu_cores,
      memory_gb: bill.memory_gb,
      storage_gb: bill.storage_gb,
      gpu_count: bill.gpu_count,
      gpu_type: bill.gpu_type || '-',
      unit_price: bill.unit_price,
      daily_cost: bill.daily_cost,
      created_at: bill.created_at?.toISOString?.() || bill.created_at
    });
  }

  // 添加汇总行
  const totalCost = bills.reduce((sum, b) => sum + parseFloat(b.daily_cost || 0), 0);
  sheet.addRow({});
  sheet.addRow({
    project_name: '合计',
    daily_cost: totalCost.toFixed(2)
  });

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
