/**
 * 图片上传前的客户端压缩：统一收口，参数页与图片页共用同一份实现。
 * 最长边缩到 maxSide，输出 JPEG，避免大图直接打满 /api/admin/image 的 6MB 限制。
 */
export function compressImage(file, maxSide = 900, quality = 0.86) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('读取文件失败'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('这张图读不出来'));
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          reject(e);
        }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/** 品种图片的绝对路径（管理端挂在 /console/，相对路径会 404） */
export function imageFull(f) {
  return '/img/' + f;
}

/** 缩略图：主图类文件名 001.jpg 有中尺寸缩略图，其余直接用原文件 */
export function imagePreview(f, bust = '') {
  const base = /^\d{3}\.jpg$/.test(f)
    ? '/img/th/' + f.slice(0, 3) + '.jpg'
    : '/img/' + f;
  return bust ? base + '?v=' + bust : base;
}

export const IMAGE_KINDS = [
  { key: 'main', label: '主图' },
  { key: 'obverse', label: '正面' },
  { key: 'reverse', label: '背面' },
  { key: 'set', label: '正反面' }
];
