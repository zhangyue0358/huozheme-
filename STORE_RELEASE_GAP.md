# 活着吗上架缺口表

更新日期：2026-06-30

## 已基本就绪

- App 名称、包名、图标、启动页已有。
- Android package：`com.huozhema.app`
- iOS bundle id：`com.huozhema.app`
- MVP 核心功能已能用 Expo Go 真机测试。
- 测试账号 A/B 可跑真实 Supabase 数据。
- Supabase 表结构、Storage、RLS 已有完整 SQL。
- 内测检查清单已整理：`INTERNAL_TEST_CHECKLIST.md`
- 应用市场文案草稿已整理：`STORE_LISTING_DRAFT.md`
- 公司运营主体、联系邮箱和用户支持邮箱已填写。
- 公司主体上架材料清单已整理：`COMPANY_STORE_MATERIALS.md`

## 阻塞上架的缺口

1. 真实手机号登录
   - 当前正式短信服务商未稳定接入。
   - 内测按钮不能直接出现在正式上架包里。

2. 隐私政策和用户协议网页
   - `privacy.html` 和 `terms.html` 已生成。
   - GitHub Pages 已开启，公开 URL：
     - 隐私政策：`https://zhangyue0358.github.io/huozheme-/privacy.html`
     - 用户协议：`https://zhangyue0358.github.io/huozheme-/terms.html`
   - 运营主体：北京森贝科技有限公司
   - 联系邮箱/用户支持邮箱：`senbeikeji@senbeikeji.cn`

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

7. 公司账号材料
   - 统一社会信用代码、注册地址、公司电话、联系人已补齐。
   - Apple / Google Play 组织账号通常需要 D-U-N-S Number。
   - 需要公司官网或产品官网。

## 下一步执行顺序

1. 准备公司官网或产品官网。
2. 查询或申请 D-U-N-S Number。
3. 确认公司注册地址展示格式。
4. 决定正式登录方案：短信服务商 / 继续测试账号仅内测 / 其他登录方式。
5. 正式包关闭测试账号按钮。
6. 生成截图素材。
7. EAS 额度恢复后重新打 Android preview 包。
8. 用 Android preview 包跑完整 `INTERNAL_TEST_CHECKLIST.md`。
9. 准备 iOS TestFlight。

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
