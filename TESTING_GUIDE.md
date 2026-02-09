# VM Resource Request System - Testing Guide

## System Overview

This is a comprehensive VM resource request and automated deployment system with:
- User self-service VM request forms
- Admin approval workflow
- Automated VM deployment with GPU support
- Network pool management with IP allocation
- Integration with VMware vCenter

## 1. Prerequisites

### 1.1 Infrastructure Requirements
- ✅ VMware vCenter Server accessible from backend
- ✅ PostgreSQL database (version 12+)
- ✅ Node.js (version 18+)
- ✅ SMTP server for email verification (optional for testing)

### 1.2 VMware vCenter Requirements
- Valid vCenter credentials with permissions:
  - Virtual Machine management (create, clone, reconfigure, power operations)
  - Folder access and management
  - Datastore access
  - Resource pool access
  - PCI device management (for GPU passthrough)
  - Custom field reading
- VM templates available in vCenter
- Network folders configured (or will use default: Development, Testing, Production)

### 1.3 Provided VMware Credentials
```
vCenter URL: https://10.0.200.100
Username: administrator@vsphere.local
Password: Leinao@323
MOB Browser: https://10.0.200.100/mob/
```

## 2. Configuration Setup

### 2.1 Create Environment File

Copy `.env.example` to `.env` in the project root:

```bash
cp .env.example .env
```

Edit `.env` with the following configuration:

```env
# Database Configuration
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DATABASE_URL=postgresql://postgres:your_postgres_password@localhost:5432/vmware_tenant

# VMware vCenter Configuration (ALREADY CONFIGURED)
VCENTER_URL=https://10.0.200.100
VCENTER_USER=administrator@vsphere.local
VCENTER_PASSWORD=Leinao@323

# JWT Secret (CHANGE THIS!)
JWT_SECRET=your-strong-random-secret-key-min-32-chars

# SMTP Configuration (Optional for testing - can skip email verification)
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password

# Frontend URL
FRONTEND_URL=http://localhost:5173

# Optional: Backend Port
PORT=3000

# Optional: Enable GPU Debug Logging
VSPHERE_GPU_DEBUG=1
```

### 2.2 Database Setup

1. Create PostgreSQL database:
```bash
createdb vmware_tenant
# OR using psql:
psql -U postgres -c "CREATE DATABASE vmware_tenant;"
```

2. Run migrations in order:
```bash
psql -U postgres -d vmware_tenant -f migrations/001_add_project_code.sql
psql -U postgres -d vmware_tenant -f migrations/002_add_vm_metadata.sql
psql -U postgres -d vmware_tenant -f migrations/003_remove_vcenter_folder_path.sql
psql -U postgres -d vmware_tenant -f migrations/004_resource_requests.sql
psql -U postgres -d vmware_tenant -f migrations/005_update_gpu_inventory_status.sql
```

**Note:** Migration 004 includes seeded network pools:
- Development: 10.0.102.0/24 (IPs: 10.0.102.10-250)
- Testing: 10.0.101.0/24 (IPs: 10.0.101.10-250)
- Production: 10.0.100.0/24 (IPs: 10.0.100.10-250)

### 2.3 Install Dependencies

Backend:
```bash
cd backend
npm install
```

Frontend:
```bash
cd frontend
npm install
```

## 3. Starting the System

### 3.1 Start Backend Server
```bash
cd backend
npm run dev
```

Backend will start on `http://localhost:3000`

### 3.2 Start Frontend Development Server
```bash
cd frontend
npm run dev
```

Frontend will start on `http://localhost:5173`

### 3.3 Default Admin Account
- Email: `admin@leinao.ai`
- Password: `admin123`
- **Important:** Change password after first login

## 4. API Endpoints Reference

### 4.1 Authentication Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/auth/register` | User registration (requires @leinao.ai email) | No |
| GET | `/api/auth/verify/:token` | Email verification | No |
| POST | `/api/auth/login` | User login | No |
| GET | `/api/auth/me` | Get current user info | Yes |
| POST | `/api/auth/resend-verification` | Resend verification email | No |

### 4.2 Resource Request Endpoints (User)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/resource-requests` | Create new resource request | Yes (User) |
| GET | `/api/resource-requests` | List user's requests | Yes (User) |
| GET | `/api/resource-requests/:id` | Get request details | Yes (User) |
| DELETE | `/api/resource-requests/:id` | Delete pending request | Yes (User) |

**Query Parameters for GET /api/resource-requests:**
- `status`: pending, approved, deploying, deployed, rejected, failed
- `environment`: development, testing, production
- `search`: Search in request_number, purpose
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 10)

### 4.3 Resource Request Endpoints (Admin)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/admin/resource-requests` | List all requests | Yes (Admin) |
| GET | `/api/admin/resource-requests/stats` | Get statistics | Yes (Admin) |
| PATCH | `/api/admin/resource-requests/:id/approve` | Approve request | Yes (Admin) |
| PATCH | `/api/admin/resource-requests/:id/reject` | Reject request | Yes (Admin) |
| POST | `/api/admin/resource-requests/:id/deploy` | Deploy approved request | Yes (Admin) |
| GET | `/api/admin/resource-requests/:id/deployment-logs` | Get deployment logs | Yes (Admin) |

**Approve Request Body:**
```json
{
  "adminNotes": "Approved for development testing"
}
```

**Reject Request Body:**
```json
{
  "rejectionReason": "Insufficient resources available"
}
```

### 4.4 GPU Management Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/gpu/inventory` | List GPU inventory | Yes (Admin) |
| POST | `/api/gpu/sync` | Sync GPU inventory from vCenter | Yes (Admin) |
| GET | `/api/gpu/availability` | Get GPU availability by model | Yes (Admin) |
| PATCH | `/api/gpu/:id/status` | Update GPU status | Yes (Admin) |

**Query Parameters for GET /api/gpu/inventory:**
- `status`: available, allocated, maintenance, error
- `gpu_model`: RTX3090, T4, etc.
- `host_name`: ESXi host name

**Update GPU Status Body:**
```json
{
  "status": "maintenance"  // allowed: available, maintenance
}
```

### 4.5 Network Pool Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/admin/network-pools` | List all network pools | Yes (Admin) |
| POST | `/api/admin/network-pools` | Create network pool | Yes (Admin) |
| PUT | `/api/admin/network-pools/:id` | Update network pool | Yes (Admin) |
| DELETE | `/api/admin/network-pools/:id` | Delete network pool | Yes (Admin) |
| GET | `/api/admin/network-pools/:id/ip-allocations` | Get IP allocations | Yes (Admin) |

**Create Network Pool Body:**
```json
{
  "environment": "development",
  "networkSegment": "10.0.103.0/24",
  "gateway": "10.0.103.1",
  "subnetMask": "255.255.255.0",
  "dnsServers": ["8.8.8.8", "8.8.4.4"],
  "ipRangeStart": "10.0.103.10",
  "ipRangeEnd": "10.0.103.250",
  "description": "Development network pool"
}
```

## 5. Testing Scenarios

### 5.1 Initial System Verification

#### Test 1: Verify Backend Connection
```bash
curl http://localhost:3000/api/auth/me
# Expected: 401 Unauthorized (confirms server is running)
```

#### Test 2: Login as Admin
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@leinao.ai",
    "password": "admin123"
  }'
# Expected: Returns JWT token
```

Save the token for subsequent requests:
```bash
export TOKEN="your_jwt_token_here"
```

#### Test 3: Sync GPU Inventory
```bash
curl -X POST http://localhost:3000/api/gpu/sync \
  -H "Authorization: Bearer $TOKEN"
# Expected: Returns synced GPU devices from vCenter
```

#### Test 4: Verify Network Pools
```bash
curl http://localhost:3000/api/admin/network-pools \
  -H "Authorization: Bearer $TOKEN"
# Expected: Returns 3 seeded network pools (development, testing, production)
```

### 5.2 User Registration and Login Flow

#### Test 5: Register New User
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser@leinao.ai",
    "password": "Test123!",
    "fullName": "Test User"
  }'
# Expected: Success message (email verification required)
```

**Note:** If SMTP is not configured, manually verify user in database:
```sql
UPDATE users SET is_verified = true WHERE email = 'testuser@leinao.ai';
```

#### Test 6: Login as User
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser@leinao.ai",
    "password": "Test123!"
  }'
# Save user token
export USER_TOKEN="user_jwt_token_here"
```

### 5.3 Resource Request Creation Flow

#### Test 7: Create Resource Request (Simple VM)
```bash
curl -X POST http://localhost:3000/api/resource-requests \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "purpose": "Development testing environment",
    "environment": "development",
    "vmItems": [
      {
        "vmName": "dev-test-vm-01",
        "templateName": "Ubuntu-20.04-Template",
        "cpuCores": 4,
        "memoryGb": 8,
        "diskGb": 100,
        "requiresGpu": false,
        "networkSegment": "10.0.102.0/24"
      }
    ]
  }'
# Expected: Returns created request with request_number (e.g., RQ20260128001)
```

#### Test 8: Create Resource Request (VM with GPU)
```bash
curl -X POST http://localhost:3000/api/resource-requests \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "purpose": "Machine learning training",
    "environment": "testing",
    "vmItems": [
      {
        "vmName": "ml-training-vm-01",
        "templateName": "Ubuntu-20.04-Template",
        "cpuCores": 8,
        "memoryGb": 32,
        "diskGb": 500,
        "requiresGpu": true,
        "gpuModel": "RTX3090",
        "gpuCount": 2,
        "networkSegment": "10.0.101.0/24"
      }
    ]
  }'
# Expected: Returns created request
```

#### Test 9: List User's Requests
```bash
curl "http://localhost:3000/api/resource-requests?page=1&limit=10" \
  -H "Authorization: Bearer $USER_TOKEN"
# Expected: Returns paginated list of user's requests
```

#### Test 10: Get Request Details
```bash
curl http://localhost:3000/api/resource-requests/1 \
  -H "Authorization: Bearer $USER_TOKEN"
# Expected: Returns detailed request information including VM items
```

### 5.4 Admin Approval and Deployment Flow

#### Test 11: List All Requests (Admin)
```bash
curl "http://localhost:3000/api/admin/resource-requests?status=pending" \
  -H "Authorization: Bearer $TOKEN"
# Expected: Returns all pending requests
```

#### Test 12: Get Request Statistics
```bash
curl http://localhost:3000/api/admin/resource-requests/stats \
  -H "Authorization: Bearer $TOKEN"
# Expected: Returns statistics (status counts, environment counts, GPU usage, trends)
```

#### Test 13: Approve Request
```bash
curl -X PATCH http://localhost:3000/api/admin/resource-requests/1/approve \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "adminNotes": "Approved for development testing"
  }'
# Expected: Request status changes to 'approved'
```

#### Test 14: Deploy Approved Request
```bash
curl -X POST http://localhost:3000/api/admin/resource-requests/1/deploy \
  -H "Authorization: Bearer $TOKEN"
# Expected: Deployment starts, returns success message
```

**Deployment Process (8 Steps):**
1. Preflight checks (template exists, GPU available, network pool exists)
2. Resource allocation (IP address, GPU reservation)
3. Clone VM from template
4. Reconfigure hardware (CPU, memory, disk)
5. Configure network (static IP, gateway, DNS)
6. Attach GPU devices (if required)
7. Power on VM
8. Finalize (create project, bind VM, generate bill)

#### Test 15: Monitor Deployment Logs
```bash
curl http://localhost:3000/api/admin/resource-requests/1/deployment-logs \
  -H "Authorization: Bearer $TOKEN"
# Expected: Returns detailed deployment logs with timestamps
```

#### Test 16: Verify Deployment in vCenter
- Open vCenter MOB: https://10.0.200.100/mob/
- Navigate to VM folder
- Verify VM exists with correct configuration:
  - CPU cores
  - Memory
  - Disk size
  - Network configuration (static IP)
  - GPU devices attached (if applicable)

### 5.5 GPU Management Testing

#### Test 17: List GPU Inventory
```bash
curl "http://localhost:3000/api/gpu/inventory?status=available" \
  -H "Authorization: Bearer $TOKEN"
# Expected: Returns available GPU devices
```

#### Test 18: Check GPU Availability
```bash
curl http://localhost:3000/api/gpu/availability \
  -H "Authorization: Bearer $TOKEN"
# Expected: Returns GPU availability by model (e.g., RTX3090: 4 available)
```

#### Test 19: Update GPU Status
```bash
curl -X PATCH http://localhost:3000/api/gpu/1/status \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "maintenance"
  }'
# Expected: GPU status updated to maintenance
```

### 5.6 Network Pool Management Testing

#### Test 20: View IP Allocations
```bash
curl http://localhost:3000/api/admin/network-pools/1/ip-allocations \
  -H "Authorization: Bearer $TOKEN"
# Expected: Returns allocated IPs with VM details
```

#### Test 21: Create Custom Network Pool
```bash
curl -X POST http://localhost:3000/api/admin/network-pools \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "environment": "development",
    "networkSegment": "10.0.103.0/24",
    "gateway": "10.0.103.1",
    "subnetMask": "255.255.255.0",
    "dnsServers": ["8.8.8.8", "8.8.4.4"],
    "ipRangeStart": "10.0.103.10",
    "ipRangeEnd": "10.0.103.250",
    "description": "Custom development pool"
  }'
# Expected: Network pool created
```

### 5.7 Error Handling and Edge Cases

#### Test 22: Request with Invalid Template
```bash
curl -X POST http://localhost:3000/api/resource-requests \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "purpose": "Test invalid template",
    "environment": "development",
    "vmItems": [
      {
        "vmName": "test-vm",
        "templateName": "NonExistentTemplate",
        "cpuCores": 2,
        "memoryGb": 4,
        "diskGb": 50,
        "requiresGpu": false,
        "networkSegment": "10.0.102.0/24"
      }
    ]
  }'
# Expected: Request created, but deployment will fail at preflight check
```

#### Test 23: Request More GPUs Than Available
```bash
curl -X POST http://localhost:3000/api/resource-requests \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "purpose": "Test GPU shortage",
    "environment": "testing",
    "vmItems": [
      {
        "vmName": "gpu-test-vm",
        "templateName": "Ubuntu-20.04-Template",
        "cpuCores": 4,
        "memoryGb": 16,
        "diskGb": 200,
        "requiresGpu": true,
        "gpuModel": "RTX3090",
        "gpuCount": 100,
        "networkSegment": "10.0.101.0/24"
      }
    ]
  }'
# Expected: Request created, but deployment will fail at GPU availability check
```

#### Test 24: Reject Request
```bash
curl -X PATCH http://localhost:3000/api/admin/resource-requests/2/reject \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rejectionReason": "Insufficient GPU resources available"
  }'
# Expected: Request status changes to 'rejected'
```

#### Test 25: Delete Pending Request
```bash
curl -X DELETE http://localhost:3000/api/resource-requests/3 \
  -H "Authorization: Bearer $USER_TOKEN"
# Expected: Request deleted (only works for pending requests)
```

## 6. Frontend Testing (Manual)

### 6.1 User Interface Testing

1. **Login Page** (`http://localhost:5173/login`)
   - Test admin login: admin@leinao.ai / admin123
   - Test user login: testuser@leinao.ai / Test123!
   - Verify error messages for invalid credentials

2. **Registration Page** (`http://localhost:5173/register`)
   - Register new user with @leinao.ai email
   - Verify email validation
   - Verify password strength requirements

3. **User Dashboard** (`http://localhost:5173/resource-requests`)
   - View list of resource requests
   - Filter by status, environment
   - Search by request number or purpose
   - Click "Create Request" button

4. **Create Resource Request** (`http://localhost:5173/resource-requests/create`)
   - Fill in purpose and environment
   - Add VM items with specifications
   - Toggle GPU requirement
   - Select GPU model and count
   - Submit request
   - Verify success message

5. **Request Detail Page** (`http://localhost:5173/resource-requests/:id`)
   - View request details
   - View VM item specifications
   - View deployment status
   - Delete pending request

6. **Admin Dashboard** (`http://localhost:5173/admin/resource-requests`)
   - View all resource requests
   - View statistics dashboard
   - Filter and search requests
   - Approve/reject requests
   - Deploy approved requests

7. **GPU Inventory** (`http://localhost:5173/admin/gpu-inventory`)
   - View GPU inventory table
   - Sync GPU inventory button
   - Filter by status, model, host
   - Update GPU status

8. **Network Pools** (`http://localhost:5173/admin/network-pools`)
   - View network pools table
   - Create new network pool
   - Edit existing pool
   - View IP allocations
   - Delete pool

9. **Deployment Logs** (`http://localhost:5173/admin/resource-requests/:id/deployment-logs`)
   - View real-time deployment logs
   - Filter by log level
   - View detailed error messages

## 7. Automated Background Jobs

The system runs several cron jobs automatically:

| Schedule | Job | Description |
|----------|-----|-------------|
| Every hour | Record usage | Records VM resource usage for billing |
| Every 10 min | Sync VM configs | Syncs VM configurations with vCenter |
| Every 10 min | Sync GPU inventory | Updates GPU inventory from vCenter |
| Every 5 min | Monitor deployments | Checks for timeout deployments (>30 min) |
| Daily 00:05 | Generate bills | Generates daily bills for all VMs |
| Daily 23:30 | Sync VM configs | Full VM configuration sync |
| Monthly 02:00 | Cleanup bills | Removes bills older than 3 months + 7 days |

**To verify cron jobs are running:**
```bash
# Check backend logs for cron job execution
tail -f backend/logs/app.log  # if logging is configured
```

## 8. Database Verification

### 8.1 Check Tables
```sql
-- List all tables
\dt

-- Expected tables:
-- users, projects, vms, billing, daily_billing
-- resource_requests, vm_request_items, gpu_inventory
-- network_pools, ip_allocations, deployment_logs
-- deployment_tasks, request_approvals
```

### 8.2 Verify Network Pools
```sql
SELECT * FROM network_pools;
-- Expected: 3 rows (development, testing, production)
```

### 8.3 Check Resource Requests
```sql
SELECT
  rr.id,
  rr.request_number,
  rr.status,
  rr.environment,
  u.email as user_email,
  COUNT(vri.id) as vm_count
FROM resource_requests rr
JOIN users u ON rr.user_id = u.id
LEFT JOIN vm_request_items vri ON rr.id = vri.request_id
GROUP BY rr.id, u.email
ORDER BY rr.created_at DESC;
```

### 8.4 Check GPU Inventory
```sql
SELECT
  gpu_model,
  status,
  COUNT(*) as count
FROM gpu_inventory
GROUP BY gpu_model, status
ORDER BY gpu_model, status;
```

### 8.5 Check IP Allocations
```sql
SELECT
  np.environment,
  np.network_segment,
  COUNT(ia.id) as allocated_ips,
  np.total_ips,
  (np.total_ips - COUNT(ia.id)) as available_ips
FROM network_pools np
LEFT JOIN ip_allocations ia ON np.id = ia.pool_id AND ia.status = 'allocated'
GROUP BY np.id, np.environment, np.network_segment, np.total_ips
ORDER BY np.environment;
```

## 9. Troubleshooting

### 9.1 Common Issues

**Issue: Cannot connect to vCenter**
- Verify `VCENTER_URL` is correct and accessible
- Check network connectivity: `ping 10.0.200.100`
- Verify credentials are correct
- Check vCenter certificate (self-signed certificates are accepted)

**Issue: GPU sync returns empty**
- Verify vCenter user has permission to view PCI devices
- Check if ESXi hosts have GPU devices installed
- Enable GPU debug logging: `VSPHERE_GPU_DEBUG=1`
- Check backend logs for detailed error messages

**Issue: Deployment fails at clone step**
- Verify template name exists in vCenter
- Check datastore has sufficient space
- Verify resource pool exists
- Check vCenter task manager for detailed error

**Issue: Network configuration fails**
- Verify network segment exists in vCenter
- Check IP address is not already in use
- Verify gateway and DNS servers are correct
- Ensure VM tools are installed in template

**Issue: GPU attachment fails**
- Verify GPU devices are available (not allocated)
- Check ESXi host has GPU passthrough enabled
- Verify VM is powered off before GPU attachment
- Check PCI device IDs are correct

### 9.2 Debug Commands

**Check vCenter connectivity:**
```bash
curl -k https://10.0.200.100/rest/com/vmware/cis/session \
  -X POST \
  -u "administrator@vsphere.local:Leinao@323"
```

**Check PostgreSQL connection:**
```bash
psql -U postgres -d vmware_tenant -c "SELECT COUNT(*) FROM users;"
```

**View backend logs:**
```bash
cd backend
npm run dev  # Watch console output
```

**Check deployment task status in database:**
```sql
SELECT * FROM deployment_tasks
WHERE status = 'running'
ORDER BY start_time DESC;
```

**View recent deployment logs:**
```sql
SELECT
  dl.created_at,
  dl.log_level,
  dl.operation,
  dl.message,
  rr.request_number
FROM deployment_logs dl
JOIN resource_requests rr ON dl.request_id = rr.id
ORDER BY dl.created_at DESC
LIMIT 50;
```

## 10. Success Criteria

### 10.1 System is Working Correctly When:

✅ Backend server starts without errors
✅ Frontend loads and displays login page
✅ Admin can login successfully
✅ GPU sync returns devices from vCenter
✅ Network pools show 3 seeded pools
✅ User can register and login
✅ User can create resource request
✅ Admin can view and approve requests
✅ Deployment completes all 8 steps successfully
✅ VM appears in vCenter with correct configuration
✅ GPU devices are attached (if requested)
✅ Network is configured with static IP
✅ Deployment logs show detailed progress
✅ IP allocations are tracked correctly
✅ GPU inventory updates after allocation

### 10.2 Performance Benchmarks

- Resource request creation: < 1 second
- GPU sync: < 30 seconds (depends on host count)
- Request approval: < 1 second
- VM deployment: 5-15 minutes (depends on template size and network speed)
- Deployment monitoring: Real-time updates every 5 seconds

## 11. Next Steps After Testing

1. **Production Hardening:**
   - Change default admin password
   - Generate strong JWT_SECRET
   - Configure production SMTP server
   - Enable HTTPS for backend
   - Set up proper logging and monitoring

2. **Backup Strategy:**
   - Database backups (daily)
   - Configuration backups
   - Deployment log retention policy

3. **Monitoring:**
   - Set up application monitoring
   - Configure vCenter health checks
   - Monitor deployment success rate
   - Track GPU utilization

4. **Documentation:**
   - User guide for creating requests
   - Admin guide for approval workflow
   - Troubleshooting runbook
   - API documentation

## 12. Contact and Support

For issues or questions:
- Check deployment logs in database
- Review backend console output
- Verify vCenter MOB for VM status
- Check PostgreSQL for data consistency

---

**Document Version:** 1.0
**Last Updated:** 2026-01-28
**System Version:** 1.0.0
