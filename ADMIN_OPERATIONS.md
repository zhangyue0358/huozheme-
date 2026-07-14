# 活着吗后台运营说明

更新日期：2026-07-14

## 是否需要后台管理 App

当前阶段不建议先做完整后台管理 App。

原因：

- “活着吗”保存的是手机号、随笔、照片、心情和好友互动，属于比较敏感的个人内容。
- 早期用户量不大，先用 Supabase Dashboard + 受控脚本可以覆盖排查、注销、统计。
- 完整后台一旦能看用户日记和照片，就需要权限、审计日志、操作留痕、员工账号管理，复杂度会明显上升。

当前建议做“最小后台运营包”：

- 只看聚合统计和账号状态。
- 不默认读取随笔正文、照片内容、每日箴言或三件事文本。
- 只允许在本机或服务器使用 `SUPABASE_SERVICE_ROLE_KEY` 执行。
- 不把任何后台密钥写进 App、GitHub 或 `EXPO_PUBLIC_` 变量。

## 已提供的后台命令

### 1. 用户与数据聚合报表

```bash
SUPABASE_SERVICE_ROLE_KEY="你的 service_role key" npm run admin:user-report
```

用途：

- 查看用户总数。
- 查看打卡、三件事、照片对象数量。
- 查看今日打卡、今日互动。
- 查看好友申请数量。
- 查看注销请求状态。

这个命令不输出用户日记正文、照片 URL 或三件事文本。

### 2. 排查单个用户

按手机号查：

```bash
SUPABASE_SERVICE_ROLE_KEY="你的 service_role key" npm run admin:lookup-user -- --phone 18810409001
```

按用户 ID 查：

```bash
SUPABASE_SERVICE_ROLE_KEY="你的 service_role key" npm run admin:lookup-user -- --user-id 用户uuid
```

用途：

- 查看用户 ID、脱敏手机号、昵称。
- 查看是否有注销请求。
- 查看打卡/三件事/好友/戳一下数量。
- 查看最近打卡日期和照片数量。

这个命令不输出随笔正文、每日箴言、三件事文本或照片链接。

### 3. 执行账户注销保留期清理

```bash
SUPABASE_SERVICE_ROLE_KEY="你的 service_role key" npm run admin:process-account-deletion
```

用途：

- 处理 7 天后的个人信息去标识化。
- 处理 1 年后的内容清理。
- 内容保留期结束后删除 Supabase Auth 用户，并清理已经完成的注销请求。

线上建议使用 GitHub Actions 自动执行。仓库已提供：

```text
.github/workflows/account-deletion-cleanup.yml
```

在 GitHub 仓库 Actions Secrets 里配置 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 后，它会每天北京时间 02:20 自动执行一次。详细操作见 `SUPABASE_ACCOUNT_DELETION_CLEANUP.md`。

## 什么时候需要真正做后台 App

满足任意两项时，再考虑做内部后台 App：

- 每天有稳定真实用户，客服排查开始频繁。
- 需要处理用户举报、封禁、申诉。
- 需要审核用户生成内容。
- 需要查看短信发送失败率、注册漏斗、留存等运营指标。
- 需要多人协作运营，不能再共用 Supabase Dashboard。
- 要接付费、会员、退款、发票或商务合作。

## 后台 App 的最低安全要求

如果后续要做后台 App，至少要有：

- 单独的管理员登录，不和普通用户登录混用。
- 角色权限：只读、客服、管理员分开。
- 操作审计日志：谁在什么时候查了谁、做了什么。
- 默认脱敏手机号。
- 默认不展示用户随笔和照片；只有用户主动投诉/授权/合规需要时才能查看。
- 删除、封禁、恢复等高风险操作二次确认。
- 后台只能部署在受控域名，不放在 App 包里。

## 上架前最低要求

上线前不强制需要完整后台 App，但必须保证：

- 用户可以在 App 内提交注销账户。
- 运营方可以手动执行注销清理脚本，也可以通过 GitHub Actions 定时自动执行。
- 运营方可以按手机号排查账号是否存在。
- 运营方可以看到聚合统计和异常数量。
- `SUPABASE_SERVICE_ROLE_KEY` 只存在服务端或本机安全环境。
