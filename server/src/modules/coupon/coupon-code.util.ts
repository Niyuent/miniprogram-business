import { randomBytes } from 'crypto';

/**
 * 券码生成算法（S2.2）
 *
 * **字符集**：36 个字母数字去掉易混淆的 `0 / O / 1 / I / L`，即
 *
 * ```
 * 23456789ABCDEFGHJKMNPQRSTUVWXYZ   ← 8 个数字 + 23 个字母 = 31
 * ```
 *
 * > docs/02 里写「共 32 个字符」是按 36-4 估的；按「去掉 0/O/1/I/L」这条规则实际是 **31**
 * > （36 − 5）。组合空间 31^11 ≈ 2.5 × 10^16，仍是天文数字，不影响唯一性，故不为了凑 32
 * > 而把 L 放回来（L 与 1 在多数字体里同样易混）。
 *
 * **结构**：11 位随机位 + 1 位校验位 = 12 位。
 *
 * - 校验位：`check = CHARSET[(Σ (idx(c)+1) × (i+1)) mod 31]`，把位置权重也算进去，
 *   因此能拦住「错一位」和大部分「相邻两位写反」的手输错误（核销页手输券码场景）。
 *
 * **校验位与本体的字符集是同一个**（`CHARSET`，31 个字符）：前 11 位与第 12 位都取自它，
 * 所以 12 位里**任何一位都不可能出现 `0 / O / 1 / I / L`**。这不是巧合，而是刻意设计——
 * 校验位本身就是给人手输核对用的，如果它自己是个易混字符，那这道防线等于白设。
 * （S2.3 验收时曾出现「样例码末位是 0」的疑问，实为文档把末位 `M` 误抄成 `0`，代码侧无此问题。）
 */
export const CODE_LENGTH = 12;
export const CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** 拒绝采样阈值：65536 % 31 === 2，故丢弃 [65534, 65535] 两个数 */
const SAMPLE_LIMIT = 65536 - (65536 % CHARSET.length);

/** 取一个 [0, CHARSET.length) 的均匀随机下标（拒绝采样，无取模偏差） */
function randomIndex(): number {
  for (;;) {
    const buf = randomBytes(2);
    const value = (buf[0] << 8) | buf[1];
    if (value < SAMPLE_LIMIT) return value % CHARSET.length;
  }
}

/** 校验位：位置加权求和 mod 31 */
export function checkChar(payload: string): string {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const idx = CHARSET.indexOf(payload[i]);
    if (idx < 0) throw new Error(`非法字符 ${payload[i]}：不在券码字符集内`);
    sum += (idx + 1) * (i + 1);
  }
  return CHARSET[sum % CHARSET.length];
}

/** 生成一个 12 位券码（11 位随机 + 1 位校验） */
export function generateCouponCode(): string {
  let payload = '';
  for (let i = 0; i < CODE_LENGTH - 1; i++) {
    payload += CHARSET[randomIndex()];
  }
  return payload + checkChar(payload);
}

/** 批量生成互不重复的券码（内存去重，数据库层还有唯一索引兜底） */
export function generateCouponCodes(count: number): string[] {
  const set = new Set<string>();
  let guard = 0;
  while (set.size < count) {
    set.add(generateCouponCode());
    // 理论上撞不到；真撞了也别死循环
    if (++guard > count * 100) break;
  }
  return [...set];
}

/** 校验一个券码是否合法（长度 / 字符集 / 校验位）；核销页手输时用于前端先行拦截 */
export function isValidCouponCode(code: string): boolean {
  if (!code || code.length !== CODE_LENGTH) return false;
  const payload = code.slice(0, CODE_LENGTH - 1);
  const check = code.slice(CODE_LENGTH - 1);
  for (const ch of payload) {
    if (!CHARSET.includes(ch)) return false;
  }
  return checkChar(payload) === check;
}
