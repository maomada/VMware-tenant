# VMware 虚拟机资源申请系统 - 实施指南

## 文档说明

本项目包含完整的虚拟机资源申请系统实施计划，详见 `VM_RESOURCE_REQUEST_IMPLEMENTATION_PLAN.md`

## 快速导航

### 📋 主要文档章节

1. **系统概述** - 功能范围、技术栈、网络环境映射
2. **数据库设计** - 完整的SQL迁移脚本 (8个表 + 触发器 + 函数)
3. **后端实现** - API端点清单、VMware集成、Service文件、中间件
4. **前端实现** - 页面组件清单、API封装、路由配置
5. **部署流程设计** - 状态机、8步部署流程、回滚策略
6. **风险缓解措施** - API失败、GPU冲突、部署超时、权限绕过
7. **实施顺序** - 4个Phase、关键里程碑、任务依赖关系
8. **测试策略** - 单元测试、集成测试、性能测试、安全测试

## 🚀 快速开始

### 第一步: 数据库迁移

```bash
psql -U postgres -d vmware_tenant -f migration_001_resource_requests.sql
```

### 第二步: 安装依赖

```bash
# 后端
cd server
npm install zod  # 参数校验库

# 前端
cd client
npm install  # 已有依赖足够
```

### 第三步: 配置环境变量

```env
# .env
VCENTER_HOST=vcenter.example.com
VCENTER_USERNAME=administrator@vsphere.local
VCENTER_PASSWORD=your_password
DEPLOYMENT_TIMEOUT=600000
GPU_SYNC_INTERVAL=600000
MAX_VM_PER_REQUEST=10
```

### 第四步: 按Phase实施

- **Phase 1 (Week 1-2)**: 基础功能 - 申请单CRUD + 审批流程
- **Phase 2 (Week 3-4)**: VMware集成 - GPU管理 + vSphere API
- **Phase 3 (Week 5-6)**: 自动部署 - 完整部署流程 + 资源分配
- **Phase 4 (Week 7)**: 管理功能 - 网络池管理 + 项目联动

## 📊 核心功能

### 用户侧
- ✅ 创建资源申请 (支持多虚机、GPU配置)
- ✅ 查看申请单列表和详情
- ✅ 删除pending状态的申请

### 管理员侧
- ✅ 审批/退回申请单
- ✅ 配置部署参数 (VM名称、Folder路径)
- ✅ 触发自动部署
- ✅ 查看GPU资源清单
- ✅ 管理网络IP池
- ✅ 查看部署日志

### 自动化
- ✅ VMware API集成 (克隆、配置、GPU直通、启动)
- ✅ GPU资源自动分配 (PCI Passthrough)
- ✅ IP地址自动分配 (静态IP池)
- ✅ 部署状态跟踪 (Task监控)
- ✅ 失败自动回滚 (释放资源)
- ✅ 项目联动 (部署成功后自动关联)

## 🗄️ 数据库表结构

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| resource_requests | 资源申请单 | request_number, status, user_id, environment |
| vm_request_items | 虚机申请明细 | vm_name, cpu_cores, memory_gb, requires_gpu, ip_address |
| gpu_inventory | GPU资源清单 | device_id, gpu_model, status, allocated_to_vm |
| network_pools | 网络IP池 | environment, network_segment, gateway, ip_range |
| ip_allocations | IP分配记录 | ip_address, vm_item_id, status |
| deployment_logs | 部署日志 | log_level, message, operation |
| deployment_tasks | 部署任务 | task_id, task_type, status, progress |

## 🔌 API端点总览

### 用户端点
```
POST   /api/resource-requests          创建申请
GET    /api/resource-requests          查询列表
GET    /api/resource-requests/:id      获取详情
DELETE /api/resource-requests/:id      删除申请
```

### 管理员端点
```
PATCH  /api/resource-requests/:id/approve    审批通过
PATCH  /api/resource-requests/:id/reject     退回
POST   /api/resource-requests/:id/deploy     触发部署
GET    /api/gpu/inventory                    查询GPU清单
POST   /api/gpu/sync                         同步GPU资源
GET    /api/network-pools                    查询网络池
GET    /api/deployment-logs                  查询部署日志
```

## 🎯 部署流程 (8步)

1. **预检查** - 检查状态/VM名称/模板/GPU/IP资源
2. **资源分配** - 分配IP地址和GPU设备
3. **克隆虚拟机** - CloneVM_Task
4. **配置硬件** - ReconfigVM_Task (CPU/内存/磁盘)
5. **配置网络** - CustomizeVM_Task (静态IP)
6. **添加GPU直通** - ReconfigVM_Task (PCI Passthrough)
7. **启动虚拟机** - PowerOnVM_Task
8. **完成部署** - 更新状态, 项目联动

## ⚠️ 关键风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| VMware API调用失败 | 重试机制 (指数退避) + Task超时监控 |
| GPU资源冲突 | 数据库事务隔离 + FOR UPDATE SKIP LOCKED |
| 部署超时 | 异步部署 + 定时任务监控 |
| 权限绕过 | 中间件权限检查 + 审计日志 |

## 📝 实施检查清单

### Phase 1: 基础功能
- [ ] 执行数据库迁移脚本
- [ ] 实现资源申请API (POST/GET/DELETE)
- [ ] 实现审批API (PATCH approve/reject)
- [ ] 实现用户侧页面 (ResourceRequests, CreateResourceRequest, ResourceRequestDetail)
- [ ] 实现管理员侧页面 (AdminResourceRequests, AdminResourceRequestDetail)
- [ ] 测试权限控制 (用户只能看自己的, 管理员看所有)

### Phase 2: VMware集成
- [ ] 扩展vsphere.ts (cloneVM, reconfigureVM, attachGPUPassthrough等)
- [ ] 实现GPU服务 (gpu.ts)
- [ ] 实现GPU管理API
- [ ] 实现GPU清单页面
- [ ] 配置GPU同步定时任务 (每10分钟)
- [ ] 测试GPU分配/释放逻辑

### Phase 3: 自动部署
- [ ] 实现网络服务 (network.ts)
- [ ] 实现部署服务 (deployment.ts)
- [ ] 实现部署API (POST deploy)
- [ ] 实现部署日志API
- [ ] 实现部署配置弹窗和日志页面
- [ ] 配置部署监控定时任务
- [ ] 测试端到端部署流程
- [ ] 测试失败回滚逻辑

### Phase 4: 管理功能
- [ ] 实现网络池管理API
- [ ] 实现网络池管理页面
- [ ] 实现项目联动逻辑
- [ ] 实现统计报表 (可选)
- [ ] 测试网络池管理
- [ ] 测试项目联动

## 🧪 测试要点

### 单元测试
- API端点测试 (参数校验、权限检查)
- Service层测试 (部署流程、回滚逻辑、资源分配)
- 中间件测试 (权限检查、参数校验)

### 集成测试
- 端到端部署流程
- GPU资源竞争
- 部署失败回滚
- 权限控制

### 性能测试
- 并发申请创建 (100用户)
- 并发部署 (10管理员)
- GPU同步性能 (1000设备)

### 安全测试
- SQL注入
- 权限绕过
- XSS攻击
- CSRF攻击

## 📞 技术支持

如有问题，请参考:
- 完整实施计划: `VM_RESOURCE_REQUEST_IMPLEMENTATION_PLAN.md`
- vSphere API文档: https://developer.vmware.com/apis/1355/vsphere
- PostgreSQL文档: https://www.postgresql.org/docs/
- Ant Design组件库: https://ant.design/components/overview/

---

**祝实施顺利！** 🎉
