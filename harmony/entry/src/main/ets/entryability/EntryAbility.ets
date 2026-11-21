import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { Catalog } from '../utils/catalog';
import { Store } from '../utils/store';
import { Privacy } from '../utils/privacy';

const DOMAIN = 0x0000;
const TAG = 'CoinLedger';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    // 应用只有浅色一套设计，跟随 Web / 小程序，不跟随系统深色模式
    this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT);
    hilog.info(DOMAIN, TAG, 'onCreate');
    // 品种目录是内置静态数据，先同步读入，页面首帧即可用（无需等网络）
    Catalog.init(this.context);
    // 隐私同意状态与本地缓存：同步读，首帧即可判断
    Privacy.init(this.context);
    Store.init(this.context);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'loadContent failed: %{public}s', JSON.stringify(err));
        return;
      }
      // 状态栏与页面同色，避免顶部出现一条割裂的白边
      try {
        const win = windowStage.getMainWindowSync();
        win.setWindowBackgroundColor('#F6F4EF');
        win.setWindowSystemBarProperties({
          statusBarColor: '#F6F4EF',
          statusBarContentColor: '#1D1D1F',
          navigationBarColor: '#F6F4EF',
          navigationBarContentColor: '#1D1D1F'
        }).catch((): void => {
        });
      } catch (e) {
        hilog.warn(DOMAIN, TAG, 'set system bar failed');
      }
      hilog.info(DOMAIN, TAG, 'loadContent succeeded');
    });
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, TAG, 'onWindowStageDestroy');
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, 'onDestroy');
  }
}
