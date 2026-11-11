/**
 * 开发构建（`uni -p mp-weixin`）为 true；发布构建（`uni build -p mp-weixin`）为 false。
 *
 * 用途：把调试入口（接口切换、商家测试账号、演示密码）从发布产物中彻底去掉——
 * 发布构建时 Vite 将 import.meta.env.DEV 替换为 false，压缩器会删除 IS_DEV 为假的分支。
 */
export const IS_DEV = import.meta.env.DEV;
