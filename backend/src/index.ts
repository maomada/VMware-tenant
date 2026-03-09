import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import authRoutes from './routes/auth';
import projectRoutes from './routes/project';
import vmRoutes from './routes/vm';

import dailyBillingRoutes from './routes/dailyBilling';
import adminRoutes from './routes/admin';
import resourceRequestRoutes, { adminRouter as adminResourceRequestRoutes } from './routes/resourceRequest';
import gpuRoutes from './routes/gpu';
import networkPoolRoutes from './routes/network';

import { generateDailyBills, cleanupOldBills, syncVMConfigsWithBinding } from './services/dailyBilling';
import { syncGPUInventory } from './services/gpu';
import { monitorDeploymentTimeouts } from './services/deployment';

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

app.use('/api/daily-billing', dailyBillingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/resource-requests', resourceRequestRoutes);
app.use('/api/admin/resource-requests', adminResourceRequestRoutes);
app.use('/api/gpu', gpuRoutes);
app.use('/api/admin/network-pools', networkPoolRoutes);

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// Every 10 minutes sync VM configs with binding
cron.schedule('*/10 * * * *', async () => {
  try {
    console.log('[Cron] Periodic VM sync...');
    await syncVMConfigsWithBinding();
  } catch (err) {
    console.error('[Cron] periodic VM sync error:', err);
  }
});

// Every 10 minutes sync GPU inventory
cron.schedule('*/10 * * * *', async () => {
  try {
    console.log('[Cron] Syncing GPU inventory...');
    await syncGPUInventory();
  } catch (err) {
    console.error('[Cron] gpu inventory sync error:', err);
  }
});

// Every 5 minutes monitor deployment timeouts
cron.schedule('*/5 * * * *', async () => {
  try {
    const flagged = await monitorDeploymentTimeouts();
    if (flagged > 0) {
      console.warn(`[Cron] Deployment timeouts flagged: ${flagged}`);
    }
  } catch (err) {
    console.error('[Cron] deployment timeout monitor error:', err);
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
