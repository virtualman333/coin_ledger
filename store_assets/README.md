# 华为应用市场 · 上架素材

生成时间：2026-11-22 · 应用：藏币录（top.virtualman.coin）

## 一、应用介绍截图（必填）

目录：`screenshots/`，5 张，1080 × 1920 PNG（sRGB，单张 250–590 KB）

| 文件 | 对应页面 | 标题文案 | 副标题 |
|---|---|---|---|
| 01.png | 首页 | 137 个品种，一屏看懂家底 | 账本自动算市值，发行计划不错过 |
| 02.png | 发行计划 | 央行公告同步的发行计划 | 待发行、预约时间、增发一目了然 |
| 03.png | 全套清单 | 按年份 · 系列 · 面额查 | 发行量、图案说明、推理价都在一页 |
| 04.png | 品种详情 | 每枚币的完整档案 | 参数、正反面图案、AI 参考价 |
| 05.png | 我的 | 登录即同步 | 换手机、用网页版都能接着记 |

上传位置：AGC → 应用信息 → 素材 → 应用介绍截图

- 数量要求 3–10 张，**第一张作为列表页主图**，建议按 01 → 05 顺序
- 版式：品牌渐变底 + 手机框 + 卖点文案，已按 9:16 排版，可直接上传

## 二、应用视频（可选）

文件：`video/promo.mp4`

| 项 | 值 |
|---|---|
| 容器 / 编码 | MP4 / H.264 (High) |
| 分辨率 | 1080 × 1920 |
| 像素格式 | yuv420p |
| 帧率 | 30 fps |
| 时长 | 13 秒 |
| 大小 | 1.9 MB |
| 内容 | 5 张介绍截图交叉淡化（0.5s 过渡，每张停留 3s） |

上传位置：AGC → 应用信息 → 素材 → 应用视频（时长需 ≤ 30s，本片 13s 符合）

## 三、重新生成

```bash
# 1. 采集真机/模拟器截图到 raw/（1276×2848 或等比）
# 2. 合成介绍图（需系统 Python 3.12 + Pillow + 微软雅黑）
"C:\Program Files\Python312\python.exe" store_assets/build_shots.py
# 3. 生成帧序列并编码视频
"C:\Program Files\Python312\python.exe" store_assets/make_frames.py
node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe -y -framerate 30 \
  -i store_assets/video/frames/f_%04d.png -c:v libx264 -preset medium -crf 20 \
  -pix_fmt yuv420p -movflags +faststart store_assets/video/promo.mp4
```

## 四、注意

1. 截图取自模拟器真实界面，**页面数据为测试账号状态**（我的页仅 1 个品种）。
   若希望展示更饱满的账本，可登录真实账号后重拍 `raw/05_mine.jpeg` 再跑合成脚本。
2. 截图保留了系统状态栏（时间/电量），符合应用市场「真实运行界面」要求，未做虚假状态修改。
3. 文案中的「AI 参考价」「推理价」与 App 内实际叫法一致，未夸大功能。
