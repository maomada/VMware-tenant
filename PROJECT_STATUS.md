# VMware 租户管理系统 - 项目状态文档

## 项目概述

VMware 租户管理系统，用于管理 vCenter 中的虚拟机资源，支持项目管理、VM 同步、资源计费等功能。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18, TypeScript, Vite, Ant Design 5, React Router 6 |
| 后端 | Node.js, Express, TypeScript |
| 数据库 | PostgreSQL 15 |
| 部署 | Docker Compose, Nginx |
| 集成 | VMware vCenter REST API + SOAP API |

## 目录结构

```
VMware tenant/
├── backend/
│   ├── src/
│   │   ├── index.ts              # 主入口，Express 服务器
│   │   ├── db.ts                 # 数据库连接
│   │   ├── middleware/auth.ts    # JWT 认证中间件
│   │   ├── routes/
│   │   │   ├── admin.ts          # 管理员路由
│   │   │   ├── auth.ts           # 认证路由
│   │   │   ├── billing.ts        # 月度账单路由
│   │   │   ├── dailyBilling.ts   # 每日账单路由（新增）
│   │   │   ├── project.ts        # 项目路由（含 VM 同步）
│   │   │   └── vm.ts             # 虚拟机路由
│   │   └── services/
│   │       ├── billing.ts        # 月度账单服务
│   │       ├── dailyBilling.ts   # 每日账单服务（新增）
│   │       ├── email.ts          # 邮件服务
│   │       └── vsphere.ts        # vSphere API 集成（核心）
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # 主应用组件
│   │   ├── AuthContext.tsx       # 认证上下文
│   │   ├── api.ts                # API 客户端
│   │   └── pages/
│   │       ├── DailyBilling.tsx  # 每日账单页面（新增）
│   │       └── ...               # 其他页面
│   ├── Dockerfile
│   └── nginx.conf
├── migrations/
│   └── 001_daily_billing.sql     # 每日账单迁移脚本（新增）
├── docker-compose.yml
├── init.sql                      # 数据库初始化
└── .env.example                  # 环境变量模板
```

## 核心功能模块

### 1. 用户管理
- 用户注册/登录（JWT 认证）
- 邮箱验证
- 角色权限（admin/user）
- 管理员可手动验证用户邮箱

### 2. 项目管理
- 项目对应 vCenter Folder
- 支持完整路径：`/Leinao/vm/项目/项目名称`

### 3. 虚拟机同步（已完成）
- 与 VMware vCenter 集成
- 支持按 folder 名称同步 VM
- 兼容不支持 REST API 过滤的 vCenter 版本（使用 SOAP API 回退）
- 同步 GPU 数量与型号（解析 PCI 直通设备，必要时匹配 Host PCI 设备名称）

### 4. 计费系统

#### 4.1 每日账单（新增）
- **按天计费**：每天00:05自动生成当日账单
- **计费起点**：VM绑定到项目时开始计费（记录 `bound_at`）
- **计费截止**：VM移出项目时停止计费（记录 `unbound_at`）
- **不足一天按一天计算**（向上取整）
- **单价可配置**：`pricing_config` 表中 `daily` 类型
- **数据留存**：最长保留3个月，每月1号02:00自动清理
- **Excel导出**：支持按天/按月/最近三月导出

#### 4.2 月度账单（原有）
- 资源使用记录（CPU/内存/存储/GPU 数量/GPU 类型）
- 每小时自动记录使用量（cron job）
- 每天 23:30 自动同步 VM 配置
- 关机 VM 处理：CPU/MEM/GPU 计为 0，存储照常计费
- 按资源类型定价
- 月度账单生成
- 使用明细查询

#### 4.3 定时任务
| 时间 | 任务 | 说明 |
|------|------|------|
| 每小时整点 | `recordUsage()` | 记录资源使用量 |
| 每天 00:05 | `generateDailyBills()` | 生成每日账单 |
| 每天 23:30 | `syncVMConfigs()` | 同步 VM 配置 |
| 每月1号 02:00 | `cleanupOldBills()` | 清理3个月前的账单 |

## vSphere 集成说明

### 已解决的问题

1. **vCenter REST API 不支持过滤参数**
   - 问题：vCenter 7.0.3 的 `/api/vcenter/vm` 不支持 `filter.folders` 参数
   - 解决：回退到 SOAP API，通过 PropertyCollector 获取 VM 的 folder 路径

2. **VM 路径匹配**
   - 使用 SOAP API 递归获取每个 VM 的完整 inventory 路径
   - 按 folder 名称过滤：`vm.folderPath.includes('/${folderName}/')`

3. **GPU 识别**
   - 使用 SOAP API 读取 `config.hardware.device` 与 `runtime.host`
   - 统计 `VirtualPCIPassthrough` 设备数量作为 GPU 数量
   - 若 `deviceName` 缺失，匹配 Host PCI 设备名称得到 GPU 型号

### vsphere.ts 关键方法

| 方法 | 说明 |
|------|------|
| `authenticate()` | REST API 认证 |
| `soapLogin()` | SOAP API 认证 |
| `getFolderByName(name)` | 按名称查找 folder ID |
| `getVMsByFolder(folderId)` | 获取 folder 下的 VM（自动回退到 SOAP） |
| `getVMsByFolderName(name)` | 使用 SOAP API 按 folder 名称获取 VM |
| `getVMInventoryPath(vmId)` | 获取 VM 的完整路径 |
| `getFolderPath(folderId)` | 递归获取 folder 路径 |
| `getVmGpuInfo(vmId)` | 解析 VM 的 GPU 数量与型号 |

## 数据库表结构

| 表名 | 说明 |
|------|------|
| `users` | 用户表 |
| `projects` | 项目表（关联 vCenter Folder） |
| `virtual_machines` | 虚拟机表（含 `bound_at`/`unbound_at` 绑定时间） |
| `pricing_config` | 资源价格配置（含 `daily` 每日单价） |
| `usage_records` | 资源使用记录（月度账单用） |
| `bills` | 月度账单表 |
| `daily_bills` | 每日账单表（新增） |

## API 路由

### 认证与用户
| 路由 | 说明 |
|------|------|
| `POST /api/auth/register` | 用户注册 |
| `POST /api/auth/login` | 用户登录 |

### 项目与虚拟机
| 路由 | 说明 |
|------|------|
| `GET /api/projects` | 获取项目列表 |
| `POST /api/projects` | 创建项目 |
| `POST /api/projects/:id/sync` | 同步项目下的 VM |
| `GET /api/vms` | 获取虚拟机列表 |
| `POST /api/vms/:id/power` | VM 开关机 |

### 每日账单（新增）
| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/daily-billing/daily` | GET | 获取每日账单列表（支持日期范围、项目筛选） |
| `/api/daily-billing/summary` | GET | 获取账单汇总统计 |
| `/api/daily-billing/export` | GET | 导出Excel账单（type=day/month/quarter） |
| `/api/daily-billing/generate` | POST | 手动生成今日账单 (admin) |
| `/api/daily-billing/cleanup` | POST | 手动清理旧账单 (admin) |
| `/api/daily-billing/pricing` | GET | 获取价格配置 |
| `/api/daily-billing/pricing` | PUT | 更新价格配置 (admin) |

### 月度账单
| 路由 | 说明 |
|------|------|
| `GET /api/billing/bills` | 获取账单列表 |
| `GET /api/billing/bills/:id` | 获取账单详情 |
| `GET /api/billing/bills/:id/export` | 导出账单 CSV |
| `GET /api/billing/usage` | 获取使用明细 |
| `POST /api/billing/generate` | 生成账单 (admin) |
| `POST /api/billing/refresh` | 刷新账单数据 (admin) |

### 管理员
| 路由 | 说明 |
|------|------|
| `GET /api/admin/users` | 获取用户列表 (admin) |
| `PUT /api/admin/users/:id/verify` | 手动验证用户邮箱 (admin) |
| `PUT /api/admin/users/:id/status` | 更新用户状态 (admin) |
| `PUT /api/admin/users/:id/password` | 重置用户密码 (admin) |
| `DELETE /api/admin/users/:id` | 删除用户 (admin) |

## 部署说明

### 环境变量

```bash
# 数据库
DB_USER=postgres
DB_PASSWORD=postgres123

# JWT
JWT_SECRET=your-jwt-secret-key

# vCenter
VCENTER_URL=https://10.0.200.100
VCENTER_USER=administrator@vsphere.local
VCENTER_PASSWORD=your-password

# SMTP
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password

# 前端 URL
FRONTEND_URL=http://localhost
```

### 部署命令

```bash
cp .env.example .env
# 编辑 .env 填写真实配置
docker-compose up -d --build
```

### 默认账户

- 管理员：`admin@leinao.ai` / `admin123`

## 已知限制

1. vCenter 7.0.3 REST API 不支持大部分过滤参数，需要使用 SOAP API 回退
2. 获取所有 VM 路径时会产生大量 SOAP 请求，大规模环境下可能需要优化（缓存/批量查询）
3. GPU 型号依赖 Host PCI 设备名称或 vCenter 返回的设备信息，缺失时会为空

## 调试日志

后端已添加详细日志，可通过 `docker logs` 查看：

```
[Sync] Starting sync for project 10
[Sync] Project: xxx, FolderId: group-v25023, Path: /Leinao/vm/项目/xxx
[vSphere] getVMsByFolder: group-v25023
[vSphere] REST API not supported, falling back to SOAP
[vSphere] Found folder: xxx
[vSphere] getVMsByFolderName: xxx
[vSphere] Total VMs: xxx
[vSphere] Filtered VMs: 11
[Sync] Found 11 VMs
```
