# 活着吗上架缺口表

更新日期：2026-07-18

## 已基本就绪

- App 名称、包名、图标、启动页已有。
- Android package：`com.huozhema.app`
- iOS bundle id：`com.huozhema.app`
- MVP 核心功能已能用 Expo Go 真机测试。
- 开发/内测账号 A/B 可跑真实 Supabase 数据；正式包需要关闭测试入口。
- 正式手机号验证码登录已通过 Supabase Send SMS Hook + 阿里云短信跑通。
- Supabase 表结构、Storage、RLS 已有完整 SQL。
- 内测检查清单已整理：`INTERNAL_TEST_CHECKLIST.md`
- 应用市场文案草稿已整理：`STORE_LISTING_DRAFT.md`
- 商店提交资料包已整理：`STORE_SUBMISSION_PACKAGE.md`
- 审核登录方案已整理：`STORE_REVIEW_LOGIN_PLAN.md`
- 最小后台运营说明已整理：`ADMIN_OPERATIONS.md`
- 商店隐私与数据安全填表草稿已整理：`STORE_PRIVACY_DATA_FORMS.md`
- 应用商店截图计划已整理：`STORE_SCREENSHOT_PLAN.md`
- iPhone 和 Android 截图素材已导出并通过 `npm run check:screenshots`。
- 截图测试数据脚本已准备并验证：`npm run prepare:screenshots`
- 公司运营主体、联系邮箱和用户支持邮箱已填写。
- 公司主体上架材料清单已整理：`COMPANY_STORE_MATERIALS.md`
- 国内安卓上架路线已整理：`CHINA_ANDROID_RELEASE_PLAN.md`
- D-U-N-S Number 已获得：`517429052`
- Apple 个人身份筛查/身份信息审核已通过。
- Apple Developer Program 组织账号注册已提交，当前审核中。
- App 内已增加二次确认注销入口，提交后立即退出登录，并将昵称、手机号、好友关系等个人信息去标识化。
- GitHub Actions 账号注销清理任务已配置 Secrets，并已手动运行成功。
- 手机号加好友已改为后端 RPC，增加频率限制，并收紧 `profiles` 读取范围。
- 登录页和好友添加页已显示默认 `+86` 区号，支持直接输入 11 位中国大陆手机号。
- 旧库手机号资料回填补丁已执行，`139...` / `86139...` / `+86139...` 三种输入格式已在线验证可添加好友。
- 重新登录和切换账号时已改为先同步账号快照，再进入首页，避免默认昵称或旧账号资料闪现。
- Expo 已对齐到 SDK 54 期望 patch 版本：`54.0.35`。

## 阻塞上架的缺口

1. 审核登录方案
   - 正式手机号登录已接入并能收码。
   - 风险：App Store 审核人员、以及部分国内应用市场审核人员未必能使用中国大陆手机号接收验证码。
   - 当前方案：正式登录走手机号验证码；如果审核环境收不到短信，审核员点击登录页底部“先看演示模式”进入核心流程。
   - 开发测试账号入口不能直接出现在正式上架包里。
   - `npm run check:release-config` 已用于检查生产构建 profile 是否关闭测试账号入口。

2. 隐私政策和用户协议网页
   - `privacy.html` 和 `terms.html` 已生成。
   - GitHub Pages 已开启，公开 URL：
     - 隐私政策：`https://zhangyue0358.github.io/huozheme-/privacy.html`
     - 用户协议：`https://zhangyue0358.github.io/huozheme-/terms.html`
   - 运营主体：北京森贝科技有限公司
   - 联系邮箱：`zhangyue@senbeikeji.cn`
   - 用户支持邮箱：`senbeikeji@senbeikeji.cn`

3. 账号注销能力
   - App 内已有“注销账户”入口，二次确认后写入 `account_deletion_requests`。
   - 当前会先去标识化昵称、手机号、好友关系和戳一下关系。
   - SQL 已提供 `process_account_deletion_retention()` 清理函数。
   - 已补 `npm run admin:process-account-deletion` 后台清理脚本、`SUPABASE_ACCOUNT_DELETION_CLEANUP.md` 操作文档和 GitHub Actions 定时任务模板。
   - 后台脚本会在内容保留期结束后删除 Supabase Auth 用户。
   - GitHub Actions Secrets 已配置，`Account deletion cleanup` 已手动运行成功。

4. 后台运营能力
   - 当前不建议做完整后台管理 App。
   - 已提供最小后台运营命令：`admin:user-report`、`admin:lookup-user`、`admin:process-account-deletion`。
   - 后续用户量和客服需求上来后，再做带管理员登录、权限和审计日志的内部后台。

5. 手机号加好友防刷验证
   - 已提供 `send_friend_request_by_phone` RPC，限制每个用户 1 小时 10 次、1 天 30 次添加尝试。
   - 已收紧 `profiles` 读取策略，只允许读取自己和已有关联用户。
   - 旧 Supabase 项目已执行 `supabase/patch_friend_request_security.sql` 和 `supabase/patch_friend_request_phone_backfill.sql`。
   - 已在线验证 `139...` / `86139...` / `+86139...` 三种输入格式能归一化为同一个中国大陆手机号。
   - 上线前只需再用正式包复测：正常添加、重复添加、未找到手机号、频繁尝试提示。

6. Android 构建额度
   - EAS 免费 Android 构建额度曾耗尽。
   - 下一次打包前必须确认额度可用，或升级/改用本地构建环境。

7. 最终权限核对
   - 已将 `expo-image-picker` 的 `cameraPermission` 和 `microphonePermission` 显式设为 `false`。
   - `npx expo config --type introspect` 显示 Android 实际权限只有 `READ_MEDIA_IMAGES`；iOS 只保留相册权限说明。
   - 打包前仍需用最终 APK/AAB 再检查一次 Manifest，确认麦克风/相机权限未进入正式包。

8. 依赖安全审计
   - `npm audit fix` 已清理 high/critical 项。
   - 当前生产依赖审计仍有 moderate 项，修复需要 `npm audit fix --force` 并升级到 Expo 57，属于破坏性升级；建议首发后规划 SDK 升级时处理。

9. 应用截图
   - iPhone 截图已导出：`store-assets/screenshots/iphone/`
   - Android 截图已导出：`store-assets/screenshots/android/`
   - `npm run check:screenshots` 已通过。

10. 公司账号材料
   - 统一社会信用代码、注册地址、公司电话、联系人已补齐。
   - D-U-N-S Number 已获得：`517429052`。
   - 产品官网已准备：`https://zhangyue0358.github.io/huozheme-/`
   - 后续建议绑定公司域名，例如 `huozhema.senbeikeji.cn`。

11. Apple Developer 组织账号审核
   - Apple Developer 注册因姓名触发合规筛查，已按邮件要求提交身份信息。
   - 身份审核已通过。
   - Apple Developer Program 组织账号注册已提交。
   - 当前状态：等待 Apple 审核组织账号和公司主体信息。

12. 国内安卓上架材料
   - 当前路线：国内安卓市场优先，Google Play 暂缓。
   - 重点材料：企业开发者认证、营业执照、经办人/法人信息、隐私政策、用户协议、权限说明、APK、截图、APP 备案、软著或 APP 电子版权。
   - `CHINA_ANDROID_RELEASE_PLAN.md` 已整理华为、小米、OPPO、vivo、荣耀、应用宝的准备顺序。
   - 小米官方资质 FAQ 明确要求上架应用提供软著/APP 电子版权/软著认证三选一，并提供 APP 备案；国内其他市场也会围绕 APP 备案、实名资质、隐私合规和安全检测做审核。
   - 因当前 App 走联网登录、Supabase 数据和阿里云短信，国内路线需要优先准备 APP 备案。

## 下一步执行顺序

1. 等 Apple Developer Program 组织账号审核结果。
2. 国内安卓先准备 APP 备案、软著或 APP 电子版权、权限说明和企业认证材料。
3. 优先注册/认证国内安卓开发者账号：华为、小米、OPPO、vivo、荣耀、应用宝。
4. 如果 Apple 或国内安卓市场要求公司网站与组织域名强关联，优先把产品官网绑定到公司域名，例如 `huozhema.senbeikeji.cn`。
5. 提交后台时复制 `STORE_REVIEW_LOGIN_PLAN.md` 中的审核备注，避免审核员无法接收中国短信。
6. 正式包关闭测试账号按钮，并运行 `npm run check:release-config`。
7. 定期查看 `Account deletion cleanup` 的 GitHub Actions 运行状态，确认注销清理任务持续成功。
8. 按 `ADMIN_OPERATIONS.md` 验证最小后台运营命令。
9. 用 `STORE_SUBMISSION_PACKAGE.md` 填写 App Store 和国内安卓市场后台资料。
10. EAS 额度恢复后重新打 Android preview 包；国内安卓正式提交优先准备 APK。
11. 用 Android preview/正式候选包跑完整 `INTERNAL_TEST_CHECKLIST.md`。
12. 准备 iOS TestFlight。

暂缓事项：

- 暂不注册 Google Play Console。
- 暂不处理海外/港澳台分发资料。
- 后续明确做海外市场时，再恢复 Google Play Console 组织账号、海外隐私合规和海外短信可达性测试。

## 打包前命令

```bash
npm run typecheck
npm run check:dev-accounts
npm run check:release-config
npx expo config --type public
```

Android preview：

```bash
npx eas-cli build --profile preview --platform android --non-interactive
```

iOS TestFlight 前还需要 Apple Developer 账号和证书配置。
