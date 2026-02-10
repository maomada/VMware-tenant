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

-- Updated-at helper
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- GPU inventory
CREATE TABLE gpu_inventory (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(100) UNIQUE NOT NULL,
    device_name VARCHAR(200) NOT NULL,
    gpu_model VARCHAR(100) NOT NULL,
    host_name VARCHAR(200) NOT NULL,
    host_id VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'reserved', 'maintenance')),
    allocated_to_vm VARCHAR(100),
    allocated_at TIMESTAMP,
    pci_address VARCHAR(50),
    vendor_id VARCHAR(20),
    device_type VARCHAR(50),
    memory_mb INTEGER,
    last_synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sync_error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gpu_inventory_allocated ON gpu_inventory(allocated_to_vm);
CREATE INDEX IF NOT EXISTS idx_gpu_inventory_host ON gpu_inventory(host_id);
CREATE INDEX IF NOT EXISTS idx_gpu_inventory_model ON gpu_inventory(gpu_model);
CREATE INDEX IF NOT EXISTS idx_gpu_inventory_status ON gpu_inventory(status);

CREATE TRIGGER update_gpu_inventory_updated_at
BEFORE UPDATE ON gpu_inventory
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Network pools
CREATE TABLE network_pools (
    id SERIAL PRIMARY KEY,
    environment VARCHAR(20) NOT NULL CHECK (environment IN ('development', 'testing', 'production')),
    network_segment VARCHAR(50) NOT NULL,
    gateway INET NOT NULL,
    subnet_mask INET NOT NULL,
    dns_servers TEXT[] NOT NULL,
    ip_range_start INET NOT NULL,
    ip_range_end INET NOT NULL,
    total_ips INTEGER NOT NULL,
    allocated_ips INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(environment, network_segment)
);

CREATE INDEX IF NOT EXISTS idx_network_pools_active ON network_pools(is_active);
CREATE INDEX IF NOT EXISTS idx_network_pools_env ON network_pools(environment);

CREATE TRIGGER update_network_pools_updated_at
BEFORE UPDATE ON network_pools
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Resource requests
CREATE TABLE resource_requests (
    id SERIAL PRIMARY KEY,
    request_number VARCHAR(50) UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    purpose TEXT NOT NULL,
    environment VARCHAR(20) NOT NULL CHECK (environment IN ('development', 'testing', 'production')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'deploying', 'deployed', 'rejected', 'failed')),
    admin_notes TEXT,
    rejection_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP,
    deployed_at TIMESTAMP,
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT valid_approval CHECK (
        (status IN ('approved', 'deploying', 'deployed') AND approved_by IS NOT NULL)
        OR (status NOT IN ('approved', 'deploying', 'deployed'))
    )
);

CREATE INDEX IF NOT EXISTS idx_resource_requests_created ON resource_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resource_requests_project ON resource_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_resource_requests_status ON resource_requests(status);
CREATE INDEX IF NOT EXISTS idx_resource_requests_user ON resource_requests(user_id);

CREATE TRIGGER update_resource_requests_updated_at
BEFORE UPDATE ON resource_requests
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Request number generator
CREATE OR REPLACE FUNCTION generate_request_number()
RETURNS VARCHAR AS $$
DECLARE
    new_number VARCHAR(50);
    date_prefix VARCHAR(8);
    sequence_num INTEGER;
BEGIN
    date_prefix := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');

    SELECT COALESCE(MAX(CAST(SUBSTRING(request_number FROM 11) AS INTEGER)), 0) + 1
    INTO sequence_num
    FROM resource_requests
    WHERE request_number LIKE 'RQ' || date_prefix || '%';

    new_number := 'RQ' || date_prefix || LPAD(sequence_num::TEXT, 3, '0');

    RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- VM request items
CREATE TABLE vm_request_items (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES resource_requests(id) ON DELETE CASCADE,
    vm_name VARCHAR(100),
    template_name VARCHAR(100) NOT NULL,
    cpu_cores INTEGER NOT NULL CHECK (cpu_cores > 0 AND cpu_cores <= 64),
    memory_gb INTEGER NOT NULL CHECK (memory_gb > 0 AND memory_gb <= 512),
    disk_gb INTEGER NOT NULL CHECK (disk_gb > 0 AND disk_gb <= 4096),
    requires_gpu BOOLEAN NOT NULL DEFAULT FALSE,
    gpu_model VARCHAR(100),
    gpu_count INTEGER DEFAULT 0 CHECK (gpu_count >= 0 AND gpu_count <= 8),
    gpu_assigned_ids TEXT[],
    network_segment VARCHAR(50),
    ip_address INET,
    gateway INET,
    dns_servers TEXT[],
    vcenter_vm_id VARCHAR(100),
    vcenter_folder VARCHAR(200),
    deployment_status VARCHAR(20) DEFAULT 'pending' CHECK (deployment_status IN ('pending', 'deploying', 'deployed', 'failed')),
    deployment_error TEXT,
    deployed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_gpu_config CHECK (
        (requires_gpu = TRUE AND gpu_count > 0 AND gpu_model IS NOT NULL)
        OR (requires_gpu = FALSE AND gpu_count = 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_vm_items_request ON vm_request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_vm_items_status ON vm_request_items(deployment_status);
CREATE INDEX IF NOT EXISTS idx_vm_items_vcenter ON vm_request_items(vcenter_vm_id);

CREATE TRIGGER update_vm_request_items_updated_at
BEFORE UPDATE ON vm_request_items
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- IP allocations
CREATE TABLE ip_allocations (
    id SERIAL PRIMARY KEY,
    pool_id INTEGER NOT NULL REFERENCES network_pools(id) ON DELETE CASCADE,
    ip_address INET NOT NULL,
    vm_item_id INTEGER REFERENCES vm_request_items(id) ON DELETE SET NULL,
    vm_name VARCHAR(100),
    vcenter_vm_id VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated', 'released', 'reserved')),
    allocated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at TIMESTAMP,
    notes TEXT,
    UNIQUE(pool_id, ip_address, status)
);

CREATE INDEX IF NOT EXISTS idx_ip_allocations_ip ON ip_allocations(ip_address);
CREATE INDEX IF NOT EXISTS idx_ip_allocations_pool ON ip_allocations(pool_id);
CREATE INDEX IF NOT EXISTS idx_ip_allocations_status ON ip_allocations(status);
CREATE INDEX IF NOT EXISTS idx_ip_allocations_vm ON ip_allocations(vm_item_id);

-- Deployment logs
CREATE TABLE deployment_logs (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES resource_requests(id) ON DELETE CASCADE,
    vm_item_id INTEGER REFERENCES vm_request_items(id) ON DELETE CASCADE,
    log_level VARCHAR(20) NOT NULL CHECK (log_level IN ('info', 'warning', 'error', 'debug')),
    message TEXT NOT NULL,
    details JSONB,
    operation VARCHAR(50),
    operator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deployment_logs_created ON deployment_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployment_logs_level ON deployment_logs(log_level);
CREATE INDEX IF NOT EXISTS idx_deployment_logs_request ON deployment_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_deployment_logs_vm_item ON deployment_logs(vm_item_id);

-- Deployment tasks
CREATE TABLE deployment_tasks (
    id SERIAL PRIMARY KEY,
    vm_item_id INTEGER NOT NULL REFERENCES vm_request_items(id) ON DELETE CASCADE,
    task_id VARCHAR(100) UNIQUE NOT NULL,
    task_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('queued', 'running', 'success', 'error')),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    error_message TEXT,
    start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deployment_tasks_status ON deployment_tasks(status);
CREATE INDEX IF NOT EXISTS idx_deployment_tasks_task_id ON deployment_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_deployment_tasks_vm_item ON deployment_tasks(vm_item_id);

CREATE TRIGGER update_deployment_tasks_updated_at
BEFORE UPDATE ON deployment_tasks
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Request approvals
CREATE TABLE request_approvals (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES resource_requests(id) ON DELETE CASCADE,
    action VARCHAR(20) NOT NULL CHECK (action IN ('approved', 'rejected')),
    admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    admin_notes TEXT,
    rejection_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_request_approvals_admin ON request_approvals(admin_id);
CREATE INDEX IF NOT EXISTS idx_request_approvals_created ON request_approvals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_approvals_request ON request_approvals(request_id);

-- 创建默认管理员 (密码: admin123, 邮箱: admin@leinao.ai)
INSERT INTO users (username, email, password_hash, role, email_verified, status) VALUES
('admin', 'admin@leinao.ai', '$2b$10$rB5NaTlxfHbxRN152ivoEegVw3uVKfC4sbF6Dy9PNAbdeRAgp2m.O', 'admin', TRUE, 'active')
ON CONFLICT (email) DO NOTHING;
