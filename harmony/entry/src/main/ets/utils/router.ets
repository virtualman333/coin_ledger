/** 页面路由：名称常量、参数对象与栈操作封装 */

export class Routes {
  static readonly DETAIL: string = 'detail';
  static readonly PM_DETAIL: string = 'pmDetail';
  static readonly ACCOUNT: string = 'account';
  static readonly PROFILE: string = 'profile';
  static readonly HOLDINGS: string = 'holdings';
  static readonly SERIES: string = 'series';
  static readonly SERIES_DETAIL: string = 'seriesDetail';
  static readonly COLSHARE: string = 'colshare';
  static readonly COUNT: string = 'count';
  static readonly BACKUP: string = 'backup';
  static readonly FEEDBACK: string = 'feedback';
  static readonly MY_FEEDBACK: string = 'myFeedback';
  static readonly ABOUT: string = 'about';
  static readonly PRIVACY: string = 'privacy';
  static readonly MORE: string = 'more';
  static readonly MORE_TOOLS: string = 'moreTools';
  static readonly ADMIN: string = 'admin';
  static readonly ADMIN_USERS: string = 'adminUsers';
  static readonly ADMIN_USER: string = 'adminUser';
  static readonly ADMIN_COINS: string = 'adminCoins';
  static readonly ADMIN_PLAN: string = 'adminPlan';
  static readonly ADMIN_PM: string = 'adminPm';
  static readonly ADMIN_SCAN: string = 'adminScan';
  static readonly ADMIN_SERIES: string = 'adminSeries';
  static readonly ADMIN_IMAGES: string = 'adminImages';
  static readonly ADMIN_FEEDBACK: string = 'adminFeedback';
  static readonly ADMIN_VISITORS: string = 'adminVisitors';
  static readonly ADMIN_CATS: string = 'adminCats';
}

/** 页面参数（一个对象覆盖所有页面，避免 any） */
export class RouteParam {
  id: number = 0;
  code: string = '';
  name: string = '';
  /** coin / note / pm */
  cat: string = '';
  tab: number = 0;
  /** 附加模式：edit / new / detail … */
  mode: string = '';
  key: string = '';

  static of(id: number): RouteParam {
    const p = new RouteParam();
    p.id = id;
    return p;
  }
}

export class Nav {
  static push(stack: NavPathStack, name: string, param: RouteParam): void {
    stack.pushPathByName(name, param);
  }

  static take(stack: NavPathStack, name: string): RouteParam {
    const arr: Object[] = stack.getParamByName(name) as Object[];
    if (arr.length === 0) return new RouteParam();
    return arr[arr.length - 1] as RouteParam;
  }

  /** 替换当前页：从同系列跳到另一枚时用，避免详情页越叠越深 */
  static replace(stack: NavPathStack, name: string, param: RouteParam): void {
    stack.replacePathByName(name, param);
  }

  static pop(stack: NavPathStack): void {
    stack.pop();
  }
}
