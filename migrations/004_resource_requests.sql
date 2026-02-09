BEGIN;

-- Resource request tables
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
        (status IN ('approved', 'deploying', 'deployed') AND approved_by IS NOT NULL) OR
        (status NOT IN ('approved', 'deploying', 'deployed'))
    )
);

CREATE INDEX idx_resource_requests_user ON resource_requests(user_id);
CREATE INDEX idx_resource_requests_status ON resource_requests(status);
CREATE INDEX idx_resource_requests_created ON resource_requests(created_at DESC);
CREATE INDEX idx_resource_requests_project ON resource_requests(project_id);

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
        (requires_gpu = TRUE AND gpu_count > 0 AND gpu_model IS NOT NULL) OR
        (requires_gpu = FALSE AND gpu_count = 0)
    )
);

CREATE INDEX idx_vm_items_request ON vm_request_items(request_id);
CREATE INDEX idx_vm_items_status ON vm_request_items(deployment_status);
CREATE INDEX idx_vm_items_vcenter ON vm_request_items(vcenter_vm_id);

CREATE TABLE gpu_inventory (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(100) NOT NULL UNIQUE,
    device_name VARCHAR(200) NOT NULL,
    gpu_model VARCHAR(100) NOT NULL,
    host_name VARCHAR(200) NOT NULL,
    host_id VARCHAR(100) NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'allocated', 'maintenance', 'error')),
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

CREATE INDEX idx_gpu_inventory_status ON gpu_inventory(status);
CREATE INDEX idx_gpu_inventory_host ON gpu_inventory(host_id);
CREATE INDEX idx_gpu_inventory_model ON gpu_inventory(gpu_model);
CREATE INDEX idx_gpu_inventory_allocated ON gpu_inventory(allocated_to_vm);

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

    CONSTRAINT unique_network_segment UNIQUE (environment, network_segment)
);

CREATE INDEX idx_network_pools_env ON network_pools(environment);
CREATE INDEX idx_network_pools_active ON network_pools(is_active);

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

    CONSTRAINT unique_ip_allocation UNIQUE (pool_id, ip_address, status)
);

CREATE INDEX idx_ip_allocations_pool ON ip_allocations(pool_id);
CREATE INDEX idx_ip_allocations_ip ON ip_allocations(ip_address);
CREATE INDEX idx_ip_allocations_vm ON ip_allocations(vm_item_id);
CREATE INDEX idx_ip_allocations_status ON ip_allocations(status);

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

CREATE INDEX idx_deployment_logs_request ON deployment_logs(request_id);
CREATE INDEX idx_deployment_logs_vm_item ON deployment_logs(vm_item_id);
CREATE INDEX idx_deployment_logs_level ON deployment_logs(log_level);
CREATE INDEX idx_deployment_logs_created ON deployment_logs(created_at DESC);

CREATE TABLE deployment_tasks (
    id SERIAL PRIMARY KEY,

    vm_item_id INTEGER NOT NULL REFERENCES vm_request_items(id) ON DELETE CASCADE,

    task_id VARCHAR(100) NOT NULL UNIQUE,
    task_type VARCHAR(50) NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('queued', 'running', 'success', 'error')),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),

    error_message TEXT,
    start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_deployment_tasks_vm_item ON deployment_tasks(vm_item_id);
CREATE INDEX idx_deployment_tasks_status ON deployment_tasks(status);
CREATE INDEX idx_deployment_tasks_task_id ON deployment_tasks(task_id);

CREATE TABLE request_approvals (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES resource_requests(id) ON DELETE CASCADE,
    action VARCHAR(20) NOT NULL CHECK (action IN ('approved', 'rejected')),
    admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    admin_notes TEXT,
    rejection_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_request_approvals_request ON request_approvals(request_id);
CREATE INDEX idx_request_approvals_admin ON request_approvals(admin_id);
CREATE INDEX idx_request_approvals_created ON request_approvals(created_at DESC);

-- Seed network pools
INSERT INTO network_pools (environment, network_segment, gateway, subnet_mask, dns_servers, ip_range_start, ip_range_end, total_ips, description)
VALUES
('development', '10.0.102.0/24', '10.0.102.1', '255.255.255.0', ARRAY['8.8.8.8', '8.8.4.4'], '10.0.102.10', '10.0.102.250', 241, 'Development network pool'),
('testing', '10.0.101.0/24', '10.0.101.1', '255.255.255.0', ARRAY['8.8.8.8', '8.8.4.4'], '10.0.101.10', '10.0.101.250', 241, 'Testing network pool'),
('production', '10.0.100.0/24', '10.0.100.1', '255.255.255.0', ARRAY['8.8.8.8', '8.8.4.4'], '10.0.100.10', '10.0.100.250', 241, 'Production network pool')
ON CONFLICT (environment, network_segment) DO NOTHING;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_resource_requests_updated_at BEFORE UPDATE ON resource_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vm_request_items_updated_at BEFORE UPDATE ON vm_request_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_gpu_inventory_updated_at BEFORE UPDATE ON gpu_inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_network_pools_updated_at BEFORE UPDATE ON network_pools FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_deployment_tasks_updated_at BEFORE UPDATE ON deployment_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION generate_request_number()
RETURNS VARCHAR(50) AS $$
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

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role') THEN
        ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));
        CREATE INDEX idx_users_role ON users(role);
    END IF;
END $$;

COMMIT;
