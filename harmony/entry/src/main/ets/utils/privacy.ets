/**
 * 隐私政策同意状态（HarmonyOS 应用市场上架要求）。
 * 未同意前：不发起任何网络请求、不写业务缓存、不读取账号信息。
 */
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { Keys } from './config';

export class Privacy {
  static agreed: boolean = false;
  private static pref: preferences.Preferences | null = null;

  static init(context: common.Context): void {
    if (Privacy.pref) return;
    const opt: preferences.Options = { name: Keys.STORE };
    Privacy.pref = preferences.getPreferencesSync(context, opt);
    Privacy.agreed = !!Privacy.pref.getSync(Keys.PRIVACY, false);
  }

  static agree(): void {
    Privacy.agreed = true;
    if (Privacy.pref) {
      Privacy.pref.putSync(Keys.PRIVACY, true);
      Privacy.pref.flushSync();
    }
  }

  static revoke(): void {
    Privacy.agreed = false;
    if (Privacy.pref) {
      Privacy.pref.putSync(Keys.PRIVACY, false);
      Privacy.pref.flushSync();
    }
  }
}
