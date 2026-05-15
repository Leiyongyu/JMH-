# 跨境电商分销系统（MVP）

按 [`需求文档.md`](./需求文档.md) 与 [`开发文档.md`](./开发文档.md) 实现：领星 ERP 同步 → 库存看板 / eBay 商品列表 → 分销商购物车合单下单（订单快照）。

## 技术栈

- 后端：Node.js + NestJS + TypeScript + TypeORM + PostgreSQL + JWT
- 前端：React 18 + TypeScript + Vite + Ant Design 5 + React Router v6
- 集成：领星 Open API（OAuth + AES-ECB/MD5 sign，对齐 [`样例.py`](./样例.py)）

## 准备

1. Node 20+，pnpm 8+
2. 创建数据库：

   ```sql
   CREATE DATABASE distribution;
   ```

3. 复制环境变量：

   ```powershell
   Copy-Item .env.example apps/api/.env
   Copy-Item .env.example apps/web/.env
   ```

   - 至少检查 `DATABASE_*`、`JWT_SECRET`
   - 没有领星凭证时也可以登录与浏览历史数据；调用同步会返回 503

## 安装与启动

```powershell
pnpm install

# 后端 http://localhost:3001 （Swagger: /docs）
pnpm dev:api

# 前端 http://localhost:5173
pnpm dev:web
```

首次启动 API 会自动建表（TypeORM `synchronize=true`，仅供 MVP），并按 `.env` 写入种子账号：

- **管理员**：推荐 `SEED_ADMIN_PHONE` + `SEED_ADMIN_PASSWORD`（登录页填手机号）；未配邮箱时内部使用 `<手机号数字>@user.local`。也可仅用 `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD`（邮箱登录）。
- **分销商**：配置 `SEED_DISTRIBUTOR_EMAIL` / `SEED_DISTRIBUTOR_PASSWORD` 才会创建；留空则不创建。
- **`ADMIN_ONLY_LOGIN=true`**：仅 `ADMIN` 角色可登录，分销商即使用正确密码也会被拒绝。
- **`ADMIN_LOGIN_PHONE_ONLY=true`** 且已配置 **`SEED_ADMIN_PHONE`**：只允许该手机号在库中对应用户登录；旧演示账号 `admin@example.com`（无 `phone` 字段）将失败。

打开 `http://localhost:5173` 登录（账号支持 **手机号或邮箱**）。

若曾用旧演示账号建过库，数据库里可能仍有旧用户；需要唯一管理员时，可删除本地 `distribution.sqljs` 后重启 API 以重建库，或自行在库里删旧用户。

## 同步领星数据

管理员登录后：

- 库存看板右上角「立即同步」 → `POST /api/v1/admin/sync/inventory`
- 商品页右上角「立即同步」 → `POST /api/v1/admin/sync/ebay-products`

未配置 `LINGXING_APP_ID/SECRET` 时返回 503 + 友好提示。

## 接口字段映射

`apps/api/src/lingxing/mappers/` 下两个 mapper 把领星响应字段映射到本地实体；不同企业开通字段会有差异，请按你实际响应调整（文件顶部留有 TODO）。
