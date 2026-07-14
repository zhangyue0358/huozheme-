# 正式手机号登录接入

当前 App 端已经接好 Supabase 手机号 OTP：

- 发送验证码：`src/lib/authApi.ts` 的 `sendPhoneLoginCode()`
- 验证验证码：`src/lib/authApi.ts` 的 `verifyPhoneLoginCode()`
- 中国手机号在登录页可直接输入 11 位，App 会转成 `+86` 格式。

这一步主要是在 Supabase 后台配置短信发送能力。

## 推荐路线

### 路线 A：先用 Supabase 内置 SMS Provider 跑通

适合先做 App Store / Google Play 内测和提审前验证。

Supabase 官方 Phone Login 支持的内置 SMS Provider 包括：

- MessageBird / Bird
- Twilio
- Vonage
- Textlocal

操作路径：

1. 打开 Supabase Dashboard。
2. 进入当前项目。
3. 左侧进入 `Authentication`。
4. 进入 `Providers`。
5. 找到 `Phone`，打开 Enable。
6. 选择 SMS Provider。
7. 填入服务商提供的账号信息。
8. 保存。
9. 回到 App，输入手机号，测试发送 6 位验证码。

注意：

- Supabase 默认同一个用户 60 秒内只能请求一次 OTP。
- Supabase 默认项目级 OTP 发送量有频率限制。
- 免费/默认邮件通道限制很低；手机号短信需要接自己的 SMS Provider。
- 如果服务商不能稳定给中国大陆手机号发短信，就不要硬扛，改走路线 B。

### 路线 B：中国正式版用自有短信服务商

适合主要面向中国手机号的正式版。

思路是使用 Supabase `Send SMS Hook`，把 Supabase 生成的 OTP 交给你自己的短信服务商发送，例如：

- 腾讯云短信
- 阿里云短信

这种路线更适合国内手机号，但需要额外做一个服务端函数：

1. Supabase 生成 OTP。
2. Supabase 调用 Send SMS Hook。
3. Hook 里的服务端代码调用腾讯云/阿里云短信 API。
4. 用户收到短信。
5. App 继续用现在的 `verifyOtp` 验证验证码。

App 端不用重写登录逻辑。

## 当前先做哪条

为了中国手机号正式版稳定和成本可控，当前建议先做路线 B，并优先选阿里云短信。

具体操作看：

```text
ALIYUN_SMS_SETUP.md
SUPABASE_SEND_SMS_HOOK_DEPLOY.md
```

路线 A 仍可作为临时兜底，但 Twilio 等海外短信服务商发中国验证码成本明显更高，不建议作为正式长期方案。

## 测试清单

单账号：

- 输入 11 位中国手机号。
- 点击发送验证码。
- 60 秒内收到 6 位验证码。
- 输入验证码能登录。
- “我”页显示手机号脱敏，例如 `139****0001`。
- 退出登录后再用手机号登录，仍能进入同一个账号。

双账号：

- A 手机号登录。
- B 手机号登录。
- A 用 B 手机号添加好友。
- B 接受好友申请。
- A/B 戳一下和回馈“我还活着”正常。

异常：

- 60 秒内重复发送，App 显示 Supabase 的频率限制提示。
- 输入错误验证码，App 显示登录失败。
- 输入不带 `+86` 的 11 位手机号，会自动转成 `+86`。
- 输入非中国手机号时，需要带国际区号。

## 上架前要求

- 正式包必须关闭开发测试账号入口。
- 打包前运行：

```bash
npm run typecheck
npm run check:release-config
```

- 如果审核包要求提供登录方式，优先提供一个可接收验证码的测试手机号，或在审核备注中说明测试流程。
