# 活着吗商店提交资料包

更新日期：2026-07-14

本文件用于 App Store Connect 和 Google Play Console 后台复制填写。

## 基础信息

- 应用名称：活着吗
- 版本号：1.0.0
- iOS Bundle ID：`com.huozhema.app`
- Android Package：`com.huozhema.app`
- 开发者主体：北京森贝科技有限公司
- D-U-N-S Number：`517429052`
- 联系邮箱：`senbeikeji@senbeikeji.cn`
- 用户支持邮箱：`senbeikeji@senbeikeji.cn`
- 隐私政策：`https://zhangyue0358.github.io/huozheme-/privacy.html`
- 用户协议：`https://zhangyue0358.github.io/huozheme-/terms.html`
- 产品官网：`https://zhangyue0358.github.io/huozheme-/`
- 审核登录方案：见 `STORE_REVIEW_LOGIN_PLAN.md`

## 截图素材

### iPhone

目录：`store-assets/screenshots/iphone/`

- `01_home.png`：首页确认活着
- `02_journal_photos_quote.png`：随笔、照片和每日箴言
- `03_todos.png`：今天最想做的三件事
- `04_calendar.png`：打卡日历
- `05_friends.png`：好友存活雷达

尺寸检查：`1290 x 2796`，已通过 `npm run check:screenshots`。

### Android

目录：`store-assets/screenshots/android/`

- `01_home.png`：首页确认活着
- `02_journal_photos_quote.png`：随笔、照片和每日箴言
- `03_todos.png`：今天最想做的三件事
- `04_calendar.png`：打卡日历
- `05_friends.png`：好友存活雷达

尺寸检查：`1398 x 2796`，已通过 `npm run check:screenshots`。

## App Store Connect

### App 信息

- 名称：活着吗
- 副标题：每天确认一下还活着
- 类别建议：生活
- 年龄分级建议：按后台问卷填写，先按 12+ 思路准备

### 推广文本

每天给自己留一个很小的信号：我还活着。记录心情、随笔、照片和今天最想做的三件事，也可以和好友轻轻戳一下，确认彼此还在。

### 描述

活着吗不是效率工具，也不是打卡压力器。它只是给今天留一个很小的信号：我还活着。

你可以在每天开始或结束时，选一个心情，确认今天还在；写几句随笔，保存一张照片，记下今天最想做的三件事。所有这些会组成当天的电子日记，之后可以在打卡日历里回看。

如果你愿意，也可以添加好友。好友之间可以轻轻戳一下，问一句“还活着没？”对方回一句“我还活着”，状态就会更新。它不替代紧急联系、医疗或心理支持，只是一个轻量、温和、低压力的存在确认。

主要功能：

- 每日确认还活着
- 今日心情、天气氛围、随笔小记
- 最多 3 张照片记录当天
- 送给自己的一句话
- 今天最想做的三件事
- 打卡日历和历史电子日记
- 好友手机号添加、戳一下和“我还活着”回馈
- App 内二次确认注销账户

### 关键词

每日打卡,心情记录,电子日记,生活记录,好友状态,待办,日记,习惯记录,自我陪伴

### 支持与隐私

- 支持 URL：`https://zhangyue0358.github.io/huozheme-/`
- 营销 URL：`https://zhangyue0358.github.io/huozheme-/`
- 隐私政策 URL：`https://zhangyue0358.github.io/huozheme-/privacy.html`

### App 审核备注

本应用是轻量每日确认和好友状态记录工具。用户可以确认今天还活着，保存心情、随笔、照片、每日箴言和今天最想做的三件事，并通过好友手机号添加好友、戳一下和“我还活着”回馈进行轻量互动。

本应用不提供医疗、心理诊断、紧急救援或危机干预服务；好友互动仅用于轻量状态确认。

正式审核测试说明：

1. 使用手机号验证码登录。
2. 选择今日心情并确认还活着。
3. 保存随笔、照片、每日箴言和三件事。
4. 使用另一个手机号账号发送/接受好友申请。
5. 测试戳一下和“我还活着”回馈。

开发测试账号只用于本地开发和内部 preview 包。正式生产包必须关闭开发测试账号按钮，并通过 `npm run check:release-config` 检查。

如果审核人员无法使用中国大陆手机号接收验证码，请在审核备注中说明：点击登录页底部“先看演示模式”进入 App，无需账号即可体验核心流程。不要把开发测试账号说明混入正式手机号登录版本的备注。

## Google Play Console

### 应用详情

- 应用名称：活着吗
- 简短说明：每天确认一下还活着，记录心情、随笔、照片和三件想做的事。

### 完整说明

活着吗是一款轻量的每日确认和生活记录 App。

你可以每天选一个心情，点一下确认还活着，顺手写几句随笔，保存一张照片，记下今天最想做的三件事。当天内容会组成电子日记，可以在打卡日历里回看。

你也可以添加少数好友，轻轻戳一下，问一句“还活着没？”对方回一句“我还活着”，状态就会更新。

活着吗不追求效率，不制造压力，只是帮你给今天留下一个小小的存在信号。

主要功能：

- 每日确认还活着
- 心情、天气氛围、随笔小记
- 照片电子日记
- 每日箴言
- 今天最想做的三件事
- 打卡日历和历史日记
- 好友手机号添加、戳一下和回馈
- App 内二次确认注销账户

### 联系方式

- 联系邮箱：`senbeikeji@senbeikeji.cn`
- 隐私政策：`https://zhangyue0358.github.io/huozheme-/privacy.html`
- 官网：`https://zhangyue0358.github.io/huozheme-/`

## 隐私与数据安全填表摘要

- 是否收集用户数据：是
- 是否用于第三方广告或追踪：否
- 是否出售用户数据：否
- 是否加密传输：是
- 是否提供账号注销：是，`我 -> 注销账户`
- 是否使用通讯录：否
- 是否使用定位：否
- 是否使用麦克风：否
- 是否使用相册：是，仅用于用户主动添加随笔照片

收集数据：

- 手机号：登录、账号识别、好友手机号搜索
- 昵称：个人资料和好友展示
- 用户 ID：账号识别和权限控制
- 心情、天气、随笔、照片、每日箴言、三件事：用户主动记录
- 好友关系、戳一下、我还活着回馈：好友互动和状态展示

用途：

- App 功能
- 账号管理

不选择：

- 第三方广告
- 开发者广告或营销
- 跨 App/网站追踪

## 提交前必须确认

- 正式包关闭测试账号按钮。
- 正式手机号短信服务商可用。
- 审核登录方式已确定，审核员能进入 App。
- `npm run check:release-config` 通过。
- 最终 APK/AAB 权限不包含麦克风和相机。
- App 内注销账户流程可正常提交并退出登录。
- Supabase 后台定时清理任务已接入或已准备人工/定期执行方案。
- EAS 构建额度可用。
- Apple Developer 组织账号审核通过。
- Google Play Console 组织账号注册完成。

## 本地检查命令

```bash
npm run typecheck
npm run check:screenshots
npm run check:dev-accounts
npx expo config --type public
```
