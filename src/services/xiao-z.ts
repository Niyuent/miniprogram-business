import {
  ZERO_ACCOUNT,
  zeroApiBase,
  ZERO_ENABLED,
  ZERO_PASSWORD,
  ZERO_TOKEN_KEY,
} from '@/config';

export interface ZeroChatResult {
  ok: boolean;
  reply: string;
  source: 'zero' | 'fallback';
}

export interface ZeroBriefResult {
  ok: boolean;
  headline: string;
  advice: string;
  source: 'zero' | 'fallback';
}

export interface ZeroPosterResult {
  ok: boolean;
  imageUrl: string;
  message: string;
}

export interface ZeroParseItem {
  date?: string;
  amount?: number | string;
  category?: string;
  note?: string;
  type?: string;
  name?: string;
  price?: number | string;
}

function zeroUrl(path: string) {
  const base = zeroApiBase().replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function absoluteAsset(url: string) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return zeroUrl(url);
}

function requestZero<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  data?: Record<string, unknown> | string,
  opts?: { auth?: boolean; contentType?: string; timeout?: number },
): Promise<T> {
  const header: Record<string, string> = {};
  const contentType = opts?.contentType ?? 'application/json';
  if (contentType) header['Content-Type'] = contentType;
  if (opts?.auth !== false) {
    const token = uni.getStorageSync(ZERO_TOKEN_KEY) as string;
    if (token) header.Authorization = `Bearer ${token}`;
  }
  return new Promise((resolve, reject) => {
    uni.request({
      url: zeroUrl(path),
      method: method as UniApp.RequestOptions['method'],
      data: data as UniApp.RequestOptions['data'],
      header,
      timeout: opts?.timeout ?? 6000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
          return;
        }
        reject(new Error(zeroErrorMessage(res.data, `Zero ${res.statusCode}`)));
      },
      fail(err) {
        reject(new Error(err.errMsg || 'Zero 不可用'));
      },
    });
  });
}

function pickText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const row = payload as Record<string, unknown>;
  const data = (row.data && typeof row.data === 'object' ? row.data : row) as Record<string, unknown>;
  for (const key of ['reply', 'message', 'content', 'text', 'answer', 'briefing', 'summary', 'body', 'title']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  if (Array.isArray(data.drafts) && data.drafts[0]) {
    const d0 = data.drafts[0] as Record<string, unknown>;
    const parts = [d0.title, d0.body, d0.cta].filter((x) => typeof x === 'string') as string[];
    if (parts.length) return parts.join('\n');
  }
  return '';
}

function zeroErrorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== 'object') return fallback;
  const row = body as { detail?: string | { message?: string }; message?: string; error?: string };
  if (typeof row.detail === 'string' && row.detail.trim()) return row.detail.trim();
  if (typeof row.detail === 'object' && row.detail?.message) return String(row.detail.message);
  if (typeof row.message === 'string' && row.message.trim()) return row.message.trim();
  if (typeof row.error === 'string' && row.error.trim()) return row.error.trim();
  return fallback;
}

/** 登录 Zero 拿商家 JWT（form: account/password）。 */
export async function ensureZeroAuth(force = false): Promise<string> {
  if (!ZERO_ENABLED) throw new Error('未开启 Zero（ZERO_ENABLED=false）');
  const cached = uni.getStorageSync(ZERO_TOKEN_KEY) as string;
  if (cached && !force) return cached;

  const body = `account=${encodeURIComponent(ZERO_ACCOUNT)}&password=${encodeURIComponent(ZERO_PASSWORD)}`;
  const raw = await requestZero<{ status?: string; data?: { token?: string }; message?: string }>(
    '/auth/login',
    'POST',
    body,
    { auth: false, contentType: 'application/x-www-form-urlencoded', timeout: 10000 },
  );
  const token = raw?.data?.token || '';
  if (!token) throw new Error(raw?.message || 'Zero 登录失败，请确认 content_demo 账号存在且服务已启动');
  uni.setStorageSync(ZERO_TOKEN_KEY, token);
  return token;
}

/** 拍菜单等餐饮接口要求 business_type=restaurant；演示账号常为 other，自动纠正。 */
async function ensureRestaurantBusiness() {
  try {
    await requestZero('/api/store-profile/me', 'PATCH', {
      business_type: 'restaurant',
      industry: '餐饮',
    }, { timeout: 10000 });
  } catch {
    // 旧运行时若不支持 PATCH，忽略；识别接口仍会给出明确 403 文案
  }
}

export async function zeroChat(message: string, storeId?: string | number | null): Promise<ZeroChatResult> {
  if (!ZERO_ENABLED) return { ok: false, reply: '', source: 'fallback' };
  try {
    await ensureZeroAuth().catch(() => '');
    const raw = await requestZero<unknown>('/api/assistant/chat', 'POST', {
      message,
      store_id: storeId ?? 'me',
      model: 'default',
      feature: 'assistant.chat',
    }, { timeout: 20000 });
    const reply = pickText(raw);
    if (!reply) return { ok: false, reply: '', source: 'fallback' };
    return { ok: true, reply, source: 'zero' };
  } catch {
    return { ok: false, reply: '', source: 'fallback' };
  }
}

export async function zeroBriefing(storeName?: string): Promise<ZeroBriefResult> {
  if (!ZERO_ENABLED) return { ok: false, headline: '', advice: '', source: 'fallback' };
  try {
    await ensureZeroAuth().catch(() => '');
    const raw = await requestZero<unknown>('/api/briefing/generate', 'POST', {
      store_name: storeName || '',
      store_type: 'retail',
      model: 'default',
    }, { timeout: 20000 });
    const text = pickText(raw);
    if (!text) return { ok: false, headline: '', advice: '', source: 'fallback' };
    const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    return {
      ok: true,
      headline: lines[0] || text.slice(0, 80),
      advice: lines.slice(1).join(' ') || '继续关注今日核销与发积分节奏。',
      source: 'zero',
    };
  } catch {
    return { ok: false, headline: '', advice: '', source: 'fallback' };
  }
}

export interface CreativeTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  suitableFor: string[];
  thumbnail: string;
  thumbColor: string;
  features: Array<{
    key: string;
    label: string;
    ui?: string;
    options?: Array<{ label: string; prompt_value?: string }>;
  }>;
}

export async function zeroListTemplates(): Promise<CreativeTemplate[]> {
  await ensureZeroAuth();
  const raw = await requestZero<
    | { data?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }
    | Array<Record<string, unknown>>
  >('/api/creative/templates', 'GET', undefined, { timeout: 10000 });
  const list = Array.isArray(raw) ? raw : raw.data || raw.items || [];
  return list
    .map((row) => {
      const id = String(row.id || '');
      const thumb = String(row.thumbnail || '');
      return {
        id,
        name: String(row.name || id),
        description: String(row.description || ''),
        category: String(row.category || '通用'),
        suitableFor: Array.isArray(row.suitable_for) ? (row.suitable_for as string[]).map(String) : [],
        thumbnail: absoluteAsset(thumb),
        thumbColor: String(row.thumb_color || '#0f766e'),
        features: Array.isArray(row.features)
          ? (row.features as CreativeTemplate['features'])
          : [],
      };
    })
    .filter((row) => row.id);
}

/** AI 图片美化：对齐 Zero `/api/creative/enhance`（multipart，字段名 files）。 */
export async function zeroEnhanceImage(opts: {
  filePath: string;
  templateId?: string;
  product?: string;
  headline?: string;
  subheadline?: string;
}): Promise<ZeroPosterResult> {
  if (!ZERO_ENABLED) return { ok: false, imageUrl: '', message: '未开启 Zero' };
  if (!opts.filePath) return { ok: false, imageUrl: '', message: '请先选择一张图片' };
  try {
    await ensureZeroAuth();
    let templateId = opts.templateId || '';
    if (!templateId) {
      const tpls = await zeroListTemplates().catch(() => [] as CreativeTemplate[]);
      templateId = tpls.find((t) => t.id === 't2')?.id || tpls[0]?.id || 't2';
    }
    const token = uni.getStorageSync(ZERO_TOKEN_KEY) as string;
    const formData: Record<string, string> = {
      template_id: templateId,
      features: '{}',
      headline: opts.headline || '',
      subheadline: opts.subheadline || '',
      product: opts.product || '',
      seed: '-1',
    };
    const raw = await new Promise<Record<string, unknown>>((resolve, reject) => {
      uni.uploadFile({
        url: zeroUrl('/api/creative/enhance'),
        filePath: opts.filePath,
        name: 'files',
        formData,
        header: token ? { Authorization: `Bearer ${token}` } : {},
        timeout: 120000,
        success(res) {
          try {
            const body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(body as Record<string, unknown>);
              return;
            }
            const detail = (body as { detail?: { message?: string } | string; message?: string })?.detail;
            const msg =
              (typeof detail === 'object' && detail?.message) ||
              (typeof detail === 'string' ? detail : '') ||
              (body as { message?: string })?.message ||
              `美化失败 ${res.statusCode}`;
            reject(new Error(String(msg)));
          } catch (e) {
            reject(e instanceof Error ? e : new Error('美化响应解析失败'));
          }
        },
        fail(err) {
          reject(new Error(`${err.errMsg || '美化上传失败'}（请确认 Zero 已在 ${zeroApiBase()} 启动）`));
        },
      });
    });
    const imageUrl = absoluteAsset(
      String(
        raw.image_url ||
          raw.url ||
          raw.enhanced_url ||
          (raw.items as Array<{ url?: string }>)?.[0]?.url ||
          '',
      ),
    );
    if (!imageUrl) return { ok: false, imageUrl: '', message: '美化完成但未返回图片地址' };
    return { ok: true, imageUrl, message: '图片已美化' };
  } catch (error) {
    return { ok: false, imageUrl: '', message: error instanceof Error ? error.message : '图片美化失败' };
  }
}

/** AI 海报：对齐 Zero `/api/creative/poster`（multipart Form + 可选参考图）。 */
export async function zeroCreatePoster(opts: {
  productName: string;
  templateId?: string;
  filePath?: string;
  lighting?: string;
  tone?: string;
  size?: string;
}): Promise<ZeroPosterResult> {
  if (!ZERO_ENABLED) return { ok: false, imageUrl: '', message: '未开启 Zero' };
  try {
    await ensureZeroAuth();
    let templateId = opts.templateId || '';
    if (!templateId) {
      const tpls = await zeroListTemplates().catch(() => [] as CreativeTemplate[]);
      templateId = tpls.find((t) => t.id === 't2')?.id || tpls[0]?.id || 't2';
    }

    const formData: Record<string, string> = {
      product_name: opts.productName,
      template_id: templateId,
      lighting: opts.lighting || '',
      tone: opts.tone || '',
      size: opts.size || '1:1',
      seed: '-1',
    };

    // 无参考图时仍走 uploadFile：微信端手写 multipart 不稳定；后端 file 可空。
    // 用一张本地 1x1 占位图仅作 multipart 载体（若无法生成则纯 form POST）。
    let filePath = opts.filePath || '';
    if (!filePath) {
      filePath = await makeTinyPng().catch(() => '');
    }

    const token = uni.getStorageSync(ZERO_TOKEN_KEY) as string;
    const raw = await new Promise<Record<string, unknown>>((resolve, reject) => {
      if (filePath) {
        uni.uploadFile({
          url: zeroUrl('/api/creative/poster'),
          filePath,
          name: 'file',
          formData,
          header: token ? { Authorization: `Bearer ${token}` } : {},
          timeout: 120000,
          success(res) {
            try {
              const body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
              if (res.statusCode >= 200 && res.statusCode < 300) resolve(body as Record<string, unknown>);
              else {
                const msg =
                  (body as { message?: string })?.message ||
                  (body as { detail?: string })?.detail ||
                  `海报失败 ${res.statusCode}`;
                reject(new Error(String(msg)));
              }
            } catch (e) {
              reject(e instanceof Error ? e : new Error('海报响应解析失败'));
            }
          },
          fail(err) {
            const msg = err.errMsg || '海报上传失败';
            if (/CONNECTION_REFUSED|fail|timeout/i.test(msg)) {
              reject(new Error(`${msg}（请确认 Zero 已在 ${zeroApiBase()} 启动）`));
            } else {
              reject(new Error(msg));
            }
          },
        });
        return;
      }

      const boundary = `----xz${Date.now()}`;
      const parts: string[] = [];
      Object.entries(formData).forEach(([k, v]) => {
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
      });
      parts.push(`--${boundary}--\r\n`);
      uni.request({
        url: zeroUrl('/api/creative/poster'),
        method: 'POST',
        header: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        data: parts.join(''),
        timeout: 120000,
        success(res) {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data as Record<string, unknown>);
          else {
            const body = res.data as { detail?: { message?: string }; message?: string };
            reject(new Error(body?.detail?.message || body?.message || `海报失败 ${res.statusCode}`));
          }
        },
        fail(err) {
          reject(new Error(`${err.errMsg || '海报请求失败'}（请确认 Zero 已在 ${zeroApiBase()} 启动）`));
        },
      });
    });

    const imageUrl = absoluteAsset(String(raw.image_url || (raw.items as Array<{ url?: string }>)?.[0]?.url || ''));
    if (!imageUrl) return { ok: false, imageUrl: '', message: '海报已生成但未返回图片地址' };
    return { ok: true, imageUrl, message: '海报已生成' };
  } catch (error) {
    return { ok: false, imageUrl: '', message: error instanceof Error ? error.message : '海报生成失败' };
  }
}

/** 生成 1x1 PNG 临时文件，供无参考图时的 uploadFile 载体 */
function makeTinyPng(): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const fs = uni.getFileSystemManager();
      const wxEnv = (globalThis as { wx?: { env?: { USER_DATA_PATH?: string } } }).wx?.env;
      const baseDir = wxEnv?.USER_DATA_PATH;
      if (!baseDir) {
        reject(new Error('无本地目录'));
        return;
      }
      const path = `${baseDir}/xz_poster_blank.png`;
      const base64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5nN7kAAAAASUVORK5CYII=';
      fs.writeFile({
        filePath: path,
        data: base64,
        encoding: 'base64',
        success: () => resolve(path),
        fail: (e) => reject(new Error(e.errMsg || '写占位图失败')),
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error('写占位图失败'));
    }
  });
}

/** 拍照记账：上传小票图解析。 */
export async function zeroParseExpense(filePath: string): Promise<{ ok: boolean; items: ZeroParseItem[]; message: string }> {
  try {
    await ensureZeroAuth();
    const token = uni.getStorageSync(ZERO_TOKEN_KEY) as string;
    const raw = await new Promise<Record<string, unknown>>((resolve, reject) => {
      uni.uploadFile({
        url: zeroUrl('/api/store/expenses/import/parse'),
        filePath,
        name: 'file',
        header: token ? { Authorization: `Bearer ${token}` } : {},
        timeout: 60000,
        success(res) {
          try {
            const body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(body as Record<string, unknown>);
            else reject(new Error(zeroErrorMessage(body, `识别失败 ${res.statusCode}`)));
          } catch (e) {
            reject(e instanceof Error ? e : new Error('识别响应解析失败'));
          }
        },
        fail(err) {
          reject(new Error(formatZeroConnectError(err.errMsg || '上传失败')));
        },
      });
    });
    const data = (raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<string, unknown>;
    const items = (Array.isArray(data.items) ? data.items : Array.isArray(raw.items) ? raw.items : []) as ZeroParseItem[];
    return { ok: true, items, message: items.length ? `识别到 ${items.length} 笔` : '未识别到明细，可换更清晰的小票重试' };
  } catch (error) {
    return {
      ok: false,
      items: [],
      message: formatZeroConnectError(error instanceof Error ? error.message : '记账识别失败'),
    };
  }
}

function uploadMenuRecognize(filePath: string, token: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    uni.uploadFile({
      url: zeroUrl('/api/restaurant/dishes/recognize'),
      filePath,
      name: 'file',
      header: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 60000,
      success(res) {
        try {
          const body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body as Record<string, unknown>);
            return;
          }
          reject(new Error(zeroErrorMessage(body, `识别失败 ${res.statusCode}`)));
        } catch (e) {
          reject(e instanceof Error ? e : new Error('菜单响应解析失败'));
        }
      },
      fail(err) {
        reject(new Error(formatZeroConnectError(err.errMsg || '上传失败')));
      },
    });
  });
}

/** 拍菜单：识别菜品列表。 */
export async function zeroRecognizeMenu(filePath: string): Promise<{ ok: boolean; dishes: ZeroParseItem[]; message: string }> {
  try {
    await ensureZeroAuth();
    await ensureRestaurantBusiness();
    const token = uni.getStorageSync(ZERO_TOKEN_KEY) as string;
    let raw: Record<string, unknown>;
    try {
      raw = await uploadMenuRecognize(filePath, token);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      // 业态未切成功时再强制纠正一次并重试
      if (/餐饮业态|仅对餐饮/i.test(msg)) {
        await ensureRestaurantBusiness();
        raw = await uploadMenuRecognize(filePath, token);
      } else {
        throw error;
      }
    }
    const dishes = (Array.isArray(raw.dishes) ? raw.dishes : []) as ZeroParseItem[];
    if (typeof raw.error === 'string' && raw.error) {
      return { ok: false, dishes, message: String(raw.error) };
    }
    return { ok: true, dishes, message: dishes.length ? `识别到 ${dishes.length} 道菜` : '未识别到菜品' };
  } catch (error) {
    const msg = formatZeroConnectError(error instanceof Error ? error.message : '菜单识别失败');
    if (/餐饮业态|仅对餐饮/i.test(msg)) {
      return {
        ok: false,
        dishes: [],
        message: '拍菜单仅支持餐饮业态。已尝试切换演示账号为餐饮，若仍失败请在 Zero 后台把业态改为「餐饮」后再试。',
      };
    }
    return { ok: false, dishes: [], message: msg };
  }
}

function formatZeroConnectError(msg: string) {
  if (/ECONNREFUSED|CONNECTION_REFUSED|connect fail|ERR_CONNECTION/i.test(msg)) {
    return `${msg}\n小Z 经营助手（${zeroApiBase()}）没在跑。请在电脑启动 Zero（端口 8001）后再试。`;
  }
  return msg;
}

/** 促销文案（轻量 copy 接口）。 */
export async function zeroGenerateCopy(goal: string): Promise<ZeroChatResult> {
  if (!ZERO_ENABLED) return { ok: false, reply: '', source: 'fallback' };
  try {
    await ensureZeroAuth();
    const raw = await requestZero<unknown>('/api/copy/generate', 'POST', {
      store_id: 'me',
      platform: 'xhs',
      goal,
      materials: goal,
      count: 2,
      industry: 'retail',
      run_quality: true,
    }, { timeout: 30000 });
    const reply = pickText(raw);
    if (!reply) {
      // 兼容多种返回结构
      const row = raw as Record<string, unknown>;
      const data = (row.data && typeof row.data === 'object' ? row.data : row) as Record<string, unknown>;
      const copies = data.copies || data.results || data.items;
      if (Array.isArray(copies) && copies.length) {
        const text = copies
          .map((c, i) => {
            if (typeof c === 'string') return `${i + 1}. ${c}`;
            const o = c as Record<string, unknown>;
            return `${i + 1}. ${[o.title, o.body, o.text, o.content].filter(Boolean).join('\n')}`;
          })
          .join('\n\n');
        if (text.trim()) return { ok: true, reply: text, source: 'zero' };
      }
      return { ok: false, reply: '', source: 'fallback' };
    }
    return { ok: true, reply, source: 'zero' };
  } catch {
    return { ok: false, reply: '', source: 'fallback' };
  }
}

export function localMorningCopy(input: {
  greeting: string;
  bossName: string;
  redemptions: number;
  pointsIssued: number;
  score: number | null;
  hasData: boolean;
}) {
  const headline = input.hasData
    ? `今日已核销 ${input.redemptions} 笔，发放积分 ${input.pointsIssued}。`
    : '近 30 天经营流水还不多，先从扫码核销和录单发积分开始。';
  const advice =
    input.score != null
      ? `当前健康分 ${input.score}。建议盯紧今日核销与客流高峰，把待用券提醒给常客。`
      : '补齐订单与核销后，小Z 才能给出更准的经营建议。';
  return {
    greet: `${input.greeting}，${input.bossName}`,
    headline,
    advice,
  };
}

export { absoluteAsset as zeroAbsoluteAsset };
