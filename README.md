# 活着吗 App

一个给年轻人每天确认自己还在的轻社交 App。MVP 主线是每日确认活着、留下当天痕迹、看到好友是否出现。当前主线只做“活着吗”，不包含后续单独项目“点亮生命”。

## 技术路线

- App: Expo + React Native + TypeScript
- 后端: Supabase Auth + Postgres + Row Level Security
- 构建: EAS Build
- 第一阶段分发: Expo Go / EAS internal distribution
- 第二阶段分发: iOS App Store / Android 应用市场

## 本地运行

```bash
npm install
npm start
```

然后用 Expo Go 扫码预览。手机和电脑需要在同一个网络；如果扫码后连接超时，可以用：

```bash
npx expo start --tunnel
```

也可以运行：

```bash
npm run ios
npm run android
```

真机功能验收看 `TESTING_GUIDE.md`。
当前 Android 内测候选版状态看 `BETA_TEST_NOTES.md`。
后期商业化思路看 `BUSINESS_MODEL_NOTES.md`，当前阶段先不急着实现付费功能。
产品官网目标域名是 `https://huozhema.senbeikeji.cn/`，部署和备案步骤看 `PRODUCT_SITE_DEPLOYMENT.md`。

## 接 Supabase

如果你不会操作后台，直接看 `SUPABASE_SETUP.md` 和 `OPC_NEXT_STEPS.md`。这份 README 保留给开发执行。

开发接入步骤：

1. 创建 Supabase 项目。
2. 在 SQL Editor 运行 `supabase/setup_all.sql`。
3. 复制 `.env.example` 为 `.env`。
4. 填入项目 URL 和 publishable/anon key。
5. 正式内测优先使用手机号验证码登录；开发排查时才使用 `测试账号 A` / `测试账号 B`。

正式手机号登录已接入 Supabase Send SMS Hook + 阿里云短信。验证码有效期保持 60 秒；重新发送后旧验证码失效。配置和排查看 `PHONE_LOGIN_SETUP.md`、`ALIYUN_SMS_SETUP.md` 和 `SUPABASE_SEND_SMS_HOOK_DEPLOY.md`。

```bash
cp .env.example .env
```

## MVP 数据表

- `profiles`: 用户手机号、昵称、头像颜色、开始日期、好友可见开关
- `checkins`: 每日存活确认、心情、随笔、照片路径和送给自己的一句话
- `todos`: 今天最想做的三件事，可标记大事
- `friendships`: 好友申请和好友关系
- `pokes`: 好友之间戳一戳，以及“我还活着”的反馈
- Supabase Storage `journal-photos`: 私有随笔照片 bucket

## 当前内测状态

- 正式内测主登录方式是手机号验证码登录，验证码 60 秒内有效。
- 开发环境提供 `测试账号 A` / `测试账号 B`，绕过短信验证码，但走真实 Supabase 数据；只用于排查好友和数据问题。
- 正式上架包必须关闭测试账号入口，且不能设置 `EXPO_PUBLIC_ENABLE_TEST_ACCOUNTS=true`；打包前运行 `npm run check:release-config`。
- Supabase Send SMS Hook 必须保留 `AUTH_HOOK_SECRET`，阿里云短信签名使用 base64 secret 避免中文乱码。
- 好友添加已按手机号提交给后端匹配；中国大陆手机号默认 `+86`，昵称只作为展示名，手机号匹配带频率限制，避免无限扫号。
- 每天戳好友一次后，当天按钮保持“已戳”，对方反馈“我还活着”只更新状态，不会解锁按钮。
- 日期保存已改成本地日期；如果曾在 2026 年 6 月 11 日凌晨操作导致日记出现在 6 月 10 日，可执行 `supabase/patch_fix_utc_shift_2026_06_11.sql` 修正测试数据。

## 产品原则

- 不把未打卡的人写成“死亡”或“失踪”，只显示“没出现”。
- 打卡动作要简单随性，不制造负担。
- 不做公开广场，先做小圈子好友。
- 不做重度效率工具，待办最多三条。
- 所有提醒和互动都要轻，不制造焦虑。
- 只有先确认活着，今天的随笔、照片、心情、箴言和三件事才会留下痕迹。
