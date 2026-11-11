# 商盟小程序

会员端和商家端都在这个目录里，技术栈是 uni-app（Vue 3 + Vite + TypeScript + Pinia）。

## 安装依赖

在 `web-mini` 目录执行：

```bash
npm install
```

## 本地运行 H5

```bash
npm run dev:h5 -- --port 5175
```

浏览器打开 `http://localhost:5175/`。H5 没有微信登录，验收时把 C 端或商家 JWT 写入 `localStorage` 的 `mini_token`，并写入 `mini_role`（`member` 或 `merchant`）。

## 微信开发者工具

先打包：

```bash
npm run build:mp-weixin
```

用微信开发者工具导入目录：

`web-mini/dist/build/mp-weixin`

边改边看时用 `npm run dev:mp-weixin`，导入 `web-mini/dist/dev/mp-weixin`。本机调试请在开发者工具里勾选「不校验合法域名」。`manifest.json` 里的 `appid` 目前为空，导入前填上你的小程序 AppID。

商家端页面在分包 `pages/merchant`，主包只保留登录、会员页和入驻落地页。

## 修改后端 API 地址

打开 `src/utils/request.ts`，修改 `API_BASE_URL`。默认是：

```ts
export const API_BASE_URL = 'http://127.0.0.1/api/v1';
```

入驻申请页地址由这个网关域名推导：去掉末尾的 `/api/v1`，再加上 `/apply`。例如默认会打开 `http://127.0.0.1/apply?invite=邀请码`。

订阅消息模板 ID 在 `src/config.ts`。到微信公众平台申请「核销结果」「积分兑换 / 券到期」两类模板后，把 ID 填进 `TMPL_MERCHANT_REDEEM` 和 `TMPL_MEMBER_EXCHANGE`。留空时仍会弹出授权引导，但不会向微信发送空模板。
