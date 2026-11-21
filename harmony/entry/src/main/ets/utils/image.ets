/**
 * 图片选择与压缩：统一走系统照片选择器（无需申请相册权限，符合上架最小权限原则），
 * 读出后按最长边缩放再编码成 JPEG base64，控制上传体积。
 */
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { image } from '@kit.ImageKit';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';

export class ImagePicker {
  /** 选 count 张图，返回 data:image/jpeg;base64,... */
  static async pick(count: number, maxEdge: number, quality: number): Promise<string[]> {
    const options = new photoAccessHelper.PhotoSelectOptions();
    options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
    options.maxSelectNumber = count;
    const picker = new photoAccessHelper.PhotoViewPicker();
    const res = await picker.select(options);
    const uris = res.photoUris || [];
    const out: string[] = [];
    for (let i = 0; i < uris.length; i++) {
      const dataUrl = await ImagePicker.toDataUrl(uris[i], maxEdge, quality);
      if (dataUrl !== '') out.push(dataUrl);
    }
    return out;
  }

  static async toDataUrl(uri: string, maxEdge: number, quality: number): Promise<string> {
    let file: fileIo.File | null = null;
    let src: image.ImageSource | null = null;
    let pixel: image.PixelMap | null = null;
    try {
      file = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
      src = image.createImageSource(file.fd);
      const info = await src.getImageInfo();
      const w = info.size.width;
      const h = info.size.height;
      const longEdge = Math.max(w, h);
      let targetW = w;
      let targetH = h;
      if (longEdge > maxEdge) {
        const ratio = maxEdge / longEdge;
        targetW = Math.round(w * ratio);
        targetH = Math.round(h * ratio);
      }
      pixel = await src.createPixelMap({
        desiredSize: { width: targetW, height: targetH }
      });
      const packer = image.createImagePacker();
      const opts: image.PackingOption = { format: 'image/jpeg', quality: quality };
      const buf: ArrayBuffer = await packer.packing(pixel, opts);
      const base64 = new util.Base64Helper().encodeToStringSync(new Uint8Array(buf));
      return 'data:image/jpeg;base64,' + base64;
    } catch (e) {
      return '';
    } finally {
      if (pixel !== null) {
        try {
          pixel.release();
        } catch (e) {
        }
      }
      if (src !== null) {
        try {
          src.release();
        } catch (e) {
        }
      }
      if (file !== null) {
        try {
          fileIo.closeSync(file);
        } catch (e) {
        }
      }
    }
  }
}
