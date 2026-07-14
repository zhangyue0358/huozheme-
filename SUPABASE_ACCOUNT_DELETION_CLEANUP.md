# 账户注销后台清理

App 里用户点击“注销账户”后，会写入 `account_deletion_requests`，并立即退出到登录页。后台清理分三段：

- 7 天后：删除/去标识化个人信息、好友关系、戳一下关系。
- 1 年后：删除随笔照片、checkins、todos 等内容数据。
- 内容删除完成后：后台脚本删除 Supabase Auth 用户，让手机号登录账户最终失效，并清理已经完成的注销请求。

对应 SQL 函数在 `supabase/patch_account_deletion_requests.sql`：

```sql
select * from public.process_account_deletion_retention();
```

## 手动执行

先确认你已经在 Supabase SQL Editor 执行过：

```text
supabase/patch_account_deletion_requests.sql
```

然后在本机终端执行：

```bash
cd "/Users/zhangyue/Documents/New project/huozheme-"
SUPABASE_SERVICE_ROLE_KEY="你的 service_role key" npm run admin:process-account-deletion
```

注意：

- `SUPABASE_SERVICE_ROLE_KEY` 只能放在本机终端、服务器环境变量或 Supabase/Vercel/GitHub Actions 的 Secret 里。
- 不能写进 App 代码。
- 不能使用 `EXPO_PUBLIC_` 前缀。
- 不能提交到 GitHub。

成功输出示例：

```text
Account deletion retention job finished.
Personal data processed: 0
Content accounts processed: 0
Auth users deleted after content retention: 0
```

## GitHub Actions 定时任务

仓库已经提供定时任务模板：

```text
.github/workflows/account-deletion-cleanup.yml
```

它会每天北京时间 02:20 自动执行：

```bash
npm run admin:process-account-deletion
```

正式启用前，需要在 GitHub 仓库里添加两个 Actions Secrets：

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

操作路径：

```text
GitHub 仓库 -> Settings -> Secrets and variables -> Actions -> New repository secret
```

`SUPABASE_URL` 填 Supabase 项目 URL，例如：

```text
https://你的项目ref.supabase.co
```

`SUPABASE_SERVICE_ROLE_KEY` 填 Supabase 后台 Project Settings -> API 里的 `service_role` key。这个 key 权限很高，只能放在 GitHub Secret、本机终端或服务器环境变量里，不能写入 App 代码，不能提交到仓库。

添加完成后，可以在 GitHub 仓库：

```text
Actions -> Account deletion cleanup -> Run workflow
```

手动跑一次，看到类似下面输出就说明定时任务可用：

```text
Account deletion retention job finished.
Personal data processed: 0
Content accounts processed: 0
Auth users deleted after content retention: 0
```

## 其他定时任务方案

正式上线前，建议每天执行一次这个脚本或同等逻辑。

可选方式：

- Supabase Edge Function + Scheduled Function：在 Supabase 后台配置每日调用，函数内部用 service role key 调用 `process_account_deletion_retention()`。
- Vercel Cron / 自己的服务器 cron：每天跑 `npm run admin:process-account-deletion`。

无论用哪种方式，都必须使用服务端环境变量保存 `SUPABASE_SERVICE_ROLE_KEY`。

## 验证 SQL

查看还有多少注销请求：

```sql
select status, count(*)
from public.account_deletion_requests
group by status
order by status;
```

状态含义：

- `pending`：已提交注销请求，等待 7 天个人信息处理。
- `personal_data_deleted`：手机号、昵称、好友关系等个人信息已处理，内容仍按 1 年保留。
- `content_deleted`：随笔、照片、打卡、三件事等内容已到期删除，等待脚本删除 Supabase Auth 用户；删除完成后，这条注销请求会被清理。
- `cancelled`：预留状态，目前 App 内没有恢复注销流程。

手动触发清理：

```sql
select * from public.process_account_deletion_retention();
```

查看最近的注销请求：

```sql
select user_id, status, requested_at, personal_data_delete_after, content_delete_after
from public.account_deletion_requests
order by requested_at desc
limit 20;
```
