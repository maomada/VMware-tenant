-- 每日账单表：按天按VM记录计费
CREATE TABLE IF NOT EXISTS daily_bills (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    vm_id INTEGER REFERENCES virtual_machines(id) ON DELETE CASCADE,
    bill_date DATE NOT NULL,
    cpu_cores INTEGER NOT NULL DEFAULT 0,
    memory_gb INTEGER NOT NULL DEFAULT 0,
    storage_gb INTEGER NOT NULL DEFAULT 0,
    gpu_count INTEGER NOT NULL DEFAULT 0,
    gpu_type VARCHAR(100),
    unit_price DECIMAL(10,2) DEFAULT 1.00,
    daily_cost DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vm_id, bill_date)
);

-- 添加索引优化查询
CREATE INDEX IF NOT EXISTS idx_daily_bills_date ON daily_bills(bill_date);
CREATE INDEX IF NOT EXISTS idx_daily_bills_project ON daily_bills(project_id);
CREATE INDEX IF NOT EXISTS idx_daily_bills_vm ON daily_bills(vm_id);

-- VM绑定项目时间记录（用于计费起始）
ALTER TABLE virtual_machines ADD COLUMN IF NOT EXISTS bound_at TIMESTAMP;
-- VM移出项目时间记录（用于计费截止）
ALTER TABLE virtual_machines ADD COLUMN IF NOT EXISTS unbound_at TIMESTAMP;
