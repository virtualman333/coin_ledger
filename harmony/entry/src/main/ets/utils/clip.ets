/** 剪贴板：分享入口在鸿蒙上先落为「复制链接」 */
import { pasteboard } from '@kit.BasicServicesKit';
import { promptAction } from '@kit.ArkUI';

export class Clip {
  static async copy(text: string, tip: string = '已复制'): Promise<void> {
    try {
      const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
      await pasteboard.getSystemPasteboard().setData(data);
      promptAction.showToast({ message: tip, duration: 1600 });
    } catch (e) {
      promptAction.showToast({ message: '复制失败，请长按选择链接', duration: 1800 });
    }
  }
}
