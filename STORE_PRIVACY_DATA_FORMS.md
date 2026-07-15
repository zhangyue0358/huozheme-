# 活着吗商店隐私与数据安全填表草稿

更新日期：2026-07-15

本文件用于后续填写 App Store Connect 的 App Privacy 和 Google Play Console 的 Data safety。正式提交前，以商店后台当时的问卷文案为准。

## 基础判断

- App 是否收集用户数据：是。
- 是否用于第三方广告或跨 App/网站追踪：否。
- 是否出售用户数据：否。
- 是否使用通讯录权限：否。
- 是否使用定位：否。
- 是否使用麦克风：否。
- 是否允许用户请求删除账户和数据：是，App 内“我 -> 注销账户”。
- 是否加密传输：是，Supabase API 和 Storage 走 HTTPS。
- 服务提供商：Supabase 用于认证、数据库和私有照片存储；阿里云短信用于发送手机号验证码。

## 当前实际收集的数据

| 数据 | 是否收集 | 是否必需 | 用途 | 是否与用户关联 |
| --- | --- | --- | --- | --- |
| 手机号 | 是 | 登录必需 | 手机号验证码登录、账号识别、好友手机号搜索 | 是 |
| 昵称 | 是 | 必需 | 好友列表和个人资料展示 | 是 |
| 用户 ID | 是 | 必需 | 账号识别、数据归属、权限控制 | 是 |
| 今日心情/状态文字 | 是 | 打卡必需 | 每日确认、好友状态展示、历史日记 | 是 |
| 天气氛围 | 是 | 可选/默认 | 当天日记展示 | 是 |
| 随笔小记 | 是 | 可选 | 电子日记 | 是 |
| 随笔照片 | 是 | 可选 | 电子日记照片预览 | 是 |
| 每日箴言 | 是 | 可选/默认 | 电子日记和自我记录 | 是 |
| 今日三件事 | 是 | 可选 | 待办和历史记录 | 是 |
| 好友关系 | 是 | 可选 | 好友申请、好友列表、状态可见性 | 是 |
| 戳一下/我还活着回馈 | 是 | 可选 | 好友互动和状态更新 | 是 |
| 我的遗言 | 否，当前仅本机草稿 | 可选 | 本机草稿，不上传后端 | 否 |
| 精确位置/粗略位置 | 否 | 否 | 无 | 否 |
| 通讯录 | 否 | 否 | 无 | 否 |
| 麦克风/音频 | 否 | 否 | 无 | 否 |
| 广告 ID | 否 | 否 | 无 | 否 |
| 崩溃诊断/分析 SDK | 暂未接入 | 否 | 暂无 | 否 |

## App Store Connect：App Privacy 建议填写

### Data Used to Track You

- 选择：No。
- 原因：当前不做广告追踪、不接第三方广告 SDK、不跨 App/网站追踪用户。

### Data Linked to You

建议勾选：

- Contact Info
  - Phone Number：用于手机号登录、账号识别、好友手机号搜索。
- User Content
  - Photos or Videos：用户主动选择随笔照片时收集。
  - Other User Content：随笔小记、每日箴言、今日三件事、心情状态、好友互动内容。
- Identifiers
  - User ID：Supabase Auth 用户 ID，用于数据归属和权限控制。

可根据 App Store Connect 后台实际选项补充：

- App Activity / Product Interaction：如果后台把打卡、戳一下、待办完成状态归类为产品交互，可勾选，并说明只用于 App 功能，不用于广告或追踪。

### Purpose

上述数据用途建议选择：

- App Functionality。
- Account Management。

不建议选择：

- Third-Party Advertising。
- Developer's Advertising or Marketing。
- Analytics，除非后续接入分析 SDK。

### Data Not Linked to You

当前没有明确的匿名统计数据。若后续接入崩溃监控或匿名分析，再补充。

## Google Play Console：Data safety 建议填写

### Data collected

建议填写“收集”的数据类型：

- Personal info
  - Phone number：登录、账号识别、好友手机号搜索。
  - Name / Other personal info：昵称用于个人资料和好友列表展示。
  - User IDs：Supabase 用户 ID。
- Photos and videos
  - Photos：用户主动上传随笔照片时收集。
- App activity 或 User-generated content
  - App interactions / Other user-generated content：打卡、心情、随笔、箴言、三件事、好友戳一下和回馈。

具体每项用途：

- App functionality。
- Account management。

是否必需：

- 手机号、用户 ID：必需。
- 昵称：必需或默认生成后可修改。
- 随笔、照片、每日箴言、三件事、好友互动：可选。
- 手机号添加好友：仅用于后端匹配目标用户；App 不直接读取全量手机号资料，并对添加尝试做频率限制。

### Data shared

建议填写：No。

说明：Supabase 作为后端服务提供商处理认证、数据库和私有照片存储；阿里云短信作为短信服务提供商处理手机号验证码发送。两者均不用于第三方独立目的、广告追踪或独立营销；若 Google Play 后台要求披露服务提供商处理方式，以后台说明为准。

### Security practices

- Data is encrypted in transit：Yes。
- Users can request that data be deleted：Yes。
- Independent security review：No，除非后续完成 Google 指定的独立安全审查。

### Sensitive permissions

- Photos / media：用于用户主动选择随笔照片。
- Contacts：No。
- Location：No。
- Microphone：No。

## 注销与保留规则填表说明

- App 内路径：`我 -> 注销账户`。
- 注销方式：二次确认后提交注销请求，立即退出登录。
- 个人信息处理：昵称、手机号、好友关系、戳一下关系先去标识化/清理；账户进入注销处理中，不能继续登录。
- 保留期：个人信息默认 7 天缓冲期；日记、打卡、照片、三件事等内容最长保留一年后清理。
- 后台能力：SQL 已提供 `process_account_deletion_retention()`，后台脚本会在内容保留期结束后删除 Supabase Auth 用户；GitHub Actions 定时任务模板已提供，上线前需要配置 Secrets 并手动运行验证。

## 上架前需要再确认

- 正式包关闭测试账号按钮。
- Android 最终 Manifest 不包含 `RECORD_AUDIO`。
- 若接入崩溃监控、推送通知或数据分析 SDK，需要重新更新本文件、隐私政策和商店填表。
- 若“我的遗言”改为云端保存，需要新增披露为用户生成内容，并补充更严格的加密和二次确认说明。

## 官方参考入口

- Apple App Privacy：`https://developer.apple.com/help/app-store-connect/manage-app-privacy/app-privacy-details`
- Google Play Data safety：`https://support.google.com/googleplay/android-developer/answer/10787469`
