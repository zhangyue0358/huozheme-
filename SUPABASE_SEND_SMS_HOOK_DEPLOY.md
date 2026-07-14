# Supabase Send SMS Hook 部署

这个 Hook 用于正式手机号登录：

```text
App 输入手机号 -> Supabase 生成 OTP -> send-sms-hook 调用阿里云短信 -> 用户收到验证码 -> App 验证 OTP
```

函数文件：

```text
supabase/functions/send-sms-hook/index.ts
```

Supabase Auth Hook 有较短超时限制。当前函数会同步调用阿里云发送短信，但给阿里云请求设置短超时，避免因为阿里云网络延迟导致 App 长时间等待并报：

```text
Failed to reach hook within maximum time of 5 seconds
```

## 1. 准备阿里云参数

你需要自己保存这 4 个值，不要发给别人：

```text
ALIYUN_ACCESS_KEY_ID
ALIYUN_ACCESS_KEY_SECRET
ALIYUN_SMS_SIGN_NAME
ALIYUN_SMS_SIGN_NAME_BASE64
ALIYUN_SMS_TEMPLATE_CODE
```

其中：

- `ALIYUN_SMS_SIGN_NAME`：阿里云已审核通过的短信签名，例如 `北京森贝科技`
- `ALIYUN_SMS_SIGN_NAME_BASE64`：中文签名的 base64 版本，用来避免远端环境变量中文乱码；`北京森贝科技` 对应 `5YyX5Lqs5qOu6LSd56eR5oqA`
- `ALIYUN_SMS_TEMPLATE_CODE`：阿里云模板 Code，例如 `SMS_123456789`
- 模板变量名必须是 `code`

## 2. 设置 Supabase Secrets

在项目目录执行：

```bash
cd "/Users/zhangyue/Documents/New project/huozheme-"
npx supabase secrets set ALIYUN_ACCESS_KEY_ID="你的 AccessKey ID"
npx supabase secrets set ALIYUN_ACCESS_KEY_SECRET="你的 AccessKey Secret"
npx supabase secrets set ALIYUN_SMS_SIGN_NAME="北京森贝科技"
npx supabase secrets set ALIYUN_SMS_SIGN_NAME_BASE64="5YyX5Lqs5qOu6LSd56eR5oqA"
npx supabase secrets set ALIYUN_SMS_TEMPLATE_CODE="SMS_xxxxxxxxx"
```

如果你最终换了别的中文签名，建议重新生成 base64：

```bash
node -e "console.log(Buffer.from('你的签名','utf8').toString('base64'))"
```

可选：

```bash
npx supabase secrets set ALIYUN_SMS_REGION_ID="cn-hangzhou"
```

注意：

- 不要把这些值写进 `.env.example`
- 不要提交到 GitHub
- 不要放进 `EXPO_PUBLIC_` 变量

## 3. 部署 Edge Function

```bash
npx supabase functions deploy send-sms-hook --no-verify-jwt
```

部署成功后，函数地址通常是：

```text
https://你的项目 ref.functions.supabase.co/send-sms-hook
```

可以先浏览器打开这个地址，如果看到类似下面内容，说明函数在线：

```json
{"ok":true,"service":"huozhema-send-sms-hook"}
```

## 4. 在 Supabase Auth 里启用 Hook

进入 Supabase Dashboard：

```text
Authentication > Hooks
```

找到：

```text
Send SMS Hook
```

选择 HTTP Request / HTTPS Endpoint，然后填：

```text
https://你的项目 ref.functions.supabase.co/send-sms-hook
```

如果页面提供 `Signing secret` / `Webhook secret`，把这个 secret 也写入 Supabase Secrets：

```bash
npx supabase secrets set AUTH_HOOK_SECRET="页面给你的 secret"
```

然后重新部署一次：

```bash
npx supabase functions deploy send-sms-hook --no-verify-jwt
```

当前正式内测环境必须保留 `AUTH_HOOK_SECRET`。如果缺失，Hook 可能仍能发送短信，但不符合正式发布前的安全要求。

## 5. 测试

测试前先确认：

```text
Authentication > Providers > Phone
```

里面的 Phone Provider 已经 Enable，并且已经保存。否则 App 会报：

```text
Unsupported phone provider
```

1. 打开 App 登录页。
2. 输入 11 位中国手机号，例如 `18810409001`。
3. 点击发送验证码。
4. 手机收到阿里云短信。
5. 输入 6 位验证码。
6. 登录成功后，“我”页显示脱敏手机号。

验证码有效期保持 60 秒。App 登录页会显示 60 秒重新发送倒计时；重新发送后，旧验证码会失效。

## 6. 常见错误

### Missing phone or otp code

说明 Supabase Hook 请求体字段和函数提取逻辑不匹配。把 Supabase Function Logs 截图发给我，不要发密钥。

### Unsupported phone provider

说明 Supabase Auth 的手机号登录没有启用，或者启用后没有保存。去后台确认：

```text
Authentication > Providers > Phone
```

打开 Phone Provider 后保存。然后再确认：

```text
Authentication > Hooks > Send SMS Hook
```

Send SMS Hook 已启用并保存。

### Aliyun SendSms failed: isv.SMS_SIGNATURE_ILLEGAL

短信签名不对，检查：

```text
ALIYUN_SMS_SIGN_NAME
```

必须和阿里云审核通过的签名完全一致。

### Aliyun SendSms failed: isv.SMS_TEMPLATE_ILLEGAL

模板 Code 不对，检查：

```text
ALIYUN_SMS_TEMPLATE_CODE
```

### Aliyun SendSms failed: isv.INVALID_PARAMETERS

通常是手机号格式或模板变量不对。模板变量必须是：

```text
code
```

### 收不到短信

检查：

- 阿里云短信控制台发送记录
- Supabase Function Logs
- 手机号是否正确
- 是否频繁发送触发限制
