import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import authRoutes from './routes/auth';
import projectRoutes from './routes/project';
import vmRoutes from './routes/vm';
import billingRoutes from './routes/billing';
import dailyBillingRoutes from './routes/dailyBilling';
import adminRoutes from './routes/admin';
import { recordUsage, syncVMConfigs } from './services/billing';
import { generateDailyBills, cleanupOldBills, syncVMConfigsWithBinding } from './services/dailyBilling';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Async error wrapper
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/vms', vmRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/daily-billing', dailyBillingRoutes);
app.use('/api/admin', adminRoutes);

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// 每小时记录资源使用
cron.schedule('0 * * * *', async () => {
  try {
    console.log('[Cron] Recording usage...');
    await recordUsage();
  } catch (err) {
    console.error('[Cron] recordUsage error:', err);
  }
});

// 每天 00:05 生成每日账单
cron.schedule('5 0 * * *', async () => {
  try {
    console.log('[Cron] Generating daily bills...');
    await syncVMConfigsWithBinding();
    await generateDailyBills();
  } catch (err) {
    console.error('[Cron] generateDailyBills error:', err);
  }
});

// 每天 23:30 同步 VM 配置
cron.schedule('30 23 * * *', async () => {
  try {
    console.log('[Cron] Syncing VM configs...');
    await syncVMConfigs();
  } catch (err) {
    console.error('[Cron] syncVMConfigs error:', err);
  }
});

// 每月1号 02:00 清理超过3个月的账单
cron.schedule('0 2 1 * *', async () => {
  try {
    console.log('[Cron] Cleaning up old bills...');
    await cleanupOldBills();
  } catch (err) {
    console.error('[Cron] cleanupOldBills error:', err);
  }
});

// 防止未捕获异常导致进程崩溃
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
