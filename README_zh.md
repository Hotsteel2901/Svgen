# SVGen Studio — SVG 绘图与动画制作工具

> [English](README.md) · **中文**

一个前后端分离的 **SVG 绘图 + 动画制作** 工作室：浏览器里直观地画图、打关键帧做动画，一键导出
为 `PNG / JPG / BMP / WebP / GIF / MP4 / WebM`。后端可独立使用（自带 CLI），核心运算由
**Rust 原生引擎**承担，Python 负责调度与解析，前端零依赖、纯 HTML/CSS/JS。

---

## 目录

- [功能特性](#功能特性)
- [环境要求](#环境要求)
- [快速开始（怎么使用）](#快速开始怎么使用)
  - [方式一：启动完整工作室（推荐）](#方式一启动完整工作室推荐)
  - [方式二：命令行单独使用后端](#方式二命令行单独使用后端)
  - [方式三：HTTP API](#方式三http-api)
- [前端使用说明](#前端使用说明)
  - [绘图工具](#绘图工具)
  - [动画（关键帧时间轴）](#动画关键帧时间轴)
  - [图层管理](#图层管理)
  - [导出](#导出)
- [后端 CLI 详解](#后端-cli-详解)
- [HTTP API 详解](#http-api-详解)
- [架构与分工](#架构与分工)
- [性能基准](#性能基准)
- [动画转视频的原理](#动画转视频的原理)
- [常见问题 FAQ](#常见问题-faq)
- [许可](#许可)

---

## 功能特性

- **完整绘图工具**：选择/移动、自由笔、平滑路径、文字、矩形、圆角矩形、椭圆、直线、箭头、多边形、星形
- **动画编辑**：底部时间轴、关键帧（X / Y / 旋转 / 缩放 / 透明度）、播放/循环、洋葱皮、逐帧拖动
- **图层系统**：排序、重命名、复制、删除、显隐、锁定
- **多种导出格式**：SVG / PNG / JPG / BMP / WebP / GIF / MP4 / WebM
- **多渲染引擎**：Rust（原生，最快）→ Chrome/Edge/Firefox（真实字体、CJK 中文，最高保真）→ 纯 Python（零依赖兜底）
- **Firefox / Gecko 兼容**：前端基于标准 API（Canvas2D、Pointer Events、fetch），任何现代浏览器均可使用；后端 headless 渲染自动识别并支持 Firefox，导出中文时请选浏览器引擎（Gecko 无法输出透明背景 PNG，透明导出会自动回退 Rust）
- **系统自适应**：自动识别 Windows / Linux / macOS 及架构，选择对应文件系统与临时目录
- **日志可开关**：`svgen logs on|off` 持久化，服务器运行中可 `POST /api/logs` 实时切换
- **后端可独立使用**：完整 CLI + HTTP API，不依赖前端

---

## 环境要求

| 组件 | 要求 | 说明 |
|---|---|---|
| Python | 3.9+ | 核心功能无需任何第三方库 |
| Rust (cargo) | 可选 | 仅用于编译原生引擎（`python svgen.py build-rs`）；不装则自动回退纯 Python |
| ffmpeg | 可选 | 仅 `mp4` / `webm` 导出需要；`gif` 为纯 Rust/Python 实现 |
| Chrome / Edge / Firefox | 可选 | 存在时自动用于最高保真渲染（真实字体、中文）；都没有则用 Rust 引擎 |
| Pillow | 可选 | 仅 `jpg` / `webp` 静态图需要 |

运行 `python svgen.py info` 可查看本机各项能力是否就绪。

---

## 快速开始（怎么使用）

### 方式一：启动完整工作室（推荐）

```bash
cd backend
python svgen.py serve --open
```

浏览器自动打开 `http://127.0.0.1:8090`，直接开始画图、做动画、导出。

### 方式二：命令行单独使用后端

```bash
# 查看系统架构与引擎能力
python svgen.py info

# 校验 SVG 并查看动画时间轴
python svgen.py validate art.svg

# 渲染静态图
python svgen.py render art.svg -f png -o out.png
python svgen.py render art.svg -f jpg --width 1920 --height 1080 -o out.jpg

# 渲染动画视频（动画 SVG 自动逐帧烘焙）
python svgen.py render art.svg -f mp4 --duration 2 --fps 30 -o out.mp4
python svgen.py render art.svg -f gif --duration 2 --fps 12 -o out.gif

# 从标准输入读取
cat art.svg | python svgen.py render - -f webp -o out.webp

# 指定渲染引擎（auto 自动选择；也可强制 rust / chrome / firefox / raster）
python svgen.py render art.svg -f png --engine rust -o out.png
python svgen.py render art.svg -f png --engine firefox -o out.png   # 用 Firefox/Gecko 渲染（真实中文）

# 编译原生 Rust 引擎
python svgen.py build-rs

# 开关日志
python svgen.py logs on
python svgen.py logs off
```

### 方式三：HTTP API

```bash
curl -X POST http://127.0.0.1:8090/api/export \
  -H 'Content-Type: application/json' \
  -d '{"svg":"<svg xmlns=...>...</svg>","format":"png","width":800,"height":600,"name":"art"}' \
  -o art.png
```

---

## 前端使用说明

### 绘图工具

左侧工具栏选择工具后在画布上拖拽即可：

| 工具 | 快捷键 | 说明 |
|---|---|---|
| 选择 / 移动 | `V` | 点选形状，拖动移动，拖角点缩放，拖顶部圆点旋转 |
| 自由笔 | `P` | 鼠标拖动画曲线 |
| 平滑路径 | `B` | 自由曲线路径 |
| 文字 | `T` | 点击放置文字，右侧面板修改内容 |
| 矩形 / 圆角矩形 | `R` | 拖拽绘制，`Shift` 锁定正方形 |
| 椭圆 | `O` | `Shift` 锁定正圆 |
| 直线 / 箭头 | `L` / `A` | `Shift` 吸附 45° |
| 多边形 | `G` | 右侧面板可调边数 |
| 星形 | `S` | 右侧面板可调角数 |

顶栏还有：网格开关、缩放/适应、撤销重做（`Ctrl+Z` / `Ctrl+Y`）、导入 SVG、保存/打开工程（`.svgen.json`）。

### 动画（关键帧时间轴）

1. 选中画布上的一个形状
2. 在时间轴上方选择要动画的属性（X / Y / Rot / Scale / Opacity）
3. 把播放头拖到某个时间点，点击 **“◆ Add key”**（或按 `K`）打上关键帧
4. 移动形状 / 改属性，到下一个时间点再打一帧 —— 自动生成补间动画
5. 点 ▶ 播放，🔁 循环，`Onion` 洋葱皮查看前后帧

关键帧彩色菱形可直接拖动换时间、双击删除；`⏮/⏭` 跳到上一个/下一个关键帧。播放时长与 FPS 可在时间轴右上角设置。

### 图层管理

右侧 **Layers** 标签页：点选图层、眼睛按钮显隐、锁按钮锁定、双击重命名、▲▼ 调整层级（越上层越靠前）、⧉ 复制、🗑 删除。

### 导出

右侧 **Export** 标签页：

1. 设置画布宽高、背景色
2. 选择格式（SVG / PNG / JPG / BMP / WebP / GIF / MP4 / WebM）
3. 视频类选择时长与 FPS
4. 选择渲染引擎（Auto / Chrome / Firefox / Rust / Python）
5. 点击 **Export & Download**，文件自动下载；也可单独复制/下载 SVG

面板顶部会实时显示后端能力（Rust / 浏览器 / ffmpeg / Pillow 是否就绪）。
**Firefox 用户**：界面与导出面板完全兼容；需要真实中文字体导出时选 “Browser (Firefox/Gecko)”。

---

## 后端 CLI 详解

```
svgen info                     查看系统信息与引擎能力
svgen validate <file.svg>      校验 SVG 并打印动画时间轴
svgen render <file.svg>        渲染，输入 - 表示 stdin
    -f, --format    png|jpg|bmp|webp|gif|mp4|webm
    --width/--height            输出尺寸
    --duration/--fps            视频时长(秒)/帧率
    --background                背景色(hex)
    --engine        auto|chrome|rust|raster
    --quality                   JPEG/MP4 质量
    -o, --output                输出文件
svgen serve [--port] [--host] [--static] [--open] [--logs on|off]
svgen logs on|off               持久化日志开关（~/.svgen/config.json）
svgen build-rs [--debug]        编译原生 Rust 引擎
    --quiet / --verbose          本次调用的日志级别
```

---

## HTTP API 详解

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 心跳与版本 |
| GET | `/api/info` | 系统信息 + 引擎能力 |
| GET/POST | `/api/logs` | 读取 / 切换后端日志 |
| POST | `/api/validate` | 校验 SVG + 返回动画时间轴 |
| POST | `/api/export` | 渲染任意格式并返回文件 |
| GET | `/` | 前端工作室页面 |

`POST /api/export` 请求体：

```json
{
  "svg": "<svg ...>...</svg>",
  "format": "mp4",
  "width": 1280,
  "height": 720,
  "duration": 2,
  "fps": 30,
  "background": "#ffffff",
  "engine": "auto",
  "quality": 28,
  "name": "artwork"
}
```

---

## 架构与分工

```
[浏览器]  JS 建模(形状+关键帧) ──生成 SVG(SMIL)──▶ [Python] animate.py 逐帧烘焙
   │                                                      │
   │  前端：HTML/CSS 界面 · JS 交互/模型/时间轴           ▼
   │                                                      [Python] rsops.py 几何→二进制绘制命令
   │                                                      │
   │                                                      ▼
   │                                              [Rust] svgen_rs 栅格化 → RGBA
   │                                                      │
   │                                                      ▼
   │                                        [Python] images.py / ffmpeg → PNG/JPG/GIF/MP4/WebM
   ▼
用户下载成品
```

| 部分 | 语言 | 负责内容 |
|---|---|---|
| 界面 | HTML / CSS | 页面结构、现代深色 UI、布局与过渡 |
| 前端逻辑 | JS | 场景数据模型、关键帧插值、SVG+SMIL 序列化、Canvas 绘制、绘图工具、时间轴、导出面板、后端 API 客户端 |
| 像素运算 | **Rust** | 扫描线多边形填充、渐变逐像素采样、alpha 混合、超采样降采样、GIF 编码（中值切割 + LZW）——性能核心 |
| 编排调度 | Python | 系统/架构检测、SMIL 动画烘焙、几何→二进制命令流、引擎选择、图像/视频编码封装、HTTP API、CLI、日志 |

几何构建（约 13ms/帧）与 SMIL 烘焙（约 5ms/帧）经实测几乎无开销，故保留在 Python；真正的热循环全部在 Rust。

---

## 性能基准

同一台机器（Windows 11 / AMD64）实测：

| 负载 | 纯 Python | Rust 引擎 | 加速比 |
|---|---|---|---|
| 静态 PNG 800×600（渐变 + 30 圆 + 路径） | 3.94 s | 0.047 s | **83×** |
| 视频 24 帧 @ 640×360 | 54.91 s | 0.752 s | **73×** |
| 动画 GIF 320×240 × 12 帧 | >420 s（无法完成） | 0.023 s | **>18 000×** |

> 注：Python 版 GIF 编码器存在二次方归并问题，小图都无法完成，已由 Rust 重写为主路径（Python 仅作兜底）。

---

## 动画转视频的原理

1. 前端把形状 + 关键帧序列化为带 SMIL（`<animate>` / `<animateTransform>`）的 SVG
2. 后端 `animate.py` **逐帧烘焙**：对每个时间点采样动画、把插值结果写回目标元素、移除 `<animate>` 节点，得到一帧静态 SVG
3. 帧交给 Rust（或浏览器 / 纯 Python）栅格化
4. 逐帧送入 ffmpeg 生成 `mp4` / `webm`，或用内置编码器生成 `gif`

---

## 常见问题 FAQ

**Q：不装 Rust 能用吗？**
可以。`svgen info` 会显示 Rust 是否就绪；没有编译好的引擎时自动回退纯 Python 栅格器与 Python GIF 编码，功能完整，只是慢。

**Q：Rust 引擎找不到 / 报错？**
```bash
python svgen.py build-rs     # 需要 cargo
```
或在 `backend/rust/svgen_rs` 下执行 `cargo build --release`，编译产物位于 `target/release/`。

**Q：MP4 导出报错？**
需要 ffmpeg 在 PATH 中（`svgen info` 可检测）。缺 ffmpeg 时可改用 GIF/WebP。

**Q：中文文字导出不显示？**
纯 Rust/Python 栅格使用内置 5×7 点阵字体（仅 ASCII）；需要真实中文字体时把渲染引擎选为
**Firefox / Chrome**（浏览器引擎）即可。

**Q：我是 Firefox 重度用户，能正常使用吗？**
能。前端界面用标准 API（Canvas2D、Pointer Events），与内核无关；后端会自动识别本机 Firefox
并用它做最高保真渲染（含中文）。`svgen info` 可查看是否检测到 Firefox。
注意 Gecko 的 headless 截图不支持透明背景，透明导出时会自动回退到 Rust 引擎。

**Q：前端连不上后端？**
确认 `python svgen.py serve` 正在运行、端口未占用；导出面板会显示 “Backend offline”。

---

## 许可

MIT License。详见仓库 License 声明（可自行补充）。
