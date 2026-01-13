# VMware Tenant 管理系统

基于 vCenter 的多租户虚拟机管理与计费系统。

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
