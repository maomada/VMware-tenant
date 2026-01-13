import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { pool } from './db';
import authRoutes from './routes/auth';
import projectRoutes from './routes/project';
import vmRoutes from './routes/vm';
import billingRoutes from './routes/billing';
import adminRoutes from './routes/admin';

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
app.use('/api/admin', adminRoutes);

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// 每小时记录资源使用
cron.schedule('0 * * * *', async () => {
  try {
    const vms = await pool.query("SELECT * FROM virtual_machines WHERE status = 'POWERED_ON'");
    const today = new Date().toISOString().split('T')[0];

    for (const vm of vms.rows) {
      await pool.query(`
        INSERT INTO usage_records (vm_id, project_id, record_date, cpu_hours, memory_gb_hours, storage_gb_hours, gpu_hours)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (vm_id, record_date) DO UPDATE SET
          cpu_hours = usage_records.cpu_hours + $4,
          memory_gb_hours = usage_records.memory_gb_hours + $5,
          storage_gb_hours = usage_records.storage_gb_hours + $6,
          gpu_hours = usage_records.gpu_hours + $7
      `, [vm.id, vm.project_id, today, vm.cpu_cores, vm.memory_gb, vm.storage_gb, vm.gpu_count]);
    }
  } catch (err) {
    console.error('Cron job error:', err);
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
