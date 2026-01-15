# VM GPU Detection - Development Plan

## Overview
Extend GPU detection to retrieve detailed GPU information (model, vendor, memory) from vSphere API and display it in the VM management interface.

## Task Breakdown

### Task 1: GPU vSphere Parsing
- **ID**: task-1
- **Type**: default
- **Description**: Extend GPU detection logic to parse vendor, model, and memory from vSphere SOAP responses. Update existing regex parsing to extract additional GPU attributes from VM hardware configuration.
- **File Scope**: backend/src/services/vsphere.ts
- **Dependencies**: None
- **Test Command**: npm test -- --coverage --collectCoverageFrom="src/services/vsphere.ts"
- **Test Focus**:
  - Parse GPU vendor from vSphere response
  - Parse GPU model name correctly
  - Parse GPU memory size (handle various units)
  - Handle missing/null GPU fields gracefully
  - Handle VMs with multiple GPUs

### Task 2: GPU Database Sync
- **ID**: task-2
- **Type**: default
- **Description**: Add gpu_vendor and gpu_memory columns to database schema. Update sync flows in project routes, billing service, and VM routes to persist and retrieve new GPU fields.
- **File Scope**: init.sql, backend/src/routes/project.ts, backend/src/services/billing.ts, backend/src/routes/vm.ts
- **Dependencies**: depends on task-1
- **Test Command**: npm test -- --coverage --collectCoverageFrom="src/routes/project.ts,src/services/billing.ts,src/routes/vm.ts"
- **Test Focus**:
  - Database migration adds new columns
  - Sync flow persists gpu_vendor and gpu_memory
  - API responses include new GPU fields
  - Billing calculations handle new GPU data
  - Backward compatibility with existing records

### Task 3: GPU UI Display
- **ID**: task-3
- **Type**: ui
- **Description**: Update VM table components to display GPU vendor, model, and memory columns. Add formatting for memory display (e.g., "8 GB").
- **File Scope**: frontend/src/pages/VMs.tsx, frontend/src/pages/admin/VMs.tsx
- **Dependencies**: depends on task-2
- **Test Command**: npm test -- --coverage --collectCoverageFrom="src/pages/VMs.tsx,src/pages/admin/VMs.tsx"
- **Test Focus**:
  - GPU columns render correctly in VM table
  - Handle null/undefined GPU values
  - Memory formatting displays correctly
  - Admin and user views show GPU info

### Task 4: Backend Unit Tests
- **ID**: task-4
- **Type**: default
- **Description**: Configure Jest test framework in backend. Add unit tests for GPU parsing logic and sync flows to achieve 90% coverage.
- **File Scope**: backend/package.json, backend/jest.config.js, backend/tests/**
- **Dependencies**: depends on task-1, task-2
- **Test Command**: npm test -- --coverage
- **Test Focus**:
  - Jest configuration and test scripts
  - Mock vSphere SOAP responses
  - Test GPU parsing edge cases
  - Test database sync operations
  - Test API endpoint responses

## Acceptance Criteria
- [ ] GPU vendor extracted from vSphere API
- [ ] GPU model extracted from vSphere API
- [ ] GPU memory extracted from vSphere API
- [ ] Database schema includes gpu_vendor and gpu_memory columns
- [ ] Sync flows persist all GPU fields
- [ ] VM tables display GPU vendor, model, and memory
- [ ] Admin VM view shows GPU details
- [ ] All unit tests pass
- [ ] Code coverage >= 90%

## Technical Notes
- vSphere SOAP fallback already exists; extend existing parsing logic
- GPU info typically in VM hardware.device array as VirtualPCIPassthrough
- Memory may be reported in MB or GB; normalize to consistent unit
- Existing gpu_count and gpu_type columns remain for backward compatibility
- No test framework currently configured; Jest setup required in task-4
