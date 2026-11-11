import { createSSRApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { installRouteGuard } from './utils/guard';
import { watchNetwork } from './utils/network';

export function createApp() {
  const app = createSSRApp(App);
  app.use(createPinia());
  installRouteGuard();
  watchNetwork();
  return { app };
}
