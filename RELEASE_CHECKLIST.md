# 活着吗上架检查清单

## 1. MVP 真机闭环

- 开发环境测试账号 A/B 能进入 App，并走真实 Supabase 数据。
- 手机号验证码登录能进入 App。若暂未接短信服务商，这项先标记为发布前待补。
- 新用户首次登录会自动创建个人资料。
- 用户能修改昵称。
- 用户能每日打卡。
- 未确认活着前，随笔、照片、心情、箴言、三件事等留痕动作会提示“请先确认还活着吗？”。
- 用户能保存随笔小记，并看到保存反馈。
- 用户能上传最多三张随笔照片。
- 用户能查看历史电子日记。
- 用户能保存每日送给自己的一句话。
- 用户能添加最多三条今日待办，并切换完成状态。
- 用户能把今日待办标记为大事。
- 用户能通过手机号发送好友申请，昵称只作为展示名。
- 被邀请用户能接受好友申请。
- 双方成为好友后，能看到对方今日是否出现。
- 用户能戳一下好友；今天已经戳过后按钮保持“已戳”，直到第二天恢复。
- 被戳用户点“我还活着”后，对方好友页能更新为“还活着”，但不解锁当天“已戳”按钮。
- 关闭“好友可见今日状态”后，好友不能读取状态文字。
- 用户能删除本应用数据，包含打卡、待办、好友关系和随笔照片；手机号资料保留，方便继续被好友搜索。

## 2. Supabase

- 新项目在 SQL Editor 执行 `supabase/setup_all.sql`。
- 如果已经建过旧表，至少执行 `supabase/patch_huozhema_complete.sql`、`supabase/patch_journal_photos.sql`、`supabase/patch_poke_type.sql`、`supabase/patch_weather_text.sql`、`supabase/patch_phone_friend_add.sql`、`supabase/patch_delete_app_data_pokes.sql`、`supabase/patch_checkin_status_default.sql` 和 `supabase/patch_friendship_accepted_at.sql`。
- 如果 2026 年 6 月 11 日的测试日记误出现在 6 月 10 日，执行一次 `supabase/patch_fix_utc_shift_2026_06_11.sql`。
- 确认 Storage bucket `journal-photos` 存在，且不是 public bucket。
- 确认 `.env` 中配置了 `EXPO_PUBLIC_SUPABASE_URL`。
- 确认 `.env` 中配置了 `EXPO_PUBLIC_SUPABASE_ANON_KEY`。
- 确认 Supabase Auth Phone Login 可用，短信服务商已配置。
- 若当前只做开发内测，确认 Supabase Auth 中已创建 `test-a@huozhema.local` 和 `test-b@huozhema.local`。
- 确认 `npm run check:dev-accounts` 通过。
- 确认 Supabase 项目未暂停；免费项目长时间不使用可能 paused，恢复后再测试登录。
- 确认生产环境 RLS 已开启。

## 3. 内测包

- 登录 Expo/EAS 账号。
- 确认 `app.json` 中应用名、bundle id、Android package、照片权限文案可用。
- 运行 `eas build --profile preview --platform ios`。
- 运行 `eas build --profile preview --platform android`。
- iOS 用 TestFlight 或内部安装方式测试。
- Android 用内部测试轨道或 APK/AAB 安装测试。

## 4. 商店材料

- 应用名和副标题。
- 应用简介和关键词。
- 应用市场资料草稿见 `STORE_LISTING_DRAFT.md`。
- 上架缺口表见 `STORE_RELEASE_GAP.md`。
- iPhone 截图。
- Android 截图。
- 隐私政策网页链接。
- 用户协议网页链接。
- 支持邮箱或手机号。
- 年龄分级说明。

## 5. 正式发布前必须补

- 删除 Supabase Auth 用户的服务端能力，或明确的人工账号注销通道。
- 手机号加好友的隐私防刷策略。
- 接入正式短信服务商，或决定其他正式登录方式。
- 正式隐私政策和用户协议。
- 真实运营主体和联系邮箱。
- 崩溃和错误监控方案。
- 生产数据库备份策略。
