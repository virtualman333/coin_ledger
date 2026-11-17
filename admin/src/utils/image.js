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

/**
 * 生成方形缩略图：先按内容边界裁掉白边，再等比缩放留 4% 余量。
 * 上传主图时自动生成 480 / 160 两种规格，随上传请求一起交给服务端落盘。
 */
export function makeThumbnail(file, size, quality = 0.86) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('读取文件失败'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('这张图读不出来'));
      img.onload = () => {
        try {
          const src = document.createElement('canvas');
          src.width = img.width;
          src.height = img.height;
          const sctx = src.getContext('2d', { willReadFrequently: true });
          sctx.drawImage(img, 0, 0);

          // 找非白像素边界（白底商品图/官方图都适用）
          let x0 = img.width, y0 = img.height, x1 = 0, y1 = 0;
          try {
            const px = sctx.getImageData(0, 0, img.width, img.height).data;
            for (let y = 0; y < img.height; y += 1) {
              for (let x = 0; x < img.width; x += 1) {
                const i = (y * img.width + x) * 4;
                if (px[i] < 238 || px[i + 1] < 238 || px[i + 2] < 238) {
                  if (x < x0) x0 = x;
                  if (x > x1) x1 = x;
                  if (y < y0) y0 = y;
                  if (y > y1) y1 = y;
                }
              }
            }
          } catch (e) { /* 读不到像素时退化为整图 */ }
          if (x1 <= x0 || y1 <= y0) { x0 = 0; y0 = 0; x1 = img.width - 1; y1 = img.height - 1; }
          const cw = x1 - x0 + 1;
          const ch = y1 - y0 + 1;

          const out = document.createElement('canvas');
          out.width = size;
          out.height = size;
          const ctx = out.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, size, size);
          const scale = Math.min(size / cw, size / ch) * 0.96;
          const w = Math.max(1, Math.round(cw * scale));
          const h = Math.max(1, Math.round(ch * scale));
          ctx.drawImage(src, x0, y0, cw, ch, (size - w) / 2, (size - h) / 2, w, h);
          resolve(out.toDataURL('image/jpeg', quality));
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
