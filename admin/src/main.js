import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import App from './App.vue';
import router from './router';
import './styles/theme.css';

const app = createApp(App);

Object.entries(ElementPlusIconsVue).forEach(([name, component]) => {
  app.component(name, component);
});

app.use(router).use(ElementPlus, { locale: zhCn }).mount('#app');
