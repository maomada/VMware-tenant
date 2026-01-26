-- 用户表
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'user')),
    email_verified BOOLEAN DEFAULT FALSE,
    verification_token VARCHAR(100),
    verification_expires TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 项目表 (对应 vCenter Folder)
CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    project_code VARCHAR(50) UNIQUE NOT NULL,
    vcenter_folder_path VARCHAR(500),
    vcenter_folder_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

-- 虚拟机表
CREATE TABLE virtual_machines (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    vcenter_vm_id VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    cpu_cores INTEGER NOT NULL,
    memory_gb INTEGER NOT NULL,
    storage_gb INTEGER NOT NULL,
    gpu_count INTEGER DEFAULT 0,
    gpu_type VARCHAR(100),
    create_time TIMESTAMP,
    end_time TIMESTAMP,
    owner VARCHAR(100),
    status VARCHAR(20) DEFAULT 'unknown',
    bound_at TIMESTAMP,
    unbound_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 资源价格配置表
CREATE TABLE pricing_config (
    id SERIAL PRIMARY KEY,
    resource_type VARCHAR(20) NOT NULL UNIQUE,
    unit_price DECIMAL(10,4) NOT NULL,
    effective_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 资源使用记录表
CREATE TABLE usage_records (
    id SERIAL PRIMARY KEY,
    vm_id INTEGER REFERENCES virtual_machines(id),
    project_id INTEGER REFERENCES projects(id),
    record_date DATE NOT NULL,
    cpu_hours DECIMAL(10,2) DEFAULT 0,
    memory_gb_hours DECIMAL(10,2) DEFAULT 0,
    storage_gb_hours DECIMAL(10,2) DEFAULT 0,
    gpu_hours DECIMAL(10,2) DEFAULT 0,
    gpu_type VARCHAR(100),
    UNIQUE(vm_id, record_date)
);

-- 账单表
CREATE TABLE bills (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    billing_period VARCHAR(7) NOT NULL,
    cpu_cost DECIMAL(12,2) DEFAULT 0,
    memory_cost DECIMAL(12,2) DEFAULT 0,
    storage_cost DECIMAL(12,2) DEFAULT 0,
    gpu_cost DECIMAL(12,2) DEFAULT 0,
    total_cost DECIMAL(12,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, billing_period)
);

-- 初始化默认价格
INSERT INTO pricing_config (resource_type, unit_price) VALUES
('cpu', 0.08),
('memory', 0.16),
('storage', 0.50),
('gpu_3090', 11.00),
('gpu_t4', 5.00)
ON CONFLICT (resource_type) DO NOTHING;

-- 每日账单表
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

CREATE INDEX IF NOT EXISTS idx_daily_bills_date ON daily_bills(bill_date);
CREATE INDEX IF NOT EXISTS idx_daily_bills_project ON daily_bills(project_id);

-- 创建默认管理员 (密码: admin123, 邮箱: admin@leinao.ai)
INSERT INTO users (username, email, password_hash, role, email_verified, status) VALUES
('admin', 'admin@leinao.ai', '$2b$10$rB5NaTlxfHbxRN152ivoEegVw3uVKfC4sbF6Dy9PNAbdeRAgp2m.O', 'admin', TRUE, 'active')
ON CONFLICT (email) DO NOTHING;
