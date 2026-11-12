# erp-simple

一个用 Bun 和 Turborepo 管理的 ERP 项目。目前后端已接入 Better Auth 的邮箱密码注册和登录，前端的登录、注册页面已有路由，表单还未接入接口。

## 项目结构

| 目录          | 用途                                            |
| ------------- | ----------------------------------------------- |
| `apps/client` | Vite、React、TanStack Router 和 shadcn/ui 前端  |
| `apps/server` | Bun 上运行的 Hono API，包含 Better Auth         |
| `packages/db` | PostgreSQL 连接、Drizzle 表定义和数据库工具配置 |

## 本地启动

需要 Bun 1.3.14、Node.js 24 或更高版本，以及 Docker Compose。以下命令都在仓库根目录执行。

1. 安装依赖并启动 PostgreSQL。

   ```sh
   bun install
   docker compose up -d postgres
   docker compose exec postgres pg_isready -U postgres -d erp-simple
   ```

   等 PostgreSQL 显示 `accepting connections` 后继续。

2. 首次运行时，复制后端环境变量示例。

   ```sh
   cp -n apps/server/.env.example apps/server/.env
   openssl rand -base64 32
   ```

   把生成的随机值填入 `apps/server/.env` 的 `BETTER_AUTH_SECRET`。示例中的 `DATABASE_URL` 对应 Docker Compose 的本地数据库配置，`BETTER_AUTH_URL` 使用浏览器访问的前端地址。

3. 同步数据库表，再启动前后端。

   ```sh
   bun run db:push
   bun run dev
   ```

   `db:push` 会把 `packages/db` 中的 Drizzle 表定义应用到本地数据库。

| 服务       | 本地地址              |
| ---------- | --------------------- |
| 前端       | http://localhost:4200 |
| 后端       | http://localhost:4201 |
| PostgreSQL | `127.0.0.1:5434`      |

打开后端地址，看到 `Hello Hono!` 即表示后端已启动并通过数据库连接检查。前端开发服务会把 `/api` 请求转发到后端。若修改 `SERVER_PORT`，同步更新 `apps/client/vite.config.ts` 的代理目标。

## 本地种子账号

执行 `bun run db:push` 同步数据库表后，在仓库根目录运行 `bun run seed:local`。以下固定账号仅供本地和测试使用，命令会拒绝在生产环境执行或连接远程数据库。重复运行会补建缺失的种子部门和账号。已有账号按邮箱跳过，密码、角色和申请记录会保留。

| 邮箱                         | 密码                | 部门          | 身份       |
| ---------------------------- | ------------------- | ------------- | ---------- |
| `staff-a1@example.test`      | `ErpLocalSeed#2026` | 测试 A 部     | 普通员工   |
| `staff-a2@example.test`      | `ErpLocalSeed#2026` | 测试 A 部     | 普通员工   |
| `lead-a@example.test`        | `ErpLocalSeed#2026` | 测试 A 部     | 主管       |
| `staff-b1@example.test`      | `ErpLocalSeed#2026` | 测试 B 部     | 普通员工   |
| `lead-b@example.test`        | `ErpLocalSeed#2026` | 测试 B 部     | 主管       |
| `company-admin@example.test` | `ErpLocalSeed#2026` | 无部门        | 公司管理员 |
| `pending-b@example.test`     | `ErpLocalSeed#2026` | 申请测试 B 部 | 待审       |

首次运行后，可以用 `pending-b@example.test` 登录并留在待审页面。再用 `lead-b@example.test` 通过该申请。申请人在原登录会话中刷新审批状态即可进入工作台。如果申请已处理，重复运行种子命令会保留审批结果。

## 常用命令

| 命令                   | 用途                                       |
| ---------------------- | ------------------------------------------ |
| `bun run dev`          | 同时启动前端和后端                         |
| `bun run dev:server`   | 只启动后端                                 |
| `bun run db:push`      | 将 Drizzle 表定义同步到本地数据库          |
| `bun run db:studio`    | 打开 Drizzle Studio                        |
| `bun run format`       | 用 Biome 格式化代码                        |
| `bun run format:check` | 检查格式                                   |
| `bun run check-types`  | 检查前端、后端和数据库包的 TypeScript 类型 |
| `bun run build`        | 构建前端                                   |

也可以进入 `apps/client` 或 `apps/server`，在各自目录运行 `bun run dev`。
