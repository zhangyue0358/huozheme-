type SmsHookPayload = {
  phone?: string;
  token?: string;
  otp?: string;
  code?: string;
  sms?: {
    phone?: string;
    token?: string;
    otp?: string;
    code?: string;
  };
  user?: {
    phone?: string;
  };
};

type AliyunSmsResponse = {
  Code?: string;
  Message?: string;
  RequestId?: string;
  BizId?: string;
};

const encoder = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function decodeBase64Utf8(value: string) {
  const binary = atob(value.trim());
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getAliyunSignName() {
  const encodedSignName = Deno.env.get('ALIYUN_SMS_SIGN_NAME_BASE64');
  if (encodedSignName) return decodeBase64Utf8(encodedSignName);
  return requiredEnv('ALIYUN_SMS_SIGN_NAME');
}

function normalizeChinaPhone(phone: string) {
  const compact = phone.trim().replace(/\s|-/g, '');
  if (/^\+86\d{11}$/.test(compact)) return compact.slice(3);
  if (/^86\d{11}$/.test(compact)) return compact.slice(2);
  if (/^1\d{10}$/.test(compact)) return compact;
  return compact.replace(/^\+/, '');
}

function maskPhone(phone: string) {
  const normalized = normalizeChinaPhone(phone);
  if (normalized.length < 7) return normalized;
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}

function extractPhone(payload: SmsHookPayload) {
  return payload.phone || payload.sms?.phone || payload.user?.phone || '';
}

function extractCode(payload: SmsHookPayload) {
  return payload.otp || payload.token || payload.code || payload.sms?.otp || payload.sms?.token || payload.sms?.code || '';
}

function percentEncode(value: string) {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%7E/g, '~');
}

function canonicalQuery(params: Record<string, string>) {
  return Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
}

function nonce() {
  return crypto.randomUUID();
}

function timestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function base64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function hmacSha1Base64(key: string, message: string) {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return base64(signature);
}

async function hmacSha256Base64(key: Uint8Array, message: string) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return base64(signature);
}

function decodeStandardWebhookSecret(secret: string) {
  const normalized = secret.includes(',') ? secret.split(',').at(-1)?.trim() ?? secret.trim() : secret.trim();
  const raw = normalized.startsWith('whsec_') ? normalized.slice(6) : normalized;
  try {
    const binary = atob(raw);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return encoder.encode(secret);
  }
}

function timingSafeEqual(a: string, b: string) {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

async function verifyStandardWebhook(req: Request, rawBody: string) {
  const secret = Deno.env.get('AUTH_HOOK_SECRET');
  if (!secret) return;

  const webhookId = req.headers.get('webhook-id');
  const webhookTimestamp = req.headers.get('webhook-timestamp');
  const webhookSignature = req.headers.get('webhook-signature');

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    throw new Error('Missing webhook signature headers');
  }

  const timestampSeconds = Number(webhookTimestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > 300) {
    throw new Error('Webhook timestamp is outside the allowed window');
  }

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const expected = await hmacSha256Base64(decodeStandardWebhookSecret(secret), signedContent);
  const signatures = webhookSignature
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.includes(',') ? part.split(',')[1] : part));

  if (!signatures.some((signature) => timingSafeEqual(signature, expected))) {
    throw new Error('Invalid webhook signature');
  }
}

async function sendAliyunSms(phone: string, code: string) {
  const accessKeyId = requiredEnv('ALIYUN_ACCESS_KEY_ID');
  const accessKeySecret = requiredEnv('ALIYUN_ACCESS_KEY_SECRET');
  const signName = getAliyunSignName();
  const templateCode = requiredEnv('ALIYUN_SMS_TEMPLATE_CODE');
  const regionId = Deno.env.get('ALIYUN_SMS_REGION_ID') || 'cn-hangzhou';
  const endpoint = Deno.env.get('ALIYUN_SMS_ENDPOINT') || 'https://dysmsapi.aliyuncs.com/';

  const params: Record<string, string> = {
    AccessKeyId: accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: normalizeChinaPhone(phone),
    RegionId: regionId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: nonce(),
    SignatureVersion: '1.0',
    SignName: signName,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: timestamp(),
    Version: '2017-05-25',
  };

  const query = canonicalQuery(params);
  const stringToSign = `GET&%2F&${percentEncode(query)}`;
  const signature = await hmacSha1Base64(`${accessKeySecret}&`, stringToSign);
  const url = `${endpoint}?Signature=${percentEncode(signature)}&${query}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  console.log(`Sending Aliyun SMS to ${maskPhone(phone)} with sign "${signName}" and template "${templateCode}"`);

  const response = await fetch(url, { method: 'GET', signal: controller.signal }).finally(() => {
    clearTimeout(timeout);
  });
  const result = (await response.json()) as AliyunSmsResponse;

  if (!response.ok || result.Code !== 'OK') {
    throw new Error(`Aliyun SendSms failed: ${result.Code || response.status} ${result.Message || response.statusText}`);
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'GET') {
    return json({ ok: true, service: 'huozhema-send-sms-hook' });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const rawBody = await req.text();

  try {
    await verifyStandardWebhook(req, rawBody);

    const payload = JSON.parse(rawBody) as SmsHookPayload;
    const phone = extractPhone(payload);
    const code = extractCode(payload);

    if (!phone || !code) {
      return json({ error: 'Missing phone or otp code' }, 400);
    }

    const result = await sendAliyunSms(phone, code);
    console.log(`SMS OTP sent to ${maskPhone(phone)} requestId=${result.RequestId || '-'} bizId=${result.BizId || '-'}`);

    return json({ success: true });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
