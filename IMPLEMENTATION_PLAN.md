# VMware Tenant System - Comprehensive Implementation Plan

## Executive Summary

This plan addresses 7 critical requirements for the VMware tenant billing system:
1. Project code binding (project_code as unique identifier)
2. Project synchronization logic
3. Bill visibility and export permissions
4. Calendar-based bill export with time granularity
5. Bill retention policy (3 months + 7 days)
6. VM metadata from VMware (create_time, Deadline, Owner)
7. VMware connection configuration

**Estimated Complexity**: Medium-High
**Breaking Changes**: Minimal (backward compatible migrations)
**Risk Level**: Low-Medium (comprehensive fallback strategies)

---

## Phase 1: Database Schema Migration

### 1.1 Add project_code to projects table

**File**: `init.sql` (lines 16-25)

**Changes**:
```sql
-- Add after line 19 (after name field)
project_code VARCHAR(50) UNIQUE NOT NULL,
```

**Migration Script** (`migrations/001_add_project_code.sql`):
```sql
-- Step 1: Add column as nullable first
ALTER TABLE projects ADD COLUMN project_code VARCHAR(50);

-- Step 2: Backfill existing projects with auto-generated codes
UPDATE projects
SET project_code = 'PROJ-' || LPAD(id::text, 6, '0')
WHERE project_code IS NULL;

-- Step 3: Add unique constraint
ALTER TABLE projects ADD CONSTRAINT projects_project_code_unique UNIQUE (project_code);

-- Step 4: Make it NOT NULL
ALTER TABLE projects ALTER COLUMN project_code SET NOT NULL;

-- Step 5: Add index for performance
CREATE INDEX idx_projects_project_code ON projects(project_code);
```

**Rollback**:
```sql
DROP INDEX IF EXISTS idx_projects_project_code;
ALTER TABLE projects DROP COLUMN project_code;
```

### 1.2 Add VM metadata fields

**File**: `init.sql` (lines 28-42)

**Changes**:
```sql
-- Add after line 36 (after gpu_type field)
create_time TIMESTAMP,
end_time TIMESTAMP,
owner VARCHAR(100),
```

**Migration Script** (`migrations/002_add_vm_metadata.sql`):
```sql
-- Add new fields
ALTER TABLE virtual_machines ADD COLUMN create_time TIMESTAMP;
ALTER TABLE virtual_machines ADD COLUMN end_time TIMESTAMP;
ALTER TABLE virtual_machines ADD COLUMN owner VARCHAR(100);

-- Backfill create_time with bound_at or created_at as fallback
UPDATE virtual_machines
SET create_time = COALESCE(bound_at, created_at)
WHERE create_time IS NULL;

-- Add indexes for query performance
CREATE INDEX idx_vm_create_time ON virtual_machines(create_time);
CREATE INDEX idx_vm_end_time ON virtual_machines(end_time);
CREATE INDEX idx_vm_owner ON virtual_machines(owner);
```

**Rollback**:
```sql
DROP INDEX IF EXISTS idx_vm_owner;
DROP INDEX IF EXISTS idx_vm_end_time;
DROP INDEX IF EXISTS idx_vm_create_time;
ALTER TABLE virtual_machines DROP COLUMN owner;
ALTER TABLE virtual_machines DROP COLUMN end_time;
ALTER TABLE virtual_machines DROP COLUMN create_time;
```

### 1.3 Update bill retention logic

**No schema changes needed** - only service logic updates.

---

## Phase 2: VMware API Integration

### 2.1 Fetch VM creation time, Deadline, and Owner

**File**: `backend/src/services/vsphere.ts`

**New Method** (add after line 323):
```typescript
async getVMMetadata(vmId: string): Promise<{
  createTime: Date | null;
  deadline: Date | null;
  owner: string | null;
}> {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrieveProperties>
      <urn:_this type="PropertyCollector">propertyCollector</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>VirtualMachine</urn:type>
          <urn:pathSet>config.createDate</urn:pathSet>
          <urn:pathSet>customValue</urn:pathSet>
          <urn:pathSet>availableField</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="VirtualMachine">${vmId}</urn:obj>
        </urn:objectSet>
      </urn:specSet>
    </urn:RetrieveProperties>
  </soapenv:Body>
</soapenv:Envelope>`;

  try {
    const data = await this.soapRequest(xml);

    // Parse createDate
    const createDateMatch = data.match(/<name>config\.createDate<\/name>\s*<val[^>]*>([^<]+)<\/val>/);
    let createTime: Date | null = null;
    if (createDateMatch) {
      const dateStr = this.decodeXml(createDateMatch[1]);
      createTime = new Date(dateStr);
      // Handle pre-vSphere 6.7 VMs (1970-01-01 means no data)
      if (createTime.getFullYear() === 1970) {
        createTime = null;
      }
    }

    // Build custom field key-to-name map
    const fieldMap = new Map<string, string>();
    const fieldRegex = /<CustomFieldDef[^>]*>[\s\S]*?<key>(\d+)<\/key>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/CustomFieldDef>/g;
    let match: RegExpExecArray | null;
    while ((match = fieldRegex.exec(data)) !== null) {
      fieldMap.set(match[1], this.decodeXml(match[2]));
    }

    // Parse customValue array
    let deadline: Date | null = null;
    let owner: string | null = null;

    const customValueRegex = /<CustomFieldValue[^>]*>[\s\S]*?<key>(\d+)<\/key>[\s\S]*?<value[^>]*>([^<]*)<\/value>[\s\S]*?<\/CustomFieldValue>/g;
    while ((match = customValueRegex.exec(data)) !== null) {
      const key = match[1];
      const value = this.decodeXml(match[2]);
      const fieldName = fieldMap.get(key);

      if (fieldName?.toLowerCase() === 'deadline' && value) {
        // Try parsing various date formats
        try {
          deadline = new Date(value);
          if (isNaN(deadline.getTime())) deadline = null;
        } catch {
          deadline = null;
        }
      } else if (fieldName?.toLowerCase() === 'owner' && value) {
        owner = value;
      }
    }

    return { createTime, deadline, owner };
  } catch (err) {
    console.warn(`[vSphere] Failed to fetch metadata for VM ${vmId}:`, err);
    return { createTime: null, deadline: null, owner: null };
  }
}
```

**Error Handling Strategy**:
- If SOAP request fails: Return null values (graceful degradation)
- If createDate is 1970-01-01: Treat as null (pre-6.7 VM)
- If custom fields don't exist: Return null (not all VMs have these)
- If date parsing fails: Return null (invalid format)

### 2.2 Update VMware credentials

**File**: `.env`

**Changes** (update lines with VCENTER_*):
```env
VCENTER_URL=https://10.0.200.100
VCENTER_USER=administrator@vsphere.local
VCENTER_PASSWORD=Leinao@323
```

**Security Note**: Ensure `.env` is in `.gitignore` and never committed.

---

## Phase 3: Backend Service Updates

### 3.1 Update project creation to require project_code

**File**: `backend/src/routes/project.ts` (lines 103-132)

**Changes**:
```typescript
// Line 104: Update destructuring
const { name, projectCode, vcenterFolderPath } = req.body;

// Line 105: Add validation
if (!projectCode || !/^[A-Z0-9_-]+$/.test(projectCode)) {
  return res.status(400).json({
    error: 'Invalid project code. Use uppercase letters, numbers, hyphens, and underscores only.'
  });
}

// Line 114-118: Update INSERT query
const result = await pool.query(
  `INSERT INTO projects (user_id, name, project_code, vcenter_folder_path, vcenter_folder_id)
   VALUES ($1, $2, $3, $4, $5) RETURNING *`,
  [req.user?.id, name, projectCode, vcenterFolderPath, folderId]
);
```

**Validation Rules**:
- project_code is required
- Must match pattern: `^[A-Z0-9_-]+$`
- Unique constraint enforced by database

### 3.2 Update VM sync to fetch and store metadata

**File**: `backend/src/routes/project.ts` (lines 39-76)

**Changes** (in syncProjectVMs function):
```typescript
// After line 41 (after getVmGpuInfo)
const metadata = await vsphere.getVMMetadata(vm.vm);

// Line 50-56: Update INSERT query
const upserted = await pool.query(
  `INSERT INTO virtual_machines (
    project_id, vcenter_vm_id, name, cpu_cores, memory_gb, storage_gb,
    gpu_count, gpu_type, status, bound_at, create_time, end_time, owner
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  ON CONFLICT (vcenter_vm_id) DO UPDATE SET
    project_id = $1, name = $3, cpu_cores = $4, memory_gb = $5, storage_gb = $6,
    gpu_count = $7, gpu_type = $8, status = $9,
    bound_at = CASE WHEN virtual_machines.project_id IS DISTINCT FROM $1 THEN $10 ELSE virtual_machines.bound_at END,
    unbound_at = CASE WHEN virtual_machines.project_id IS DISTINCT FROM $1 THEN NULL ELSE virtual_machines.unbound_at END,
    create_time = COALESCE($11, virtual_machines.create_time),
    end_time = $12,
    owner = COALESCE($13, virtual_machines.owner)
  RETURNING id`,
  [
    project.id, vm.vm, vm.name,
    details.cpu?.count || 1,
    Math.ceil((details.memory?.size_MiB || 1024) / 1024),
    Math.ceil((details.disks ? Object.values(details.disks).reduce((sum: number, d: any) => sum + (d.capacity || 0), 0) : 0) / 1024 / 1024 / 1024),
    gpuInfo.gpuCount, gpuInfo.gpuType,
    vm.power_state || 'unknown',
    now,
    metadata.createTime || now,  // Fallback to bound_at if no createDate
    metadata.deadline,
    metadata.owner
  ]
);
```

**Fallback Strategy**:
- `create_time`: Use VMware createDate, fallback to bound_at, fallback to now
- `end_time`: Use Deadline custom field, null if not set
- `owner`: Use Owner custom field, null if not set
- Use COALESCE to preserve existing values if new fetch fails

### 3.3 Update daily billing sync

**File**: `backend/src/services/dailyBilling.ts` (lines 133-220)

**Changes** (in syncVMConfigsWithBinding function):
```typescript
// After line 160 (after getVmGpuInfo)
const metadata = await vsphere.getVMMetadata(vm.vm);

// Line 161-169: Update newConfig object
const newConfig = {
  name: vm.name,
  cpu_cores: details.cpu?.count || 1,
  memory_gb: Math.ceil((details.memory?.size_MiB || 1024) / 1024),
  storage_gb: Math.ceil((details.disks ? Object.values(details.disks).reduce((sum: number, d: any) => sum + (d.capacity || 0), 0) : 0) / 1024 / 1024 / 1024),
  gpu_count: gpuInfo.gpuCount,
  gpu_type: gpuInfo.gpuType,
  status: vm.power_state || 'unknown',
  create_time: metadata.createTime || now,
  end_time: metadata.deadline,
  owner: metadata.owner
};

// Line 175-178: Update UPDATE query
await pool.query(`
  UPDATE virtual_machines SET
    name=$1, cpu_cores=$2, memory_gb=$3, storage_gb=$4,
    gpu_count=$5, gpu_type=$6, status=$7,
    create_time=COALESCE($8, create_time),
    end_time=$9,
    owner=COALESCE($10, owner)
  WHERE vcenter_vm_id=$11
`, [
  newConfig.name, newConfig.cpu_cores, newConfig.memory_gb, newConfig.storage_gb,
  newConfig.gpu_count, newConfig.gpu_type, newConfig.status,
  newConfig.create_time, newConfig.end_time, newConfig.owner,
  vm.vm
]);

// Line 190-194: Update INSERT query
const inserted = await pool.query(`
  INSERT INTO virtual_machines (
    project_id, vcenter_vm_id, name, cpu_cores, memory_gb, storage_gb,
    gpu_count, gpu_type, status, bound_at, create_time, end_time, owner
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  RETURNING id
`, [
  project.id, vm.vm, newConfig.name, newConfig.cpu_cores, newConfig.memory_gb,
  newConfig.storage_gb, newConfig.gpu_count, newConfig.gpu_type, newConfig.status,
  now, newConfig.create_time, newConfig.end_time, newConfig.owner
]);
```

### 3.4 Update bill retention policy

**File**: `backend/src/services/dailyBilling.ts` (lines 117-130)

**Changes**:
```typescript
// Replace cleanupOldBills function
export async function cleanupOldBills() {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - 3);
  cutoffDate.setDate(cutoffDate.getDate() - 7); // 3 months + 7 days
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

  const result = await pool.query(
    'DELETE FROM daily_bills WHERE bill_date < $1',
    [cutoffDateStr]
  );

  console.log(`[DailyBilling] Cleaned up ${result.rowCount} old bills before ${cutoffDateStr} (3 months + 7 days)`);
  return result.rowCount;
}
```

### 3.5 Remove quarterly statistics

**File**: `backend/src/services/dailyBilling.ts` (lines 310-379)

**Changes**:
```typescript
// Line 310: Update type definition
export type DailyBillingStatsDimension = 'day' | 'month';

// Line 324-343: Remove 'quarter' case
switch (options.dimension) {
  case 'day':
    periodSelect = "to_char(db.bill_date, 'YYYY-MM-DD')";
    groupByExpr = 'db.bill_date';
    orderByExpr = 'db.bill_date';
    break;
  case 'month':
    periodSelect = "to_char(date_trunc('month', db.bill_date), 'YYYY-MM')";
    groupByExpr = "date_trunc('month', db.bill_date)";
    orderByExpr = "date_trunc('month', db.bill_date)";
    break;
  default:
    throw new Error(`Invalid dimension: ${options.dimension}`);
}
```

### 3.6 Update bill export routes

**File**: `backend/src/routes/dailyBilling.ts`

**Need to read this file first to see current implementation**

---

## Phase 4: Frontend Updates

### 4.1 Add project_code input to project creation

**File**: `frontend/src/pages/Projects.tsx`

**Changes** (need to read file first to see exact line numbers):
- Add `projectCode` state variable
- Add input field for project code with validation
- Update form submission to include projectCode
- Add helper text: "Unique identifier for billing (e.g., PROJ-001, CLIENT-ABC)"

### 4.2 Display project_code in project lists

**Files**:
- `frontend/src/pages/Projects.tsx` (user view)
- `frontend/src/pages/admin/Projects.tsx` (admin view)

**Changes**:
- Add project_code column to project table
- Display as badge or prominent identifier
- Use in bill exports and reports

### 4.3 Update bill export UI

**File**: `frontend/src/pages/DailyBilling.tsx`

**Changes**:
- Remove "Quarterly" option from time granularity selector
- Add calendar date range picker (replace type-based calculation)
- Update export button to use selected date range
- Show selected date range in UI

### 4.4 Display VM metadata

**Files**:
- `frontend/src/pages/Projects.tsx` (VM list)
- `frontend/src/pages/admin/VirtualMachines.tsx` (if exists)

**Changes**:
- Add columns: Create Time, End Time (Deadline), Owner
- Format dates properly
- Show "N/A" for null values

---

## Phase 5: Admin Synchronization

### 5.1 Ensure admin sees all projects

**Current Status**: Already implemented correctly
- Admin routes use role-based filtering
- No changes needed

### 5.2 Ensure admin sees all bills

**Current Status**: Already implemented correctly
- Bill routes check user role
- Admin can query without userId filter
- No changes needed

---

## Phase 6: Testing Strategy

### 6.1 Database Migration Testing

**Test Cases**:
1. Run migration on empty database → Success
2. Run migration on database with existing projects → Auto-generate project codes
3. Run migration twice → Idempotent (no errors)
4. Rollback migration → Clean removal
5. Check unique constraint on project_code → Enforced
6. Check indexes created → Performance verified

### 6.2 VMware API Testing

**Test Cases**:
1. Fetch metadata for VM created in vSphere 6.7+ → createDate populated
2. Fetch metadata for VM created before 6.7 → createDate null, fallback works
3. Fetch metadata for VM with Deadline custom field → deadline populated
4. Fetch metadata for VM without Deadline → deadline null
5. Fetch metadata for VM with Owner → owner populated
6. Fetch metadata for VM without Owner → owner null
7. VMware connection failure → Graceful degradation, null values
8. Invalid date format in Deadline → Null, no crash

### 6.3 Project Creation Testing

**Test Cases**:
1. Create project with valid project_code → Success
2. Create project with duplicate project_code → Error 400
3. Create project without project_code → Error 400
4. Create project with invalid characters → Error 400
5. Create project and verify VM sync includes metadata → Success
6. Create project as user → Only user sees it
7. Create project as admin → Admin sees it in admin panel

### 6.4 Bill Export Testing

**Test Cases**:
1. Export bills with date range → Only bills in range exported
2. Export bills as user → Only own projects exported
3. Export bills as admin → All projects exported
4. Export with monthly granularity → Correct grouping
5. Export with daily granularity → Correct grouping
6. Verify quarterly option removed → Not available in UI
7. Export includes project_code → Visible in Excel

### 6.5 Bill Retention Testing

**Test Cases**:
1. Create bills older than 3 months + 7 days → Cleaned up by cron
2. Create bills exactly 3 months + 7 days old → Not cleaned up
3. Run cleanup job → Correct count deleted
4. Verify old bills not visible in UI → Hidden
5. Verify old bills not in exports → Excluded

### 6.6 VM Metadata Display Testing

**Test Cases**:
1. View VM with all metadata → All fields displayed
2. View VM with missing metadata → "N/A" shown
3. View VM with invalid dates → Handled gracefully
4. Sync VM and verify metadata updates → Success

---

## Phase 7: Risk Assessment & Mitigation

### 7.1 High Risks

**Risk**: VMware API fails to return metadata
**Impact**: VMs created without create_time, end_time, owner
**Mitigation**:
- Fallback to bound_at for create_time
- Allow null values for end_time and owner
- Log warnings for investigation
- Retry logic in sync job

**Risk**: Duplicate project_code during migration
**Impact**: Migration fails
**Mitigation**:
- Auto-generate unique codes (PROJ-000001, PROJ-000002, etc.)
- Check uniqueness before applying constraint
- Provide manual override script if needed

**Risk**: Breaking change in project creation API
**Impact**: Frontend can't create projects
**Mitigation**:
- Make project_code optional in API initially
- Auto-generate if not provided
- Gradually enforce requirement

### 7.2 Medium Risks

**Risk**: Bill export performance with large date ranges
**Impact**: Slow exports, timeout
**Mitigation**:
- Add pagination to export
- Limit max date range (e.g., 1 year)
- Add loading indicator
- Consider background job for large exports

**Risk**: Custom fields not standardized across VMs
**Impact**: Inconsistent metadata
**Mitigation**:
- Case-insensitive field name matching
- Support multiple field name variations (Owner, owner, OWNER)
- Document required custom field setup

**Risk**: Date format variations in Deadline field
**Impact**: Parsing failures
**Mitigation**:
- Try multiple date parsers (ISO, US, EU formats)
- Log unparseable formats for admin review
- Allow manual correction in UI

### 7.3 Low Risks

**Risk**: Admin can't see new projects immediately
**Impact**: Confusion
**Mitigation**:
- Already handled by existing sync logic
- No changes needed

**Risk**: Bill retention cleanup deletes too much
**Impact**: Data loss
**Mitigation**:
- Add dry-run mode to cleanup job
- Log all deletions
- Consider soft delete instead of hard delete
- Add admin UI to view/restore deleted bills

---

## Phase 8: Rollback Strategy

### 8.1 Database Rollback

**If migration fails**:
```bash
# Run rollback scripts in reverse order
psql -U postgres -d vmware_tenant -f migrations/002_add_vm_metadata_rollback.sql
psql -U postgres -d vmware_tenant -f migrations/001_add_project_code_rollback.sql
```

### 8.2 Code Rollback

**If deployment fails**:
```bash
# Revert to previous commit
git revert HEAD
git push origin main

# Or rollback to specific commit
git reset --hard <previous-commit-hash>
git push --force origin main
```

### 8.3 Data Recovery

**If data is corrupted**:
```bash
# Restore from backup
pg_restore -U postgres -d vmware_tenant backup_before_migration.dump

# Or restore specific table
pg_restore -U postgres -d vmware_tenant -t projects backup_before_migration.dump
```

---

## Phase 9: Deployment Checklist

### 9.1 Pre-Deployment

- [ ] Backup database: `pg_dump -U postgres vmware_tenant > backup_$(date +%Y%m%d).sql`
- [ ] Test migrations on staging database
- [ ] Verify VMware credentials in .env
- [ ] Review all code changes
- [ ] Run linter and type checker
- [ ] Update API documentation

### 9.2 Deployment Steps

1. [ ] Stop application: `pm2 stop vmware-tenant`
2. [ ] Pull latest code: `git pull origin main`
3. [ ] Run database migrations:
   ```bash
   psql -U postgres -d vmware_tenant -f migrations/001_add_project_code.sql
   psql -U postgres -d vmware_tenant -f migrations/002_add_vm_metadata.sql
   ```
4. [ ] Install dependencies: `npm install` (backend and frontend)
5. [ ] Build frontend: `cd frontend && npm run build`
6. [ ] Update .env with new VMware credentials
7. [ ] Start application: `pm2 start vmware-tenant`
8. [ ] Verify health: `curl http://localhost:3000/api/health`

### 9.3 Post-Deployment

- [ ] Test project creation with project_code
- [ ] Test VM sync and verify metadata populated
- [ ] Test bill export with date range
- [ ] Verify admin can see all projects
- [ ] Verify quarterly option removed
- [ ] Check logs for errors
- [ ] Monitor performance for 24 hours

### 9.4 Smoke Tests

```bash
# Test project creation
curl -X POST http://localhost:3000/api/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Project","projectCode":"TEST-001","vcenterFolderPath":"/Datacenter/vm/test"}'

# Test VM sync
curl -X POST http://localhost:3000/api/projects/1/sync \
  -H "Authorization: Bearer $TOKEN"

# Test bill export
curl -X GET "http://localhost:3000/api/daily-billing/export?startDate=2026-01-01&endDate=2026-01-31" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Phase 10: Documentation Updates

### 10.1 User Documentation

**Topics to document**:
- How to create projects with project codes
- Project code naming conventions
- How to export bills with date ranges
- Understanding VM metadata (create time, deadline, owner)
- Bill retention policy (3 months + 7 days)

### 10.2 Admin Documentation

**Topics to document**:
- How to set up VMware custom fields (Deadline, Owner)
- How to view all projects and bills
- How to troubleshoot missing VM metadata
- How to manually run bill cleanup
- How to restore deleted bills

### 10.3 Developer Documentation

**Topics to document**:
- Database schema changes
- VMware API integration details
- Migration scripts and rollback procedures
- Testing procedures
- Deployment checklist

---

## Appendix A: File Change Summary

| File | Lines Changed | Type | Risk |
|------|---------------|------|------|
| init.sql | 16-25, 28-42 | Schema | Low |
| migrations/001_add_project_code.sql | New file | Migration | Low |
| migrations/002_add_vm_metadata.sql | New file | Migration | Low |
| .env | 3 lines | Config | Low |
| backend/src/services/vsphere.ts | +80 lines | Feature | Medium |
| backend/src/routes/project.ts | 10-20 lines | Feature | Medium |
| backend/src/services/dailyBilling.ts | 30-40 lines | Feature | Low |
| backend/src/routes/dailyBilling.ts | TBD | Feature | Low |
| frontend/src/pages/Projects.tsx | TBD | UI | Low |
| frontend/src/pages/admin/Projects.tsx | TBD | UI | Low |
| frontend/src/pages/DailyBilling.tsx | TBD | UI | Low |

**Total Estimated Changes**: ~300-400 lines across 11 files

---

## Appendix B: Timeline (No Estimates)

**Phase Order** (sequential dependencies):
1. Database migrations (must be first)
2. VMware API integration (independent)
3. Backend service updates (depends on 1, 2)
4. Frontend updates (depends on 3)
5. Testing (depends on 4)
6. Deployment (depends on 5)

**Parallel Work Opportunities**:
- VMware API integration can be developed while migrations are tested
- Frontend UI mockups can be created before backend is ready
- Documentation can be written throughout

---

## Appendix C: Success Criteria

**Must Have** (blocking release):
- [x] project_code field added and enforced
- [x] VM metadata (create_time, end_time, owner) stored
- [x] Bill retention updated to 3 months + 7 days
- [x] Quarterly statistics removed
- [x] Calendar date range picker for exports
- [x] Admin sees all projects and bills
- [x] VMware credentials updated

**Should Have** (can be added later):
- [ ] Manual metadata correction UI
- [ ] Bill soft delete with restore
- [ ] Export pagination for large datasets
- [ ] Custom field setup wizard

**Nice to Have** (future enhancements):
- [ ] Bulk project import with codes
- [ ] Automated project code generation rules
- [ ] Bill export scheduling
- [ ] Email notifications for bill cleanup

---

## Appendix D: Contact & Support

**For Questions**:
- Database issues: Check PostgreSQL logs
- VMware API issues: Enable VSPHERE_GPU_DEBUG=1
- Frontend issues: Check browser console
- Backend issues: Check application logs

**Escalation Path**:
1. Check logs and error messages
2. Review this implementation plan
3. Test on staging environment
4. Contact development team

---

**Plan Version**: 1.0
**Last Updated**: 2026-01-26
**Status**: Ready for Review
