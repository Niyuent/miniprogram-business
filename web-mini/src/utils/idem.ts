/** 订单号 / 幂等号生成：带随机位，避免同一毫秒并发碰撞。 */

export function genOrderNo(): string {
  return `SM${Date.now()}${Math.floor(Math.random() * 9000) + 1000}`;
}

export function genRequestId(): string {
  return `r${Date.now()}${Math.floor(Math.random() * 9000) + 1000}`.slice(0, 32);
}
