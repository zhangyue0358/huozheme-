# 活着吗上架检查清单

## 1. MVP 真机闭环

- 开发环境测试账号 A/B 能进入 App，并走真实 Supabase 数据。
- 手机号验证码登录能进入 App；验证码有效期 60 秒，倒计时结束后才能重新发送。
- 登录页默认显示中国大陆区号 `+86`，用户直接输入 11 位手机号即可；`861xxxxxxxxxx` 和 `+861xxxxxxxxxx` 也能被兼容。
- 重新发送验证码后，旧验证码失效，App 提示清晰。
- 新用户首次登录会自动创建个人资料。
- 重新登录或切换账号时，进入首页前先完成账号快照同步，不闪出默认昵称或上一个账号资料。
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
- 用户能在 App 内通过二次确认注销账户，提交后退出登录，个人信息进入删除流程。

## 2. Supabase

- 新项目在 SQL Editor 执行 `supabase/setup_all.sql`。
- 如果已经建过旧表，至少执行 `supabase/patch_huozhema_complete.sql`、`supabase/patch_journal_photos.sql`、`supabase/patch_poke_type.sql`、`supabase/patch_weather_text.sql`、`supabase/patch_phone_friend_add.sql`、`supabase/patch_friend_request_security.sql`、`supabase/patch_friend_request_phone_backfill.sql`、`supabase/patch_delete_app_data_pokes.sql`、`supabase/patch_checkin_status_default.sql`、`supabase/patch_friendship_accepted_at.sql` 和 `supabase/patch_account_deletion_requests.sql`。
- 如果 2026 年 6 月 11 日的测试日记误出现在 6 月 10 日，执行一次 `supabase/patch_fix_utc_shift_2026_06_11.sql`。
- 确认 Storage bucket `journal-photos` 存在，且不是 public bucket。
- 确认 `.env` 中配置了 `EXPO_PUBLIC_SUPABASE_URL`。
- 确认 `.env` 中配置了 `EXPO_PUBLIC_SUPABASE_ANON_KEY`。
- 确认 Supabase Auth Phone Login 可用，短信服务商已配置。
- 确认 Supabase Send SMS Hook 已启用 HTTPS Endpoint，并保留 `AUTH_HOOK_SECRET`。
- 确认阿里云短信签名、模板、RAM 权限、运营商实名制报备和发送记录均正常。
- 若当前只做开发内测，确认 Supabase Auth 中已创建 `test-a@huozhema.local` 和 `test-b@huozhema.local`。
- 确认 `npm run check:dev-accounts` 通过。
- 正式发布前确认 `npm run check:release-config` 通过，生产 profile 不包含测试账号密码，测试账号按钮关闭。
- 确认手机号添加好友走 `send_friend_request_by_phone` RPC，`profiles` 不再对所有登录用户全表可读。
- 账户注销后台清理按 `SUPABASE_ACCOUNT_DELETION_CLEANUP.md` 配置，确认 GitHub Actions Secrets 已添加，`Account deletion cleanup` 可手动运行成功。
- 后台运营命令按 `ADMIN_OPERATIONS.md` 验证，确认 `admin:user-report` 和 `admin:lookup-user` 可用于排查，不输出用户日记正文或照片链接。
- 确认 Supabase 项目未暂停；免费项目长时间不使用可能 paused，恢复后再测试登录。
- 确认生产环境 RLS 已开启。

## 3. 内测包

- 登录 Expo/EAS 账号。
- 确认 `app.json` 中应用名、bundle id、Android package、照片权限文案可用。
- 运行 `npm run typecheck`。
- 运行 `npm run check:release-config`。
- 运行 `eas build --profile preview --platform ios`。
- 运行 `eas build --profile preview --platform android`，国内安卓正式提交前优先准备 APK。
- iOS 用 TestFlight 或内部安装方式测试。
- Android 用 APK 安装测试；国内应用市场提交前再用正式候选 APK 跑完整清单。

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
- 国内安卓路线清单见 `CHINA_ANDROID_RELEASE_PLAN.md`。
- 国内安卓还要准备 APP 备案、软著或 APP 电子版权、企业开发者认证材料。

## 5. 正式发布前必须补

- 账户注销：当前已有 App 内二次确认注销入口、SQL 清理函数、后台清理脚本、GitHub Actions 定时任务和 Supabase Auth 用户最终删除能力；GitHub Actions 已手动运行验证成功。
- 手机号加好友的隐私防刷策略已补：后端 RPC 限频，App 不再直接按手机号查询 `profiles`。
- 正式短信服务商已接入阿里云短信；发布前继续观察发送成功率、失败原因和成本。
- 正式包使用手机号登录，不展示开发测试账号入口。
- 审核备注说明登录兜底：如果审核环境收不到中国大陆短信，可点击“先看演示模式”体验核心流程。
- 正式隐私政策和用户协议。
- 真实运营主体和联系邮箱。
- 国内安卓首发前补 APP 备案、软著或 APP 电子版权。
- 崩溃和错误监控方案。
- 生产数据库备份策略。
