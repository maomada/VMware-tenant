# Implementation Plan: Remove vcenterFolderPath Parameter

## Executive Summary

This plan outlines the safe removal of the `vcenterFolderPath` parameter from project creation, replacing it with direct usage of the project name for vCenter folder lookups. The system currently extracts only the last segment of the folder path, making the full path redundant.

## Current State Analysis

### How vcenterFolderPath is Currently Used

1. **User Input**: `/Datacenter/vm/研发部门`
2. **Extraction**: System extracts last segment → `研发部门`
3. **Lookup**: Calls `vsphere.getFolderByName("研发部门")`
4. **Storage**: Stores both full path and resolved folder ID

### Files Affected (7 total)

**Backend (3 files)**:
- `backend/src/routes/project.ts` - Project CRUD and sync logic
- `backend/src/services/billing.ts` - VM config sync for billing
- `backend/src/services/dailyBilling.ts` - Daily billing sync

**Frontend (2 files)**:
- `frontend/src/pages/Projects.tsx` - User project management
- `frontend/src/pages/admin/Projects.tsx` - Admin project view

**Database (2 files)**:
- `init.sql` - Schema definition
- New migration file (to be created)

### Database Schema

```sql
CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    project_code VARCHAR(50) UNIQUE NOT NULL,
    vcenter_folder_path VARCHAR(500) NOT NULL,  -- TO BE REMOVED/NULLABLE
    vcenter_folder_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, vcenter_folder_path)  -- TO BE CHANGED
);
```

## Implementation Strategy

### Option A: Make Column Nullable (RECOMMENDED)

**Pros**:
- Safer migration path
- Existing projects retain their data
- Easy rollback if issues arise
- No data loss
- Backward compatible

**Cons**:
- Column remains in database (minor storage overhead)
- Requires NULL checks in code

### Option B: Drop Column Completely

**Pros**:
- Cleaner database schema
- No legacy fields

**Cons**:
- More risky migration
- Harder to rollback
- Potential data loss if rollback needed

**DECISION: Use Option A (Make Nullable)**

## Detailed Implementation Plan

### Phase 1: Database Migration

**File**: `migrations/003_remove_vcenter_folder_path.sql`

```sql
-- Step 1: Drop the UNIQUE constraint that includes vcenter_folder_path
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_user_id_vcenter_folder_path_key;

-- Step 2: Make vcenter_folder_path nullable
ALTER TABLE projects ALTER COLUMN vcenter_folder_path DROP NOT NULL;

-- Step 3: Add new UNIQUE constraint on user_id + name
-- This ensures one user cannot create duplicate project names
ALTER TABLE projects ADD CONSTRAINT projects_user_id_name_key UNIQUE(user_id, name);

-- Step 4: Create index on name for faster folder lookups
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
```

**Rollback Script** (if needed):
```sql
-- Restore NOT NULL constraint (only if all rows have values)
UPDATE projects SET vcenter_folder_path = name WHERE vcenter_folder_path IS NULL;
ALTER TABLE projects ALTER COLUMN vcenter_folder_path SET NOT NULL;

-- Restore old UNIQUE constraint
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_user_id_name_key;
ALTER TABLE projects ADD CONSTRAINT projects_user_id_vcenter_folder_path_key
    UNIQUE(user_id, vcenter_folder_path);

-- Drop index
DROP INDEX IF EXISTS idx_projects_name;
```

### Phase 2: Backend Code Changes

#### 2.1 Update `backend/src/routes/project.ts`

**Changes**:

1. **Line 14**: Update logging
   ```typescript
   // OLD
   console.log(`[Sync] Project: ${project.name}, FolderId: ${folderId}, Path: ${project.vcenter_folder_path}`);

   // NEW
   console.log(`[Sync] Project: ${project.name}, FolderId: ${folderId}`);
   ```

2. **Lines 16-22**: Simplify folder lookup
   ```typescript
   // OLD
   if (!folderId) {
     const trimmedPath = (project.vcenter_folder_path || '').replace(/\/+$/, '');
     const folderName = trimmedPath.split('/').pop();
     if (folderName) {
       console.log(`[Sync] Looking up folder: ${folderName}`);
       folderId = await vsphere.getFolderByName(folderName);
     }
   }

   // NEW
   if (!folderId && project.name) {
     console.log(`[Sync] Looking up folder: ${project.name}`);
     folderId = await vsphere.getFolderByName(project.name);
   }
   ```

3. **Lines 113-141**: Update project creation endpoint
   ```typescript
   // OLD
   router.post('/', auth, async (req: AuthRequest, res) => {
     const { name, projectCode, vcenterFolderPath } = req.body;
     // ... validation ...
     const folderName = vcenterFolderPath.split('/').pop();
     let folderId = null;
     try {
       folderId = await vsphere.getFolderByName(folderName);
     } catch (e) {
       // vCenter 连接失败时继续，稍后可以同步
     }

     const result = await pool.query(
       `INSERT INTO projects (user_id, name, project_code, vcenter_folder_path, vcenter_folder_id)
        VALUES ($1, $2, $3, $4, $5) RETURNING *`,
       [req.user?.id, name, trimmedCode, vcenterFolderPath, folderId]
     );
   });

   // NEW
   router.post('/', auth, async (req: AuthRequest, res) => {
     const { name, projectCode } = req.body;

     const trimmedName = String(name || '').trim();
     if (!trimmedName) {
       return res.status(400).json({ error: 'name is required' });
     }

     const trimmedCode = String(projectCode || '').trim();
     if (!trimmedCode) {
       return res.status(400).json({ error: 'project_code is required' });
     }
     if (!/^[A-Z0-9_-]+$/.test(trimmedCode)) {
       return res.status(400).json({ error: 'Invalid project_code format' });
     }

     const existingCode = await pool.query('SELECT 1 FROM projects WHERE project_code = $1', [trimmedCode]);
     if (existingCode.rows.length > 0) {
       return res.status(400).json({ error: 'project_code already exists' });
     }

     // Check for duplicate project name for this user
     const existingName = await pool.query(
       'SELECT 1 FROM projects WHERE user_id = $1 AND name = $2',
       [req.user?.id, trimmedName]
     );
     if (existingName.rows.length > 0) {
       return res.status(400).json({ error: 'project name already exists for this user' });
     }

     let folderId = null;
     try {
       folderId = await vsphere.getFolderByName(trimmedName);
     } catch (e) {
       // vCenter 连接失败时继续，稍后可以同步
     }

     try {
       const result = await pool.query(
         `INSERT INTO projects (user_id, name, project_code, vcenter_folder_id)
          VALUES ($1, $2, $3, $4) RETURNING *`,
         [req.user?.id, trimmedName, trimmedCode, folderId]
       );
       // ... rest of the code ...
     }
   });
   ```

#### 2.2 Update `backend/src/services/billing.ts`

**Changes at lines 33-46**:
```typescript
// OLD
export async function syncVMConfigs() {
  const projects = await pool.query('SELECT * FROM projects WHERE vcenter_folder_path IS NOT NULL');
  const now = new Date();

  for (const project of projects.rows) {
    let folderId = project.vcenter_folder_id;
    if (!folderId) {
      const trimmedPath = (project.vcenter_folder_path || '').replace(/\/+$/, '');
      const folderName = trimmedPath.split('/').pop();
      if (folderName) {
        folderId = await vsphere.getFolderByName(folderName);
        if (folderId) {
          await pool.query('UPDATE projects SET vcenter_folder_id = $1 WHERE id = $2', [folderId, project.id]);
        }
      }
    }
  }
}

// NEW
export async function syncVMConfigs() {
  const projects = await pool.query('SELECT * FROM projects');
  const now = new Date();

  for (const project of projects.rows) {
    let folderId = project.vcenter_folder_id;
    if (!folderId && project.name) {
      folderId = await vsphere.getFolderByName(project.name);
      if (folderId) {
        await pool.query('UPDATE projects SET vcenter_folder_id = $1 WHERE id = $2', [folderId, project.id]);
      }
    }
  }
}
```

#### 2.3 Update `backend/src/services/dailyBilling.ts`

**Changes at lines 135-150**:
```typescript
// OLD
export async function syncVMConfigsWithBinding() {
  const projects = await pool.query('SELECT * FROM projects WHERE vcenter_folder_path IS NOT NULL');
  const now = new Date();

  for (const project of projects.rows) {
    try {
      let folderId = project.vcenter_folder_id;
      if (!folderId) {
        const trimmedPath = (project.vcenter_folder_path || '').replace(/\/+$/, '');
        const folderName = trimmedPath.split('/').pop();
        if (folderName) {
          folderId = await vsphere.getFolderByName(folderName);
          if (folderId) {
            await pool.query('UPDATE projects SET vcenter_folder_id = $1 WHERE id = $2', [folderId, project.id]);
          }
        }
      }
    }
  }
}

// NEW
export async function syncVMConfigsWithBinding() {
  const projects = await pool.query('SELECT * FROM projects');
  const now = new Date();

  for (const project of projects.rows) {
    try {
      let folderId = project.vcenter_folder_id;
      if (!folderId && project.name) {
        folderId = await vsphere.getFolderByName(project.name);
        if (folderId) {
          await pool.query('UPDATE projects SET vcenter_folder_id = $1 WHERE id = $2', [folderId, project.id]);
        }
      }
    }
  }
}
```

### Phase 3: Frontend Code Changes

#### 3.1 Update `frontend/src/pages/Projects.tsx`

**Changes**:

1. **Line 71**: Remove vcenter_folder_path column from table
   ```typescript
   // OLD
   const columns = [
     { title: '项目名称', dataIndex: 'name' },
     { title: '项目编号', dataIndex: 'project_code' },
     { title: 'vCenter Folder', dataIndex: 'vcenter_folder_path' },
     // ...
   ];

   // NEW
   const columns = [
     { title: '项目名称', dataIndex: 'name' },
     { title: '项目编号', dataIndex: 'project_code' },
     // vcenter_folder_path column removed
     // ...
   ];
   ```

2. **Lines 115-117**: Remove vcenterFolderPath form field
   ```typescript
   // OLD
   <Form.Item name="vcenterFolderPath" label="vCenter Folder 路径" rules={[{ required: true }]}>
     <Input placeholder="例如：/Datacenter/vm/研发部门" />
   </Form.Item>

   // NEW (REMOVE THIS ENTIRE FORM.ITEM)
   ```

3. **Lines 102-104**: Update name field with better validation and help text
   ```typescript
   // OLD
   <Form.Item name="name" label="项目名称" rules={[{ required: true }]}>
     <Input placeholder="例如：研发部门" />
   </Form.Item>

   // NEW
   <Form.Item
     name="name"
     label="项目名称"
     rules={[
       { required: true, message: '请输入项目名称' },
       { whitespace: true, message: '项目名称不能为空' }
     ]}
     extra="项目名称必须与 vCenter 中的文件夹名称完全一致"
   >
     <Input placeholder="例如：研发部门" />
   </Form.Item>
   ```

#### 3.2 Update `frontend/src/pages/admin/Projects.tsx`

**Changes at line 38**:
```typescript
// OLD
const columns = [
  { title: '项目名称', dataIndex: 'name' },
  { title: '项目编号', dataIndex: 'project_code' },
  { title: 'vCenter Folder', dataIndex: 'vcenter_folder_path' },
  // ...
];

// NEW
const columns = [
  { title: '项目名称', dataIndex: 'name' },
  { title: '项目编号', dataIndex: 'project_code' },
  // vcenter_folder_path column removed
  // ...
];
```

### Phase 4: Data Migration for Existing Projects

**Strategy**: No data migration needed for existing projects because:
1. The `vcenter_folder_path` column becomes nullable but retains existing values
2. The `vcenter_folder_id` column already contains resolved folder IDs
3. The sync logic will use `project.name` for future lookups

**Optional Cleanup** (can be done later):
```sql
-- If you want to clear old vcenter_folder_path values after confirming everything works
UPDATE projects SET vcenter_folder_path = NULL;
```

### Phase 5: Validation Strategy

#### 5.1 Project Name Validation

**Backend validation** (already exists for project_code, add similar for name):
```typescript
const trimmedName = String(name || '').trim();
if (!trimmedName) {
  return res.status(400).json({ error: 'name is required' });
}

// Check for duplicate project name for this user
const existingName = await pool.query(
  'SELECT 1 FROM projects WHERE user_id = $1 AND name = $2',
  [req.user?.id, trimmedName]
);
if (existingName.rows.length > 0) {
  return res.status(400).json({ error: 'project name already exists for this user' });
}
```

#### 5.2 vCenter Folder Validation

**Current behavior**: System attempts to resolve folder name during project creation but continues if vCenter is unavailable.

**Recommendation**: Keep this behavior - it's resilient and allows project creation even when vCenter is temporarily unavailable.

**Enhanced validation** (optional):
```typescript
let folderId = null;
let folderValidationWarning = null;

try {
  folderId = await vsphere.getFolderByName(trimmedName);
  if (!folderId) {
    folderValidationWarning = `Warning: No vCenter folder found with name "${trimmedName}". VMs will not sync until a matching folder exists.`;
  }
} catch (e) {
  folderValidationWarning = 'Warning: Could not connect to vCenter. Folder validation skipped.';
}

// Return warning in response
res.json({
  ...project,
  vmCount,
  firstSyncDone,
  folderValidationWarning
});
```

### Phase 6: Risk Mitigation & Rollback Plan

#### Risks Identified

1. **Risk**: Project names with special characters may not match vCenter folder names
   - **Mitigation**: Add validation and clear error messages
   - **Impact**: Low - users will get immediate feedback

2. **Risk**: Existing projects with mismatched name vs folder path
   - **Mitigation**: System already stores `vcenter_folder_id`, which takes precedence
   - **Impact**: None - existing projects continue working

3. **Risk**: Database migration fails
   - **Mitigation**: Test migration on staging first, have rollback script ready
   - **Impact**: Medium - can rollback using provided script

4. **Risk**: Users create projects with names that don't match vCenter folders
   - **Mitigation**: Add help text in UI, validate during sync
   - **Impact**: Low - sync will fail gracefully with clear error message

#### Rollback Procedure

If issues arise after deployment:

1. **Immediate rollback** (code only):
   ```bash
   git revert <commit-hash>
   npm run build
   pm2 restart all
   ```

2. **Database rollback** (if migration was applied):
   ```bash
   psql -U postgres -d vmware_tenant -f migrations/003_remove_vcenter_folder_path_rollback.sql
   ```

3. **Verification**:
   ```sql
   -- Check constraint exists
   SELECT conname FROM pg_constraint WHERE conname = 'projects_user_id_vcenter_folder_path_key';

   -- Check column is NOT NULL
   SELECT column_name, is_nullable FROM information_schema.columns
   WHERE table_name = 'projects' AND column_name = 'vcenter_folder_path';
   ```

### Phase 7: Testing Checklist

#### Unit Tests (Backend)

- [ ] Test project creation with valid name
- [ ] Test project creation with empty/whitespace name
- [ ] Test project creation with duplicate name (same user)
- [ ] Test project creation with duplicate name (different user) - should succeed
- [ ] Test project creation when vCenter is unavailable
- [ ] Test project creation when folder doesn't exist in vCenter
- [ ] Test sync with valid folder name
- [ ] Test sync with invalid folder name
- [ ] Test existing projects continue to work

#### Integration Tests

- [ ] Create new project and verify VM sync works
- [ ] Sync existing project and verify VMs are discovered
- [ ] Test billing sync with new projects
- [ ] Test daily billing sync with new projects
- [ ] Verify admin panel displays projects correctly

#### UI Tests

- [ ] Create project form no longer shows vcenterFolderPath field
- [ ] Project list no longer shows vcenterFolderPath column
- [ ] Admin project list no longer shows vcenterFolderPath column
- [ ] Help text is clear about name matching vCenter folder
- [ ] Error messages are clear when folder not found

#### Database Tests

- [ ] Migration runs successfully
- [ ] Rollback script works correctly
- [ ] UNIQUE constraint on (user_id, name) works
- [ ] Existing projects retain their data
- [ ] New projects can be created without vcenter_folder_path

### Phase 8: Deployment Steps

#### Pre-Deployment

1. **Backup database**:
   ```bash
   pg_dump -U postgres vmware_tenant > backup_before_migration_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Test migration on staging**:
   ```bash
   psql -U postgres -d vmware_tenant_staging -f migrations/003_remove_vcenter_folder_path.sql
   ```

3. **Verify staging works**:
   - Create new project
   - Sync existing project
   - Check admin panel

#### Deployment

1. **Stop application** (optional, for zero-downtime skip this):
   ```bash
   pm2 stop all
   ```

2. **Run migration**:
   ```bash
   psql -U postgres -d vmware_tenant -f migrations/003_remove_vcenter_folder_path.sql
   ```

3. **Deploy new code**:
   ```bash
   cd backend && npm run build
   cd ../frontend && npm run build
   ```

4. **Start application**:
   ```bash
   pm2 restart all
   ```

5. **Verify deployment**:
   - Check logs for errors
   - Create test project
   - Sync test project
   - Verify VMs are discovered

#### Post-Deployment

1. **Monitor for 24 hours**:
   - Check error logs
   - Monitor sync jobs
   - Verify billing continues to work

2. **User communication**:
   - Notify users of the change
   - Update documentation
   - Provide examples of correct project names

3. **Optional cleanup** (after 1 week of stable operation):
   ```sql
   -- Clear old vcenter_folder_path values
   UPDATE projects SET vcenter_folder_path = NULL;
   ```

## Summary of Changes

### Files to Modify (7 files)

1. **migrations/003_remove_vcenter_folder_path.sql** (NEW)
   - Make vcenter_folder_path nullable
   - Add UNIQUE constraint on (user_id, name)
   - Add index on name

2. **backend/src/routes/project.ts**
   - Remove vcenterFolderPath from request body
   - Use project.name directly for folder lookup
   - Add name validation
   - Update INSERT query

3. **backend/src/services/billing.ts**
   - Remove WHERE vcenter_folder_path IS NOT NULL
   - Use project.name for folder lookup

4. **backend/src/services/dailyBilling.ts**
   - Remove WHERE vcenter_folder_path IS NOT NULL
   - Use project.name for folder lookup

5. **frontend/src/pages/Projects.tsx**
   - Remove vcenterFolderPath form field
   - Remove vcenter_folder_path table column
   - Add help text to name field

6. **frontend/src/pages/admin/Projects.tsx**
   - Remove vcenter_folder_path table column

7. **init.sql** (OPTIONAL - for new installations)
   - Make vcenter_folder_path nullable
   - Change UNIQUE constraint to (user_id, name)

### Lines of Code Changed

- **Added**: ~50 lines (migration, validation, help text)
- **Removed**: ~30 lines (form fields, table columns, path parsing)
- **Modified**: ~40 lines (folder lookup logic)
- **Net change**: +60 lines

### Estimated Effort

- **Development**: 2-3 hours
- **Testing**: 2-3 hours
- **Deployment**: 1 hour
- **Total**: 5-7 hours

## Acceptance Criteria

✅ **Functional Requirements**:
- [ ] Users can create projects without providing vcenterFolderPath
- [ ] Project name is used directly for vCenter folder lookup
- [ ] Existing projects continue to work without changes
- [ ] VM sync works correctly with new projects
- [ ] Billing sync works correctly with new projects
- [ ] Admin panel displays projects correctly

✅ **Non-Functional Requirements**:
- [ ] Database migration is reversible
- [ ] No data loss during migration
- [ ] Performance is not degraded
- [ ] Error messages are clear and helpful
- [ ] UI is intuitive and user-friendly

✅ **Quality Requirements**:
- [ ] All tests pass
- [ ] Code is reviewed
- [ ] Documentation is updated
- [ ] Rollback procedure is tested
- [ ] Monitoring is in place

## Conclusion

This implementation plan provides a safe, reversible approach to removing the `vcenterFolderPath` parameter. By making the column nullable rather than dropping it, we maintain backward compatibility and provide an easy rollback path. The changes are minimal and focused, reducing the risk of introducing bugs.

The key insight is that since the system only uses the last segment of the folder path, and that segment should match the project name, we can eliminate the redundant parameter and simplify the user experience.