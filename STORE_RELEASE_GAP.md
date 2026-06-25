# 活着吗上架缺口表

更新日期：2026-06-25

## 已基本就绪

- App 名称、包名、图标、启动页已有。
- Android package：`com.huozhema.app`
- iOS bundle id：`com.huozhema.app`
- MVP 核心功能已能用 Expo Go 真机测试。
- 测试账号 A/B 可跑真实 Supabase 数据。
- Supabase 表结构、Storage、RLS 已有完整 SQL。
- 内测检查清单已整理：`INTERNAL_TEST_CHECKLIST.md`
- 应用市场文案草稿已整理：`STORE_LISTING_DRAFT.md`
- 开发者主体类型、运营主体、联系邮箱和用户支持邮箱已填写。

## 阻塞上架的缺口

1. 真实手机号登录
   - 当前正式短信服务商未稳定接入。
   - 内测按钮不能直接出现在正式上架包里。

2. 隐私政策和用户协议网页
   - `privacy.html` 和 `terms.html` 已生成。
   - 还没有公开 URL。
   - GitHub Pages 目标地址：
     - 隐私政策：`https://zhangyue0358.github.io/huozheme-/privacy.html`
     - 用户协议：`https://zhangyue0358.github.io/huozheme-/terms.html`
   - 发布方式：GitHub 仓库 Settings -> Pages -> Deploy from branch -> `main` / root。
   - 真实运营主体和联系邮箱已填写。

3. 账号注销能力
   - 当前 App 内删除业务数据，但不删除 Supabase Auth 用户。
   - 正式上架需要明确账号注销路径，至少提供人工处理邮箱。

4. Android 构建额度
   - EAS 免费 Android 构建额度曾耗尽。
   - 下一次打包前必须确认额度可用，或升级/改用本地构建环境。

5. 最终权限核对
   - `npx expo config --type public` 仍显示 `RECORD_AUDIO` 出现在 permissions 和 blockedPermissions 中。
   - 打包前必须用最终 APK/AAB 或 introspect 检查 Android Manifest，确认麦克风权限未进入正式包。

6. 应用截图
   - 需要准备 iPhone 和 Android 截图。
   - 建议用测试账号填充数据，避免真实手机号暴露。

## 下一步执行顺序

1. 把隐私政策、用户协议发布成可访问网页。
2. 决定正式登录方案：短信服务商 / 继续测试账号仅内测 / 其他登录方式。
3. 正式包关闭测试账号按钮。
4. 生成截图素材。
5. EAS 额度恢复后重新打 Android preview 包。
6. 用 Android preview 包跑完整 `INTERNAL_TEST_CHECKLIST.md`。
7. 准备 iOS TestFlight。

## 打包前命令

```bash
npm run typecheck
npm run check:dev-accounts
npx expo config --type public
```

Android preview：

```bash
npx eas-cli build --profile preview --platform android --non-interactive
```

iOS TestFlight 前还需要 Apple Developer 账号和证书配置。
