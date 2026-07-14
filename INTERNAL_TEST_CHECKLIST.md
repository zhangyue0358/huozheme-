# 活着吗 MVP 内测检查清单

更新日期：2026-06-24

## 当前目标

这一版先验证“活着吗”主线 MVP，不继续加新功能。重点确认真实 Supabase 数据、A/B 双账号好友互动、随笔照片、历史日记、删除数据后重测都稳定。

## 启动前检查

- Supabase 项目不能处于 paused 状态。
- 手机浏览器打开项目地址时，看到 `No API key found in request` 属于正常在线状态。
- Expo Go 版本要匹配项目 SDK 54。
- 当前 Expo Go 真机测试地址以终端二维码为准。
- 打包前必须跑：

```bash
npm run typecheck
npm run check:dev-accounts
```

## 必须执行过的 Supabase SQL

新库优先直接执行：

```text
supabase/setup_all.sql
```

旧库至少确认执行过：

```text
supabase/patch_huozhema_complete.sql
supabase/patch_journal_photos.sql
supabase/patch_poke_type.sql
supabase/patch_weather_text.sql
supabase/patch_phone_friend_add.sql
supabase/patch_friend_request_security.sql
supabase/patch_delete_app_data_pokes.sql
supabase/patch_checkin_status_default.sql
supabase/patch_friendship_accepted_at.sql
```

如果测试账号手机号丢失，执行：

```text
supabase/patch_dev_test_phone_backfill.sql
```

如果曾遇到 6 月 11 日日记错进 6 月 10 日，执行：

```text
supabase/patch_fix_utc_shift_2026_06_11.sql
```

## A/B 测试账号

- 测试账号 A：`test-a@huozhema.local`，手机号 `13900000001`
- 测试账号 B：`test-b@huozhema.local`，手机号 `13900000002`
- 默认测试密码：见 `.env` 的 `EXPO_PUBLIC_DEV_TEST_PASSWORD`，没有配置时使用开发默认值。

账号健康检查：

```bash
npm run check:dev-accounts
```

需要清空 A/B 业务数据时：

```bash
npm run reset:dev-accounts
```

## 单账号验收

- 测试账号登录成功。
- 未选择心情时，点击“确认我还活着”会提示先选心情。
- 确认活着后，心跳才开始动态跳动。
- 存档进度：
  - `天`：确认活着后亮。
  - `心`：已选择并保存心情后亮。
  - `随`：随笔单独保存后亮。
  - `箴`：箴言单独保存后亮。
  - `事`：今日三件事有完成项后亮。
- 随笔小记必须点保存才写入当天日记。
- 照片最多 3 张，重启后仍能显示。
- “看看今天的我”能看到天气、心情、随笔、照片、箴言、三件事。
- 打卡日历能按日期查看日记。
- 删除本应用数据后：
  - 打卡、待办、好友关系、日记照片清空。
  - 手机号资料保留，仍能被好友手机号搜索到。

## 双账号好友验收

- A 输入 `13900000002` 添加 B。
- B 收到好友申请，底部好友 Tab 左角标出现。
- B 接受后，双方成为好友，但不会自动显示“已戳”或“已确认”。
- B 戳 A：
  - B 端按钮变为“已戳”。
  - A 端好友 Tab 右角标出现。
  - A 端“有人戳你”显示 B。
- A 点“我还活着”：
  - A 不会自动打卡。
  - A 不会自动选择默认心情。
  - A 已回复的戳不再重复显示。
  - B 端好友状态更新为 A “还活着”。
  - B 不应收到“被 A 戳了一下”。
- 删除数据后重新加好友：
  - 旧 poke / alive_reply 不会继承到新好友关系。
  - 新好友关系只认 `accepted_at` 之后的戳和回馈。

## 已知限制

- 当前没有系统推送通知，好友互动依赖 App 打开后的轻量刷新。
- Android 独立 APK 暂受 EAS 免费构建额度限制；最新代码优先用 Expo Go 测。
- 正式版仍需要接入真实手机号短信服务。
- 年终总结、推送通知、正式删除 Auth 用户放到 MVP 稳定后。

## 打包前最后确认

- Supabase 项目未暂停。
- 两台真机都能用 Expo Go 跑通 A/B 双账号链路。
- `npm run typecheck` 通过。
- `npm run check:dev-accounts` 通过。
- `app.json` 图标、包名、权限配置确认无误。
- `.env` 不提交真实密钥。
