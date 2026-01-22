# VMware Tenant 管理系统

基于 vCenter 的多租户虚拟机管理与计费系统。

## 功能特性

- **项目管理**：对应 vCenter Folder，支持 VM 同步（自动补齐缺失的 folder_id），创建项目时自动首次同步
- **虚拟机管理**：查看 VM 配置、开关机操作、GPU 识别，每 10 分钟自动同步
- **账单管理**：按天计费，支持 Excel 导出（按天/月/季度），支持统计汇总
- **数据留存**：账单数据自动保留3个月

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，填写以下必要配置：

| 变量 | 说明 |
|------|------|
| `VCENTER_URL` | vCenter 地址，如 `https://vcenter.example.com` |
| `VCENTER_USER` | vCenter 用户名 |
| `VCENTER_PASSWORD` | vCenter 密码 |
| `SMTP_HOST` | SMTP 服务器地址 |
| `SMTP_USER` | SMTP 用户名 |
| `SMTP_PASS` | SMTP 密码 |
| `JWT_SECRET` | JWT 签名密钥（生产环境请使用强随机字符串） |

### 2. 启动服务

```bash
docker-compose up -d
```

服务启动后访问 `http://localhost`（可通过 `WEB_PORT` 环境变量修改端口）。

### 3. 默认管理员账号

- 邮箱：`admin@leinao.ai`
- 密码：`admin123`

首次登录后请立即修改密码。

## 常见问题

### 端口冲突
如果 80 端口被占用，修改 `docker-compose.yml` 中的端口映射：
```yaml
ports:
  - "8080:80"  # 改为其他端口
```

### vCenter 连接失败
- 确认 `VCENTER_URL` 可从 Docker 容器内访问
- 如使用自签名证书，系统默认跳过 TLS 验证

### 邮件发送失败
- 确认 SMTP 配置正确
- 注册功能依赖邮件验证，SMTP 不可用时注册将失败

## 技术栈

- 前端：React + Ant Design + Vite
- 后端：Express.js + TypeScript
- 数据库：PostgreSQL
- 部署：Docker Compose

## 账单系统说明

### 计费规则
- **按天计费**：VM绑定到项目后开始计费，每天生成一条账单记录
- **不足一天按一天计算**
- **按资源配置计价**：
  | 资源类型 | 单价 |
  |---------|------|
  | CPU | ¥0.08/核/天 |
  | 内存 | ¥0.16/GB/天 |
  | 存储 | ¥0.50/100GB/天 |
  | 显卡 3090 | ¥11/张/天 |
  | 显卡 T4 | ¥5/张/天 |
- **单价可配置**：管理员可在后台设置各资源单价

### 数据留存
- 账单数据最长保留3个月
- 每月1号自动清理过期数据

### 导出功能
- 支持按天、按月、按季度导出
- 导出格式为 Excel (.xlsx)
- **层级结构导出**：以项目为一级维度，VM 为二级维度
  - 项目名称只展示一次
  - 每个 VM 的多日账单按行展开
  - 包含 VM 小计、项目合计、总计

### 统计功能
- 支持按日 / 月 / 季度维度汇总展示
- 统计接口：`GET /api/daily-billing/stats`
  - Query 参数：`dimension=day|month|quarter`，可选 `startDate`、`endDate`、`projectId`
  - 返回字段：`period`(周期)、`vm_count`(VM数)、`bill_days`(计费天数)、`total_cost`(金额合计)

### VM 自动同步
- **首次同步**：项目创建时自动触发 VM 同步，无 VM 时弹窗提示
- **周期同步**：每 10 分钟自动同步所有项目的 VM 配置
- **绑定追踪**：记录 VM 绑定时间 (`bound_at`) 和解绑时间 (`unbound_at`)
- **自动解绑**：VM 从 vCenter folder 移除后自动标记为解绑
- **账单同步**：新发现的 VM 自动纳入计费，已存在的 VM 不重复计费

详细技术文档请参考 [PROJECT_STATUS.md](PROJECT_STATUS.md)
