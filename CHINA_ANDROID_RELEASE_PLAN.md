# 活着吗国内安卓上架路线

更新日期：2026-07-18

## 结论

当前先走国内路线，不把 Google Play 作为本阶段主线。

优先顺序：

1. Apple 中国区 App Store：等待 Apple Developer Program 组织账号审核。
2. 国内安卓：华为应用市场、小米应用商店、OPPO 软件商店、vivo 应用商店、荣耀应用市场、腾讯应用宝。
3. Google Play：暂缓，后续明确做海外/港澳台市场时再恢复。

## 国内安卓为什么不能直接上

国内安卓市场通常不只是上传 APK，还会检查：

- 企业开发者账号实名认证
- 营业执照和经办人/法人信息
- App 隐私政策、用户协议、权限说明
- APP 备案
- 软著、APP 电子版权或软著认证
- APK 安全扫描、部分市场可能要求加固或安全报告
- 登录方式、账号注销、用户数据处理说明

“活着吗”已经有隐私政策、用户协议、账号注销、手机号登录和截图。当前国内安卓最需要补的是 APP 备案、软著/APP 电子版权、以及各市场企业开发者账号认证。

## 建议先后顺序

### 1. 准备通用材料

- 应用名称：活着吗
- 运营主体：北京森贝科技有限公司
- 统一社会信用代码：`91110108MAET83N58J`
- 公司注册地址：北京市海淀区西北旺东路10号院东区15号楼-1层01
- 联系人：张越
- 联系人手机号：`18810409001`
- 联系邮箱：`zhangyue@senbeikeji.cn`
- 用户支持邮箱：`senbeikeji@senbeikeji.cn`
- 产品官网：`https://zhangyue0358.github.io/huozheme-/`
- 隐私政策：`https://zhangyue0358.github.io/huozheme-/privacy.html`
- 用户协议：`https://zhangyue0358.github.io/huozheme-/terms.html`
- Android package：`com.huozhema.app`
- 截图目录：`store-assets/screenshots/android/`
- 审核备注：见 `STORE_REVIEW_LOGIN_PLAN.md`
- 商店文案：见 `STORE_SUBMISSION_PACKAGE.md`

### 2. 做 APP 备案

当前 App 使用联网登录、Supabase 后端、阿里云短信和用户数据存储，国内市场审核时应优先准备 APP 备案。

准备方向：

- 主办单位：北京森贝科技有限公司
- App 名称：活着吗
- App 包名：`com.huozhema.app`
- 运行平台：Android、iOS
- 服务内容：生活记录、每日确认、好友状态轻互动
- 隐私政策 URL 和用户协议 URL
- 域名或接入服务信息，按备案系统要求填写

### 3. 准备软著或 APP 电子版权

国内安卓市场经常要求证明应用权属。小米官方资质 FAQ 明确写到，上架应用必须提供软著、APP 电子版权、软著认证三选一，并且需要 APP 备案。

建议优先准备：

- 软件名称：活着吗
- 版本号：1.0.0
- 著作权人：北京森贝科技有限公司
- 主要功能说明：每日确认、心情随笔、照片日记、三件事、好友轻互动、账号注销
- 代码材料和说明书，按代理或版权平台要求整理

### 4. 注册国内安卓开发者账号

建议顺序：

1. 华为应用市场
2. 小米应用商店
3. OPPO 软件商店
4. vivo 应用商店
5. 荣耀应用市场
6. 腾讯应用宝

优先华为的原因：

- 流程完整，适合第一次校准企业资料、隐私政策、截图和包体。
- 通过或驳回意见都有参考价值，后续能复用到其他市场。

### 5. 准备国内安卓正式候选包

国内市场优先准备 APK。

提交前检查：

- 正式包关闭测试账号按钮。
- `npm run check:release-config` 通过。
- 手机号验证码登录可用。
- 登录页 60 秒验证码倒计时正常。
- 账号注销入口可用。
- 权限只包含相册读取，不包含麦克风、相机、通讯录、定位。
- Android 截图已通过 `npm run check:screenshots`。

## 每个市场提交时怎么填

先使用统一资料：

- 应用详情：见 `STORE_SUBMISSION_PACKAGE.md`
- 隐私数据填表：见 `STORE_PRIVACY_DATA_FORMS.md`
- 审核登录说明：见 `STORE_REVIEW_LOGIN_PLAN.md`
- 公司材料：见 `COMPANY_STORE_MATERIALS.md`

如果某个市场驳回，不急着大改 App，先看驳回点属于哪类：

- 资质类：补 APP 备案、软著、营业执照、授权文件。
- 隐私类：补权限说明、隐私政策条款、弹窗说明。
- 包体类：补加固、安全检测、兼容性。
- 登录类：补审核说明、演示模式入口说明。

## 暂缓事项

- Google Play Console 组织账号暂缓。
- 海外隐私合规填表暂缓。
- 海外短信到达率测试暂缓。
- 海外应用截图和英文文案暂缓。

## 官方资料入口

- 工信部移动互联网应用程序备案通知：`https://www.miit.gov.cn/zwgk/zcwj/wjfb/tz/art/2023/art_920db564162e4312916a01bed6540ad8.html`
- 工信部备案系统：`https://beian.miit.gov.cn/`
- 华为应用市场分发说明：`https://developer.huawei.com/consumer/cn/appgallery/devstart/`
- 华为应用市场接入说明：`https://developer.huawei.com/consumer/cn/appgallery/`
- 小米开放平台：`https://dev.mi.com/`
- 小米应用资质 FAQ：`https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2251`
- 小米版权证明上传指南：`https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1709`
- OPPO 开放平台：`https://open.oppomobile.com/`
- vivo 开放平台：`https://dev.vivo.com.cn/`
- 荣耀开发者服务平台：`https://developer.honor.com/cn/`
- 腾讯应用开放平台：`https://app.open.qq.com/`
