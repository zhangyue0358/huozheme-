# 活着吗产品官网部署计划

更新日期：2026-07-18

## 目标

把当前 GitHub Pages 临时官网切换为公司主体下的稳定官网：

- 产品官网：`https://huozhema.senbeikeji.cn/`
- 隐私政策：`https://huozhema.senbeikeji.cn/privacy.html`
- 用户协议：`https://huozhema.senbeikeji.cn/terms.html`

这个地址后续用于：

- App 分享到微信好友/朋友圈
- Apple App Store 审核资料
- 国内安卓应用市场审核资料
- 短信签名、APP 备案、软著/版权材料辅助证明

## 为什么要从 GitHub Pages 切走

GitHub Pages 适合作为开发期临时官网，但不适合做国内正式上架和微信分享链接：

- 微信内置浏览器访问 GitHub Pages 可能不稳定。
- 国内安卓市场更偏好公司主体官网。
- 后续 APP 备案、隐私政策、用户协议最好都使用公司域名。
- 未来接微信开放平台 SDK 时，Universal Links 也应该放在公司域名下。

## 推荐路线

优先使用阿里云，因为当前短信服务已经走阿里云，主体材料可以集中在同一个平台。

1. 确认 `senbeikeji.cn` 已完成域名实名认证。
2. 在阿里云购买或准备一个中国内地可备案的云资源。
3. 以主体“北京森贝科技有限公司”提交 ICP 备案。
4. 备案通过后配置子域名 `huozhema.senbeikeji.cn`。
5. 部署静态官网文件。
6. 确认微信内置浏览器、Safari、Android 浏览器都能打开。
7. App 分享链接和商店资料统一使用公司官网地址。

## 官网文件

当前官网内容已经在项目根目录：

- `index.html`
- `privacy.html`
- `terms.html`
- `projects.html`
- `assets/`

上传时至少需要：

- `index.html`
- `privacy.html`
- `terms.html`
- `assets/`

## DNS 建议

建议使用子域名，不要直接占用公司主域名：

```text
huozhema.senbeikeji.cn
```

常见配置方式：

- 如果用云服务器 Nginx：添加 `A` 记录到服务器公网 IP。
- 如果用对象存储/静态网站托管：添加平台要求的 `CNAME` 记录。
- 如果接 CDN：添加 CDN 提供的 `CNAME` 记录。

## HTTPS

官网必须开启 HTTPS。

建议申请免费 DV 证书：

- 证书域名：`huozhema.senbeikeji.cn`
- 证书部署到云服务器、对象存储、CDN 或静态托管服务。

没有 HTTPS 时，不建议提交应用市场，也不建议用于微信分享。

## 备案资料

主体资料：

- 主体名称：北京森贝科技有限公司
- 统一社会信用代码：91110108MAET83N58J
- 注册地址：北京市海淀区西北旺东路10号院东区15号楼-1层01
- 联系人：张越
- 联系电话：18810409001
- 联系邮箱：zhangyue@senbeikeji.cn

网站信息建议：

- 网站名称：活着吗
- 网站域名：`huozhema.senbeikeji.cn`
- 网站用途：移动应用产品官网、隐私政策、用户协议、用户支持
- 前置审批：一般不涉及，按平台表单实际选项填写

## App 已同步的配置

App 分享链接已改为：

```text
https://huozhema.senbeikeji.cn/
```

环境变量也已补充：

```text
EXPO_PUBLIC_APP_SHARE_URL=https://huozhema.senbeikeji.cn/
```

以后如果官网域名变了，只需要改环境变量并重新打包。

## 上线后检查

官网部署完成后，逐项验证：

- Safari 打开 `https://huozhema.senbeikeji.cn/`
- 微信内置浏览器打开 `https://huozhema.senbeikeji.cn/`
- Safari 打开 `https://huozhema.senbeikeji.cn/privacy.html`
- Safari 打开 `https://huozhema.senbeikeji.cn/terms.html`
- 微信朋友圈分享文案里的链接可以打开
- 应用市场资料里的官网、隐私政策、用户协议 URL 全部一致

## 暂不做

- 暂不接微信开放平台 SDK。
- 暂不做后台 CMS。
- 暂不做登录型官网。
- 暂不在官网展示用户内容。
