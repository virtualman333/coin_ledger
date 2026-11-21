/**
 * 占位组件。
 *
 * TabBar 已经搬到 pages/shell 的常驻组件 components/tabbar 里 ——
 * 只有那样它才不会随页面切换被销毁重建，滑动才连得上。
 * 但 app.json 开了 custom:true 时微信仍要求这个目录存在，所以留空。
 */
Component({});
