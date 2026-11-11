export function readSticky<T>(key: string): T | null {
  try {
    const raw = uni.getStorageSync(key);
    if (!raw) return null;
    if (typeof raw === 'string') return JSON.parse(raw) as T;
    return raw as T;
  } catch {
    return null;
  }
}

export function writeSticky(key: string, value: unknown) {
  uni.setStorageSync(key, JSON.stringify(value));
}

export function dropSticky(key: string) {
  uni.removeStorageSync(key);
}
