const baseUrl = (process.env.HUOZHEMA_API_URL || 'https://api.huozhema.senbeikeji.cn').replace(/\/$/, '');
const accessToken = process.env.HUOZHEMA_ACCESS_TOKEN?.trim() || '';
const timeoutMs = Number(process.env.HUOZHEMA_API_TIMEOUT_MS || 10000);

const results = [];

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`响应不是 JSON: ${text.slice(0, 120)}`);
    }
    return { payload, response };
  } finally {
    clearTimeout(timeout);
  }
}

async function check(name, run) {
  const startedAt = Date.now();
  try {
    await run();
    results.push({ duration: Date.now() - startedAt, name, ok: true });
  } catch (error) {
    const message = error?.name === 'AbortError' ? `${timeoutMs}ms 内未响应` : error.message;
    results.push({ duration: Date.now() - startedAt, message, name, ok: false });
  }
}

function expectStatus(response, expected) {
  if (response.status !== expected) {
    throw new Error(`预期 HTTP ${expected}，实际 HTTP ${response.status}`);
  }
}

await check('API 健康检查', async () => {
  const { payload, response } = await request('/health');
  expectStatus(response, 200);
  if (payload.ok !== true || payload.service !== 'huozhema-domestic-backend') {
    throw new Error('健康检查响应内容不正确');
  }
});

await check('RDS 数据库检查', async () => {
  const { payload, response } = await request('/health/db');
  expectStatus(response, 200);
  if (payload.ok !== true || payload.database !== true) {
    throw new Error('数据库健康检查响应内容不正确');
  }
});

await check('未登录请求被拒绝', async () => {
  const { response } = await request('/me/snapshot');
  expectStatus(response, 401);
});

await check('不存在的路由返回 404', async () => {
  const { response } = await request('/__domestic_api_smoke_test__');
  expectStatus(response, 404);
});

await check('跨域预检可用', async () => {
  const { payload, response } = await request('/me/snapshot', {
    headers: {
      'Access-Control-Request-Headers': 'authorization,content-type',
      'Access-Control-Request-Method': 'GET',
      Origin: 'https://huozhema.senbeikeji.cn',
    },
    method: 'OPTIONS',
  });
  expectStatus(response, 200);
  if (payload.ok !== true) throw new Error('OPTIONS 响应内容不正确');
});

if (accessToken) {
  await check('登录态快照只读检查', async () => {
    const { payload, response } = await request('/me/snapshot', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expectStatus(response, 200);
    if (!payload.profile?.id || !payload.profile?.phoneE164) {
      throw new Error('快照缺少用户资料');
    }
    for (const field of ['diaryEntries', 'friends', 'todos']) {
      if (!Array.isArray(payload[field])) throw new Error(`快照字段 ${field} 不是数组`);
    }
  });
}

console.log(`\n国内 API 验收: ${baseUrl}`);
for (const result of results) {
  const marker = result.ok ? 'PASS' : 'FAIL';
  const detail = result.ok ? '' : ` - ${result.message}`;
  console.log(`${marker.padEnd(4)} ${result.name} (${result.duration}ms)${detail}`);
}

if (!accessToken) {
  console.log('\n提示: 设置 HUOZHEMA_ACCESS_TOKEN 后会额外执行登录态快照只读检查。');
}

if (results.some((result) => !result.ok)) process.exitCode = 1;
