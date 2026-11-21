import { common } from '@kit.AbilityKit';
import { promptAction } from '@kit.ArkUI';

export class Links {
  /** 打开外部链接（浏览器）。失败给一句提示，避免点了没反应 */
  static open(context: common.UIAbilityContext, url: string): void {
    context.openLink(url).catch((): void => {
      promptAction.showToast({ message: '暂时无法打开链接', duration: 1800 });
    });
  }
}
