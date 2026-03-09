# API 契约探测与重构差异报告

日期：2026-03-09  
探测环境：SSH MCP 服务器 `ww`（`http://127.0.0.1/api`）

## 1. 运行时探测结果

- 已探测核心模块：`auth`、`projects`、`vms`、`daily-billing`、`resource-requests`、`admin`、`gpu`、`network-pools`。
- 已记录成功响应字段与错误响应形态，详见 `docs/contracts/runtime-api-contract-2026-03-09.json`。
- 已验证多类非法参数场景均返回 `{ error: string }` 风格错误体（400/409）。

## 2. 发现的主要偏差（重构前）

- 前端 `frontend/src/api.ts` 存在大量 `any` 入参，无法阻止提交契约外字段。
- 多页面状态筛选参数使用 `string`，未约束到后端枚举值（如 `status`、`environment`、`gpu status`）。
- 前端错误处理大量直接读取 `e.response`，缺少统一错误提取逻辑。

## 3. 已完成对齐改造

- `frontend/src/api.ts`
  - 新增完整 API 契约类型（请求、响应、分页、枚举）。
  - 对关键接口入参改为强类型（杜绝契约外参数拼装）。
  - 新增 `getApiErrorMessage` 统一错误提取。
- 页面类型收口（按契约）
  - `frontend/src/pages/Projects.tsx`
  - `frontend/src/pages/ResourceRequests.tsx`
  - `frontend/src/pages/VMs.tsx`
  - `frontend/src/pages/admin/Projects.tsx`
  - `frontend/src/pages/admin/Users.tsx`
  - `frontend/src/pages/admin/VMs.tsx`
  - `frontend/src/pages/admin/GPUInventory.tsx`
  - `frontend/src/pages/admin/ResourceRequests.tsx`
- 后端参数校验补强
  - `backend/src/routes/dailyBilling.ts` 为 `PUT /daily-billing/pricing` 增加 `resourceType`、`unitPrice` 运行时校验。

## 4. 验证结果

- 前端构建通过：`frontend npm run build` 成功。
- 后端本地构建未执行完成：`backend npm run build` 缺少本地 `tsc` 可执行（环境依赖问题，非代码语义错误结论）。

## 5. 结论

本轮改造已将核心 API 调用入口改为契约驱动，并在关键页面完成类型化收口，满足“先查 API 参数再实现功能”的执行要求。后续新增功能应先更新运行时契约文件，再更新 `frontend/src/api.ts` 类型与页面实现。
