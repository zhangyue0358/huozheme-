# Supabase 接入步骤

这份文档用于把“活着吗”从演示模式切到真实云端数据。

## 1. 创建项目

1. 登录 Supabase。
2. 新建项目，项目名建议 `huozhema`。
3. 记录项目密码，选择离主要用户近的区域。
4. 等项目创建完成。

## 2. 建表和权限

打开 Supabase 项目的 SQL Editor，新项目优先执行：

```sql
-- 复制并执行 supabase/setup_all.sql 的全部内容
```

如果你之前已经执行过旧版 schema，再执行：

```sql
-- 复制并执行 supabase/patch_huozhema_complete.sql 的全部内容
-- 如果只缺随笔照片能力，也可以单独执行 supabase/patch_journal_photos.sql
-- 如果只缺戳一下反馈类型，也可以单独执行 supabase/patch_poke_type.sql
-- 如果只缺天气字段，也可以单独执行 supabase/patch_weather_text.sql
-- 如果只缺手机号加好友能力，也可以单独执行 supabase/patch_phone_friend_add.sql
-- 如果只缺手机号加好友防刷和 profile 读取收紧，也可以单独执行 supabase/patch_friend_request_security.sql
```

执行完成后确认 Storage 里存在私有 bucket `journal-photos`，用于保存随笔小记照片。

如果你在 2026 年 6 月 11 日凌晨测试过，且日记误显示到 6 月 10 日，执行一次 `supabase/patch_fix_utc_shift_2026_06_11.sql`。这是旧版本 UTC 日期问题的数据修正脚本，新数据不需要重复执行。

## 3. 配置 App 环境变量

在项目根目录新建 `.env`：

```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

`Project URL` 和 key 在 Supabase 项目设置的 API 页面。新项目可能显示为 `publishable key`，旧文档里也常叫 `anon key`。

## 4. 开启手机号登录

在 Supabase Authentication 设置里开启 Phone Login。第一版使用短信验证码，不需要密码。

Supabase 手机号登录需要短信服务商。开发期可以先接 Twilio、MessageBird、Vonage，或 Supabase 后台支持的其他 SMS Provider。没有配置短信服务时，App 会发送失败。

如果暂时不接短信服务，Expo Go 内可以用 `测试账号 A` / `测试账号 B` 继续测试真实云端数据。这个入口只在开发环境显示，正式包不会显示。

开发测试账号需要先在 Supabase Authentication Users 中手动创建：

- `test-a@huozhema.local`
- `test-b@huozhema.local`

默认开发密码为 `HuozhemaTest2026!`，也可以在 `.env` 中用 `EXPO_PUBLIC_DEV_TEST_PASSWORD` 覆盖。
测试账号 A 会自动绑定 `13900000001`，测试账号 B 会自动绑定 `13900000002`，用于开发期测试手机号加好友。

## 5. 本地验证

```bash
npm install
npm start
```

用 Expo Go 扫码打开。真实模式下应验证：

- 输入手机号能收到短信验证码。
- 首次登录后自动创建个人资料。
- 能修改昵称。
- 能打卡。
- 能保存随笔小记。
- 能上传最多三张随笔照片。
- 能查看历史电子日记。
- 能添加和完成今日待办。
- 能给今日待办标记“大事”。
- 能保存每日送给自己的一句话。
- 两个账号能通过手机号互加好友。
- 频繁输入不存在的手机号添加好友，会提示“添加太频繁，请稍后再试”，不能无限扫号。
- 接受好友后能看到对方今日状态。
- 能戳一下好友。
- 被戳后点“我还活着”，对方能看到状态更新，但当天按钮仍保持“已戳”。
- 关闭好友可见状态后，对方不能读取状态文字。
- 删除本应用数据后，资料、打卡、待办和好友关系被删除。

## 6. 还没完成的正式能力

- 删除 Supabase Auth 用户本身由后台清理脚本在内容保留期结束后处理；上线前需要按 `SUPABASE_ACCOUNT_DELETION_CLEANUP.md` 配置 GitHub Actions Secrets。
- 手机号加好友已经改为数据库 RPC，并收紧 `profiles` 读取范围；旧项目需要执行 `supabase/patch_friend_request_security.sql`。
- 推送提醒需要接 Expo Notifications，并配置 iOS/Android 权限文案。
- 隐私政策和用户协议需要填真实运营主体、联系邮箱和网页链接。
