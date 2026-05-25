# 在另一台电脑继续开发

Codex 的项目文件默认保存在当前电脑本地，不会因为使用同一个账号就自动同步到另一台电脑。

## 推荐做法

把本项目文件夹带到另一台电脑，然后在那里重新安装依赖。

## 解压后运行

```bash
npm install
npm start
```

## 需要重新创建 `.env`

迁移包不会包含 `.env`，避免把本地环境配置混进压缩包。你需要在项目根目录新建 `.env`：

```bash
EXPO_PUBLIC_SUPABASE_URL=https://scflzwteznpdinqrbdlp.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=你的 publishable key
```

`publishable key` 可以从 Supabase 的 API Keys 页面复制，开头通常是 `sb_publishable_`。

## 不需要迁移的东西

- `node_modules/`：另一台电脑运行 `npm install` 会重新生成
- `.git/`：如果还没正式用 GitHub，同步 ZIP 即可
- `.env`：在新电脑单独配置

## 长期方案

等 MVP 稳定后，应该把项目推到 GitHub 私有仓库。之后任何电脑都可以：

```bash
git clone <repo-url>
npm install
npm start
```
