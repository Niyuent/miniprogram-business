import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
// H5 移动端组件库（积分兑换 / 积分明细等页面使用 van-* 组件）
import Vant from 'vant';
import 'vant/lib/index.css';
import App from './App.vue';
import router from './router';
import { permission } from './directives/permission';
import './styles/index.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(ElementPlus, { locale: zhCn });
app.use(Vant);
app.directive('permission', permission);

app.mount('#app');
