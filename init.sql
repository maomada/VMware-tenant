-- 租户表
CREATE TABLE tenants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    contact_email VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 用户表
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'tenant')),
    tenant_id INTEGER REFERENCES tenants(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 虚拟机表
CREATE TABLE virtual_machines (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    vcenter_vm_id VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    cpu_cores INTEGER NOT NULL,
    memory_gb INTEGER NOT NULL,
    storage_gb INTEGER NOT NULL,
    gpu_count INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'unknown',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 资源价格配置表
CREATE TABLE pricing_config (
    id SERIAL PRIMARY KEY,
    resource_type VARCHAR(20) NOT NULL,
    unit_price DECIMAL(10,4) NOT NULL,
    effective_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 资源使用记录表
CREATE TABLE usage_records (
    id SERIAL PRIMARY KEY,
    vm_id INTEGER REFERENCES virtual_machines(id),
    tenant_id INTEGER REFERENCES tenants(id),
    record_date DATE NOT NULL,
    cpu_hours DECIMAL(10,2) DEFAULT 0,
    memory_gb_hours DECIMAL(10,2) DEFAULT 0,
    storage_gb_hours DECIMAL(10,2) DEFAULT 0,
    gpu_hours DECIMAL(10,2) DEFAULT 0,
    UNIQUE(vm_id, record_date)
);

-- 账单表
CREATE TABLE bills (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id),
    billing_period VARCHAR(7) NOT NULL,
    cpu_cost DECIMAL(12,2) DEFAULT 0,
    memory_cost DECIMAL(12,2) DEFAULT 0,
    storage_cost DECIMAL(12,2) DEFAULT 0,
    gpu_cost DECIMAL(12,2) DEFAULT 0,
    total_cost DECIMAL(12,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, billing_period)
);

-- 初始化默认价格
INSERT INTO pricing_config (resource_type, unit_price) VALUES
('cpu', 0.05),
('memory', 0.01),
('storage', 0.001),
('gpu', 0.50);

-- 创建默认管理员 (密码: admin123)
INSERT INTO users (username, password_hash, role) VALUES
('admin', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'admin');
