# erp-simple

一个用 Bun 和 Turborepo 管理的 ERP 项目，使用 PostgreSQL、Drizzle、Hono、Better Auth 和 React。

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

   `db:push`、`db:reset` 和 `seed` 统一读取 `apps/server/.env`，命令行已设置的环境变量优先。三个命令的目标库和校验配置由这两个来源决定，根目录、`packages/db` 下的旧 `.env` 以及 `.env.local` 等其他文件不再用于选择目标；无需再维护数据库包的另一份连接配置。

   配置中的 `$VAR`、`${VAR}` 引用、引号和转义由 Bun 原生解析，与后端保持一致。例如可先设置 `DB_NAME=app`，再在 `DATABASE_URL` 中使用 `${DB_NAME}`。

3. 同步数据库表，再启动前后端。

   ```sh
   bun run db:push
   bun run seed
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

执行 `bun run db:push` 同步数据库表后，在仓库根目录运行 `bun run seed`。种子会创建业务一部、业务二部、技术部和产品部，以及四个预置客户渠道。技术部和产品部仅创建部门。

同时创建 12 个以「演示·」开头的客户、12 位联系人及 48 条联系方式，以及 24 条沟通记录。客户分布在两个业务部门的主管和员工名下，客户与沟通各有 4 个独立标签；沟通包含待跟进、急需跟进和已完结三种状态，也包含同部门其他业务员负责的沟通，方便检查列表、详情和权限。客户编号由数据库自动生成。

演示记录使用固定 ID，重复 seed 会补建缺失的演示客户和沟通，不会覆盖已有客户、沟通、联系方式及其关联的修改。

`db:push`、`db:reset` 和 `seed` 共用本地目标校验：主机只允许 `localhost`、`127.0.0.1` 或 `[::1]`；库名只允许当前本地配置使用的 `app`、Compose 默认的 `erp-simple`，以及以 `erp-simple_` 开头、后缀由小写字母、数字和下划线组成的开发测试库。`NODE_ENV`、`APP_ENV`、`VERCEL_ENV`、`ENVIRONMENT` 任一值为 `prod` 或 `production` 时都会拒绝执行，判断忽略大小写和首尾空格。这些命令操作已有数据库，不负责创建数据库本身。

seed 开始前会检查认证密钥至少为 32 个字符、数据库是否可连接、实际库名是否与配置目标一致以及必要的数据表是否存在，并打印不含账号和密码的目标地址。缺表时先运行 `bun run db:push`；目标不一致时取消写入，连接或写入失败时会显示脱敏后的具体原因。所有种子写入仍在同一事务中完成，失败时整体回滚。

| 邮箱        | 密码       | 部门         | 身份       |
| ----------- | ---------- | ------------ | ---------- |
| `a@e.test`  | `12345678` | 无部门       | 公司管理员 |
| `a1@e.test` | `12345678` | 业务一部     | 主管       |
| `a2@e.test` | `12345678` | 业务一部     | 普通员工   |
| `b1@e.test` | `12345678` | 业务二部     | 主管       |
| `b2@e.test` | `12345678` | 业务二部     | 普通员工   |
| `p@e.test`  | `12345678` | 申请业务二部 | 待审       |

重复运行会补建缺失的种子部门和账号，并保留已有账号及其密码、角色和申请记录。

首次运行后，可以用 `p@e.test` 登录查看待审页面，再用 `b1@e.test` 通过该申请。申请人在原登录会话中刷新审批状态即可进入工作台。

## 重置本地数据库

需要清空本地数据重新开始时，先停止连接该库的开发服务，再核对 `DATABASE_URL`，执行：

```sh
bun run db:reset
bun run seed
```

`db:reset` 会删除目标库 `public` 和 `drizzle` schema 中的现有数据与对象，再自动调用 `db:push` 重建项目表、约束和触发器；它不自动执行 seed。若清空后重建失败，修正报错后重新运行 `bun run db:push`，成功后再运行 `bun run seed`。普通启动和保留数据的表结构同步使用 `db:push`，无需重置数据库。

## 常用命令

| 命令                   | 用途                                       |
| ---------------------- | ------------------------------------------ |
| `bun run dev`          | 同时启动前端和后端                         |
| `bun run dev:server`   | 只启动后端                                 |
| `bun run db:push`      | 将 Drizzle 表定义同步到本地数据库          |
| `bun run db:reset`     | 清空本地数据，再调用 `db:push` 重建结构    |
| `bun run db:studio`    | 打开 Drizzle Studio                        |
| `bun run seed`         | 初始化本地账号、部门和客户渠道             |
| `bun run format`       | 用 Biome 格式化代码                        |
| `bun run format:check` | 检查格式                                   |
| `bun run check-types`  | 检查前端、后端和数据库包的 TypeScript 类型 |
| `bun run build`        | 构建前端                                   |

也可以进入 `apps/client` 或 `apps/server`，在各自目录运行 `bun run dev`。
