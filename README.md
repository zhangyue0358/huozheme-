# 活着吗 App

一个给年轻人每天确认自己还在的轻社交 App。MVP 只做三件事：每日打卡、好友存活状态、最多三条今日待办。

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

然后用 Expo Go 扫码预览，或运行：

```bash
npm run ios
npm run android
```

## 接 Supabase

如果你不会操作后台，直接看 `OPC_NEXT_STEPS.md`。这份 README 保留给开发执行。

开发接入步骤：

1. 创建 Supabase 项目。
2. 在 SQL Editor 运行 `supabase/schema.sql`。
3. 复制 `.env.example` 为 `.env`。
4. 填入项目 URL 和 anon key。

```bash
cp .env.example .env
```

## MVP 数据表

- `profiles`: 用户昵称、头像颜色、开始日期
- `checkins`: 每日存活确认
- `todos`: 每日最多三件小事
- `friendships`: 好友申请和好友关系

## 产品原则

- 不把未打卡的人写成“死亡”或“失踪”，只显示“没出现”。
- 不做公开广场，先做小圈子好友。
- 不做重度效率工具，待办最多三条。
- 所有提醒和互动都要轻，不制造焦虑。
