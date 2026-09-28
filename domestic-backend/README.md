# 在否国内后端

这是一套新的国内后端起点，不再依赖 Supabase 作为正式版核心后端。

## 目标架构

- App 访问：`https://api.huozhema.senbeikeji.cn`
- 运行环境：阿里云轻量应用服务器或 ECS
- 数据库：PostgreSQL，优先阿里云 RDS PostgreSQL
- 短信：阿里云短信
- 图片：阿里云 OSS 私有 Bucket

## 当前已覆盖的接口

- `GET /health`
- `GET /health/db`
- `POST /auth/send-code`
- `POST /auth/verify-code`
- `POST /auth/reset-password`
- `POST /auth/password-login`
- `GET /me/snapshot`
- `PUT /me/profile`
- `PUT /me/privacy`
- `POST /me/avatar/upload-policy`
- `POST /me/avatar/confirm`
- `PUT /personal-messages`
- `DELETE /me/app-data`：已停用，返回 410，不再丢弃照片清理索引
- `POST /checkins/today`：旧版兼容入口，只接受不修改文字的确认；文字修改返回 426 提示升级
- `PATCH /checkins/today/journal`：只更新随笔文字，要求 `journalText`、`expectedJournalText`、`checkinDate`，冲突返回 409
- `POST /journal/photos/upload-policy`
- `POST /journal/photos/confirm`
- `POST /todos`
- `PATCH /todos/:id`
- `POST /friends/request`
- `POST /friends/requests/:id/accept`
- `DELETE /friends/:friendId`
- `POST /friends/:friendId/poke`
- `POST /friends/:friendId/alive-reply`
- `POST /account/deletion-request`

## 本地启动

```bash
cd "/Users/zhangyue/Documents/New project/huozheme-/domestic-backend"
cp .env.example .env
npm install
npm run check
npm start
```

开发时 `SMS_PROVIDER=console` 会把验证码打印在服务器日志里，不会真正发送短信。

## 建库

先准备 PostgreSQL 数据库，然后执行：

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

已有生产库升级时不要重跑整份建库脚本。先执行对应的 `db/patch_*.sql` 补丁，再部署依赖新字段的后端代码；确认状态升级使用 `db/patch_checkin_confirmation.sql`。

服务器没有安装 `psql` 时，可以用后端已有的 PostgreSQL 驱动执行补丁：

```bash
npm run db:apply-patch -- db/patch_personal_messages.sql
```

启用验证码防猜测和重置密码后旧令牌失效时，先执行：

```bash
npm run db:apply-patch -- db/patch_auth_security.sql
```

如果报 `must be owner of table`，请由原表所有者或有权管理这些表的管理员，在 DMS 的 `huozhema` 库执行 `db/patch_auth_security.sql`。应用运行账号只需要日常读写权限，不要为了部署赋予它管理员权限。

部署时先在待发布目录执行 `npm run check`、`npm run check:deployment`，全部通过后再替换线上文件并重启服务。新版启动时也会核验所需表字段，缺少数据库补丁会拒绝启动。不要在检查之前覆盖正在运行的版本。

认证回归命令：

- `npm run check:auth-isolated`：创建一次性 `auth_audit_*` schema 和仅监听本机的测试 API；验证数据库升级、并发锁定、验证码失效、令牌撤销和短信发送失败回滚。需要数据库 CREATE schema 权限。只用模拟短信，结束后删除本次测试 schema。
- `npm run check:auth-regression`：通过真实 API 验证认证流程，只创建并清理本次临时账号，不发送短信。
- `node scripts/check-auth-regression.js --compat`：仅用于 2026-09-28 旧数据库兼容修复，明确报告验证码防猜测和令牌撤销尚未启用，不能用来验收新版安全发布。

2026-09-28 认证安全发布及核查记录见仓库根目录 `AUTH_AUDIT_20260928.md`。

业务逻辑修复的候选版本核查：`npm run check:business-isolated`。此脚本只在随机 `business_audit_*` schema 内创建测试账号，并启动仅监听本机的候选 API；覆盖隐私、照片归属/并发、随笔冲突、长期连续天数、待办数量、原有认证及好友回馈。测试照片仅生成虚构凭证的签名，不实际访问 OSS，不发送真实短信。退出时删除本次 schema。通过 `CHECK_ENV_FILE` 可指定连接配置文件，勿把其内容打印或提交到仓库。

本次业务修复不需要新的数据库字段。发布必须配合新版 Android/iOS：旧版整条记录保存没有冲突基线，后端无法安全判断是不是在覆盖旧数据，所以会提示升级，不再静默覆盖随笔。先准备并验证新版安装包，再安排后端与客户端协调发布；不要把“本地测试通过”当成“线上已发布”。

如果要用文本打开建表 SQL：

```bash
cd "/Users/zhangyue/Documents/New project/huozheme-/domestic-backend"
open -a TextEdit db/schema.sql
```

## 生产环境必填环境变量

- `DATABASE_URL`
- `JWT_SECRET`
- `OTP_SECRET`
- `SMS_PROVIDER=aliyun`
- `ALIYUN_ACCESS_KEY_ID`
- `ALIYUN_ACCESS_KEY_SECRET`
- `ALIYUN_SMS_SIGN_NAME`
- `ALIYUN_SMS_TEMPLATE_CODE`
- `ALIYUN_OSS_BUCKET`
- `ALIYUN_OSS_REGION`
- `ALIYUN_OSS_ACCESS_KEY_ID`
- `ALIYUN_OSS_ACCESS_KEY_SECRET`

## 关键业务约束

- 手机号自动补 `+86`，用户输入 `18810409001` 和 `8618810409001` 都会归一成 `+8618810409001`。
- 验证码有效期固定 60 秒。
- 同一验证码连续输错 5 次后立即作废，必须重新获取。
- 登录密码只保存 `scrypt` 加盐哈希；连续输错 5 次会锁定 15 分钟。
- 重置密码会提升账户认证版本，使其他设备上的旧登录令牌失效。
- 好友只能通过手机号添加。
- 戳一下和“我还在”反馈是两种独立信号。
- 回馈“我还在”不会自动帮用户打卡，也不会反向戳对方。
- 每个好友每天同一种信号只保留一次，避免“已戳”状态重登后乱变。
- 注销账户会立即禁用登录并去标识化个人资料；账号凭证、日记、照片和互动数据通常在 7 天内由后台彻底删除。

## 注销清理任务

每天跑一次：

```bash
cd /www/wwwroot/huozhema-api
npm run admin:process-account-deletion
```

这个任务会先删除 OSS 中的头像和日记照片，再彻底删除数据库里的账号及其照片记录、待办、留言、打卡和互动内容。OSS 删除失败时会保留数据库记录，方便下一次安全重试。

## 生产运维

- 使用 PM2 运行 API，并执行 `pm2 save` 保持重启恢复。
- 每天执行一次 `npm run admin:process-account-deletion`。
- 定期检查 `/var/log/huozhema-account-deletion.log` 和 PM2 错误日志。
