# 阿里云短信接入准备

目标：正式版手机号登录使用国内短信验证码。App 端已经接好 Supabase 手机号 OTP，这一步主要准备阿里云短信和 Supabase Send SMS Hook。

## 为什么先选阿里云

- 1000 条套餐包即可开始测试，成本低。
- 中国大陆手机号送达更适合国内 App。
- 后续可以用公司主体“北京森贝科技有限公司”申请短信签名和模板。

## 你需要在阿里云准备什么

### 1. 开通短信服务

进入阿里云控制台：

```text
产品与服务 > 短信服务
```

开通后建议先买最小套餐包，例如 1000 条，用于测试。

### 2. 申请短信签名

建议优先申请：

```text
活着吗
```

如果“活着吗”因为品牌证明不足不通过，备选：

```text
森贝科技
```

签名类型建议选：

```text
APP 应用 / 软件著作权或网站备案相关
```

当前如果还没有软著，先用公司主体、产品官网、隐私政策页面辅助证明。

可提供材料：

- 公司主体：北京森贝科技有限公司
- 产品官网：https://huozhema.senbeikeji.cn/
- 隐私政策：https://huozhema.senbeikeji.cn/privacy.html
- 用户协议：https://huozhema.senbeikeji.cn/terms.html
- App 截图：`store-assets/screenshots/iphone/`

### 3. 申请短信模板

模板类型：

```text
验证码
```

建议模板内容：

```text
您的登录验证码为：${code}，请勿泄露给他人。
```

变量名必须是：

```text
code
```

阿里云审核通过后，会得到一个模板 Code，格式类似：

```text
SMS_123456789
```

### 4. 创建 RAM 子账号密钥

不要用主账号 AccessKey。

创建 RAM 用户，权限只给短信发送相关权限。记录：

```text
ALIYUN_ACCESS_KEY_ID
ALIYUN_ACCESS_KEY_SECRET
ALIYUN_SMS_SIGN_NAME
ALIYUN_SMS_TEMPLATE_CODE
```

这些值只能放在服务端环境变量里，不能写进 App，也不能提交 GitHub。

## Supabase 侧接入方式

正式做法是使用 Supabase `Send SMS Hook`：

1. 用户在 App 输入手机号。
2. Supabase 生成 OTP。
3. Supabase 调用你的 Hook。
4. Hook 调用阿里云短信，把 OTP 发给用户。
5. 用户在 App 输入验证码。
6. App 继续用 Supabase `verifyOtp` 验证。

也就是说 App 端不需要重写验证码校验。

## 你现在要做的事

先完成阿里云后台这 4 个结果：

```text
1. 短信服务已开通
2. 短信签名审核通过
3. 短信模板审核通过
4. RAM AccessKey 已创建
```

拿到以后，不要把密钥发给我。你只需要告诉我：

```text
签名名称：已通过 / 未通过
模板 Code：已通过 / 未通过
变量名是否为 code：是 / 否
```

我再继续帮你接 Supabase Hook。

## 验收标准

- App 输入 `18810409001` 这种 11 位中国手机号，能收到 6 位验证码。
- 输入验证码能登录。
- “我”页显示脱敏手机号。
- 用手机号添加好友能搜索到对方。
- 退出登录后，用同一个手机号还能回到同一个账户。
