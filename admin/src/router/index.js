import { createRouter, createWebHistory } from 'vue-router';
import AdminLayout from '../layouts/AdminLayout.vue';

/** 侧栏菜单：分组 + 路由 + 标题（面包屑/文档标题共用） */
export const MENU = [
  {
    group: '运营',
    items: [
      { path: '/users', title: '用户管理', icon: 'User' },
      { path: '/feedback', title: '反馈处理', icon: 'ChatDotSquare' },
      { path: '/visitors', title: '访客分析', icon: 'DataAnalysis' }
    ]
  },
  {
    group: '内容',
    items: [
      { path: '/params', title: '品种参数', icon: 'EditPen' },
      { path: '/images', title: '图片管理', icon: 'Picture' },
      { path: '/series', title: '系列管理', icon: 'Collection' }
    ]
  },
  {
    group: '系统',
    items: [
      { path: '/audit', title: '操作审计', icon: 'Document' },
      { path: '/guard', title: '封禁管理', icon: 'Lock' }
    ]
  }
];

const routes = [
  {
    path: '/',
    component: AdminLayout,
    redirect: '/users',
    children: [
      { path: 'users', name: 'users', component: () => import('../pages/Users.vue'), meta: { title: '用户管理' } },
      { path: 'feedback', name: 'feedback', component: () => import('../pages/Feedback.vue'), meta: { title: '反馈处理' } },
      { path: 'visitors', name: 'visitors', component: () => import('../pages/Visitors.vue'), meta: { title: '访客分析' } },
      { path: 'params', name: 'params', component: () => import('../pages/Params.vue'), meta: { title: '品种参数' } },
      { path: 'images', name: 'images', component: () => import('../pages/Images.vue'), meta: { title: '图片管理' } },
      { path: 'series', name: 'series', component: () => import('../pages/Series.vue'), meta: { title: '系列管理' } },
      { path: 'audit', name: 'audit', component: () => import('../pages/Audit.vue'), meta: { title: '操作审计' } },
      { path: 'guard', name: 'guard', component: () => import('../pages/Guard.vue'), meta: { title: '封禁管理' } }
    ]
  },
  { path: '/:pathMatch(.*)*', name: 'notfound', component: () => import('../pages/NotFound.vue') }
];

const router = createRouter({
  history: createWebHistory('/console/'),
  routes,
  scrollBehavior: () => ({ top: 0 })
});

router.afterEach((to) => {
  const t = to.meta && to.meta.title;
  document.title = t ? t + ' · 藏币录管理控制台' : '藏币录 · 管理控制台';
});

export default router;
