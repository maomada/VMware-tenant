import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { pool } from './db';
import authRoutes from './routes/auth';
import tenantRoutes from './routes/tenant';
import vmRoutes from './routes/vm';
import billingRoutes from './routes/billing';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/vms', vmRoutes);
app.use('/api/billing', billingRoutes);

// 每小时记录资源使用
cron.schedule('0 * * * *', async () => {
  const vms = await pool.query("SELECT * FROM virtual_machines WHERE status = 'poweredOn'");
  const today = new Date().toISOString().split('T')[0];

  for (const vm of vms.rows) {
    await pool.query(`
      INSERT INTO usage_records (vm_id, tenant_id, record_date, cpu_hours, memory_gb_hours, storage_gb_hours, gpu_hours)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (vm_id, record_date) DO UPDATE SET
        cpu_hours = usage_records.cpu_hours + $4,
        memory_gb_hours = usage_records.memory_gb_hours + $5,
        storage_gb_hours = usage_records.storage_gb_hours + $6,
        gpu_hours = usage_records.gpu_hours + $7
    `, [vm.id, vm.tenant_id, today, vm.cpu_cores, vm.memory_gb, vm.storage_gb, vm.gpu_count]);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
