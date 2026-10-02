# SVGen Studio — SVG 绘图与动画工作室

> **中文** · [English](README.md)

一个完整的 SVG 插画 / 动画工作室：**纯 Python 后端 + 原生 Rust 光栅引擎 + 完全重写的模块化前端**。

画出矢量图形，在关键帧时间轴上做动画，然后导出 **PNG / JPG / BMP / WebP / GIF / MP4 / WebM / SVG**。

```
┌─────────────── 前端（零依赖 ES 模块）───────────────┐
│  Canvas 编辑  ·  关键帧时间轴  ·  图层面板  ·  导出   │
└───────────────────────┬───────────────────────────┘
                        │  HTTP /api（同步静帧 + 异步任务 + SSE 进度）
┌───────────────────────┴───────────────────────────┐
│  Python 编排：SVG 解析 · SMIL 烘焙 · 几何 · 编码     │
└───────────────────────┬───────────────────────────┘
                        │  紧凑二进制绘制指令流（C ABI）
┌───────────────────────┴───────────────────────────┐
│  Rust 光栅核心：扫描线填充 · 渐变 · 混合 · GIF 编码   │
└───────────────────────────────────────────────────┘
```

---

## 快速开始

```bash
cd backend
python svgen.py serve --open      # 打开 http://localhost:8090
```

后端也可以完全独立使用：

```bash
python svgen.py info                             # 平台与工具探测
python svgen.py engines                          # 渲染链路与可用格式
python svgen.py validate art.svg                 # 校验 + 动画时间轴
python svgen.py render art.svg -f png -o out.png
python svgen.py render art.svg -f mp4 --duration 2 --fps 30 -o out.mp4
python svgen.py render art.svg -f gif --width 640 --height 360 -o out.gif
cat art.svg | python svgen.py render - -f webp -o out.webp
python svgen.py build-rs                         # 编译原生 Rust 引擎（需要 cargo）
```

## 环境要求

| 组件 | 是否必需 | 说明 |
| --- | --- | --- |
| **Python 3.9+** | 必需 | 核心渲染零第三方依赖 |
| **cargo** | 可选 | 一次性编译原生引擎；缺失时自动回退 |
| **ffmpeg** | 可选 | 仅 `mp4` / `webm` 需要（`gif` 不需要） |
| **Chrome / Edge / Firefox** | 可选 | 最高保真渲染（真实字体、CJK 文本、完整 SVG） |
| **Pillow** | 可选 | `jpg` / `webp` 静帧与测试断言 |

`python svgen.py info` 会报告本机实际可用的一切。

---

## 前端（全新架构）

完全重写：ES 模块、无框架、无构建步骤、无第三方依赖。原来的 8 个全局脚本变成 33 个职责明确的模块。

```
frontend/
├── index.html
├── css/
│   ├── tokens.css        设计令牌：颜色 / 字体 / 间距 / 动效 / 明暗主题
│   ├── base.css          重置、排版、焦点环、滚动条、无障碍
│   ├── components.css    按钮、输入、滑杆、色板、菜单、弹窗、提示
│   ├── layout.css        应用外壳栅格：顶栏 / 工具栏 / 画布 / 侧栏 / 时间轴
│   ├── panels.css        属性、图层、导出、关于面板
│   └── timeline.css      走带、标尺、轨道、关键帧
└── js/
    ├── main.js           入口：装配外壳、按键映射
    ├── core/             —— 与界面无关的引擎
    │   ├── scene.js        文档模型、选择、变更与快照
    │   ├── history.js      撤销 / 重做（快照式，可合并连续编辑）
    │   ├── elements.js     图元定义、几何、边界、命中测试、SVG 路径
    │   ├── anim.js         关键帧、缓动（含三次贝塞尔求解）、采样
    │   ├── transform.js    2D 仿射变换工具
    │   ├── render.js       Canvas 渲染器（棋盘格、洋葱皮、选择手柄）
    │   ├── svg-export.js   场景 → SVG（SMIL，按后端契约采样）
    │   ├── svg-import.js   SVG → 场景（变换、样式、`<use>`）
    │   ├── svg-path.js     路径解析（M/L/H/V/C/S/Q/T/A/Z，弧线展开）
    │   ├── color.js        颜色解析与转换
    │   ├── util.js         通用工具
    │   └── emitter.js      微型事件器
    ├── ui/               —— 面板与外壳
    │   ├── app.js          应用对象：文档、历史、播放、文件、后端
    │   ├── stage.js        视口、缩放、平移、渲染循环
    │   ├── dock.js         右侧面板容器
    │   ├── inspector.js    属性 / 变换 / 外观 / 文本 / 动画 / 对齐
    │   ├── layers.js       图层列表（拖拽排序、显隐、锁定、重命名）
    │   ├── exportpane.js   导出（格式、引擎、进度、取消）
    │   ├── infopane.js     关于、后端状态、字体声明、快捷键
    │   ├── timeline.js     时间轴（走带、属性轨、关键帧、播放头）
    │   ├── rail.js         左侧工具栏与取色
    │   ├── topbar.js       顶栏
    │   ├── controls.js     可复用控件（数值拖动、滑杆、色板…）
    │   ├── icons.js        内联 SVG 图标集（24×24，无 emoji）
    │   └── shell.js        提示、弹窗、菜单、工具提示、主题
    ├── tools/index.js    交互：选择、变换、绘制、曲线、取色
    ├── net/api.js        后端客户端（任务队列 + SSE + 断线重连）
    └── i18n/index.js     中英双语（默认中文）
```

### 设计语言

- **单一强调色**：青柠 `#cbff4d`，只用于状态与主动作
- **中性石墨底**：图形才是主角，界面退到后面
- **自绘线性图标**：24×24 描边图标，零 emoji、零图标字体
- **发丝级分隔线**替代重阴影，仅浮层使用投影
- **动效克制**：90–240ms，`prefers-reduced-motion` 下全部关闭
- **明暗双主题**，令牌驱动，一键切换
- 完整的 `:focus-visible` 焦点环与键盘可达性

### 功能

**绘制** — 选择 / 平移 / 取色、自由手绘、曲线（逐点点击）、文字、矩形、圆角矩形、
椭圆、直线、箭头、多边形、星形；`Shift` 等比约束、`Alt` 从中心绘制、网格吸附。

**编辑** — 多选、框选、拖拽排序、复制粘贴、再制、对齐（6 向）、翻转、
层级调整、撤销 / 重做（连续编辑自动合并）、方向键微调。

**变换手柄** — 8 个缩放手柄 + 旋转手柄；**旋转过的图形缩放时锚点保持不动**
（手柄数学在图形自身的未旋转、未缩放空间里做）。

**图层** — 拖拽重排、显隐、锁定、双击重命名、关键帧计数、右键菜单。

**时间轴** — 走带、标尺（帧 / 秒刻度）、可折叠的属性子轨、
颜色区分的关键帧菱形、拖动改时间、右键改缓动 / 删除、
播放头拖动、洋葱皮、循环、吸附到帧。

**发布** — `SVG / PNG / JPG / WebP / BMP / GIF / MP4 / WebM`，
画布尺寸与预设、背景色或透明、时长 / 帧率 / 质量、渲染引擎选择、
本机能力实时回显、**实时进度 + 取消**（视频渲染走任务队列）。

**输入接管** — 工作室自己捕获鼠标与键盘，浏览器不会抢走操作：
画布 / 图层 / 时间轴 / 输入框各有**自己的右键菜单**（删除、复制、粘贴、层级、对齐…），
`Ctrl+P` `Ctrl+F` `Ctrl+S` `F3` 等浏览器快捷键被接管，
`Ctrl+滚轮` 归画布缩放、中键归平移、拖放文件归导入。

**画笔画布** — 画笔面板调粗细 / 不透明度 / 平滑 / 防抖，落笔时显示笔头圆环；
笔刷工具**连续作画**，一笔接一笔不用重选工具；属性面板空白时就是画布设置，
可一键填充整块画布（`Shift+B`）或恢复透明。

**颜色即语言** — 同一个属性在属性面板、时间轴轨道、关键帧菱形上**同色**；
图层行与时间轴行都带图形自身的颜色小方块，
工具栏分组各有色带（选择=中性、绘制=青、形状=琥珀、涂色=青柠）。
看一眼颜色就知道哪儿对哪儿，不用背。

**工程文件** — `.svgen.json` 保存 / 打开、拖放导入、自动保存到浏览器、SVG 导入。

**国际化** — 中文（默认）与英文，顶栏一键切换，选择会被记住。

### 快捷键

| 键 | 作用 | 键 | 作用 |
| --- | --- | --- | --- |
| `V` | 选择 | `R` / `U` | 矩形 / 圆角矩形 |
| `P` | 自由手绘 | `O` | 椭圆 |
| `B` | 曲线 | `L` / `A` | 直线 / 箭头 |
| `T` | 文字 | `G` / `S` | 多边形 / 星形 |
| `H` | 平移 | `I` | 取色 |
| `空格` | 播放 / 暂停 | `K` | 在播放头打关键帧 |
| `[` / `]` | 上 / 下一个关键帧 | `Home` / `End` | 到开头 / 结尾 |
| `Ctrl+Z` | 撤销 | `Ctrl+Shift+Z` | 重做 |
| `Ctrl+D` | 再制 | `Delete` | 删除 |
| `Ctrl+A` | 全选 | `Ctrl+C/V` | 复制 / 粘贴 |
| `Ctrl+S` | 保存工程 | `Ctrl+O` | 打开工程 |
| `Shift+1` | 适应窗口 | `Ctrl+0` | 实际大小 |
| `Ctrl+'` | 网格 | `Ctrl+Shift+O` | 洋葱皮 |
| `?` / `F1` | 关于与快捷键 | `Esc` | 取消当前操作 |

鼠标：中键拖动或按住空格平移 · `Ctrl+滚轮` 以光标为中心缩放 · 空画布拖动框选 · `Shift+点击` 加选。

---

## 后端

### 渲染链

按顺序尝试，逐级回退：

1. **无头浏览器**（Chrome / Edge / Firefox）—— 最高保真：真实字体、CJK、完整 SVG
2. **原生 Rust 引擎** —— 无需浏览器，几何 / 变换 / 渐变在 Python 侧共享
3. **纯 Python 光栅器** —— 零依赖兜底，永远可用

### CLI

| 命令 | 说明 |
| --- | --- |
| `svgen info` | 操作系统、架构、文件系统模式、工具可用性 |
| `svgen engines` | 渲染链、可用格式、引擎路径 |
| `svgen validate <file.svg>` | 解析并输出 SMIL 动画时间轴 |
| `svgen render <file.svg> [-f FORMAT]` | 渲染为 `png/jpg/bmp/webp/gif/mp4/webm`，输入 `-` 表示 stdin |
| `svgen serve [--port] [--host] [--static] [--open]` | 启动 HTTP API + 前端 |
| `svgen logs on\|off` | 持久化日志开关 |
| `svgen build-rs [--debug]` | 编译原生 Rust 引擎 |

渲染参数：`--width`、`--height`、`--duration`、`--fps`、`--background`、
`--engine auto|chrome|firefox|rust|raster`、`--quality`、`-o/--output`。

### HTTP API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 心跳（前端在线探测） |
| GET | `/api/info` | 平台、能力、渲染链、限制 |
| GET | `/api/engines` | 引擎报告 |
| GET/POST | `/api/logs` | 读取 / 切换日志 |
| POST | `/api/validate` | 校验 SVG，返回动画时间轴与提示 |
| POST | `/api/render` | 同步渲染，返回字节 |
| POST | `/api/export` | 同步渲染，带下载文件名 |
| POST | `/api/jobs` | **异步渲染任务** → `{id}` |
| GET | `/api/jobs` | 最近任务列表 |
| GET | `/api/jobs/<id>` | 任务状态与进度 |
| GET | `/api/jobs/<id>/events` | **SSE 进度流** |
| GET | `/api/jobs/<id>/result` | 取回结果字节 |
| DELETE | `/api/jobs/<id>` | 取消任务 |
| GET | `/` | 工作室前端 |

`POST /api/jobs` 请求体：
`{ svg, format, width, height, duration, fps, background, engine, quality, name }`

```bash
# 同步导出静帧
curl -X POST http://localhost:8090/api/export \
  -H 'Content-Type: application/json' \
  -d '{"svg":"<svg xmlns=...>...</svg>","format":"png","width":800,"height":600,"name":"art"}' \
  -o art.png

# 异步导出视频并跟踪进度
ID=$(curl -s -X POST http://localhost:8090/api/jobs \
  -H 'Content-Type: application/json' \
  -d @job.json | python -c "import sys,json;print(json.load(sys.stdin)['job']['id'])")
curl -N http://localhost:8090/api/jobs/$ID/events
curl -o out.mp4 http://localhost:8090/api/jobs/$ID/result
```

### 动画 → 视频的原理

1. 前端保存图形与关键帧（`x, y, rotation, scaleX, scaleY, opacity, strokeWidth`）。
2. 导出时序列化为 SVG：每个变换分量一个 `<g>`，每个分量一个 `<animateTransform>`，
   并用 `data-svgen-parent` 明确指向要驱动的分组。
3. **插值在前端完成**：按导出帧率均匀采样，把真实缓动曲线烘进 `values` 列表。
   因此 Chrome、Firefox、Rust、Python 四个引擎看到的运动完全一致 —— 它们都不需要理解 `keySplines`。
4. 后端逐帧**烘焙**：采样每个动画、写入目标属性、剥离 `<animate>` 节点，得到静态 SVG。
5. 帧被光栅化并流式送入 ffmpeg（`mp4` / `webm`）或 GIF 编码器。

---

## 测试

```bash
cd backend
python tests/test_pipeline.py          # 34 项后端检查（烘焙、引擎、格式、边界、回归）
python tests/test_pipeline.py --fast   # 跳过较慢的视频渲染
python tests/test_studio_ui.py         # 真实浏览器端到端（需 playwright + 已启动的服务器）
```

`test_studio_ui.py` 会用真实工具栏画图、按 `K` 打关键帧、然后通过导出面板产出
PNG / GIF / SVG 并在磁盘上校验（含 GIF 帧数）。它同时断言**浏览器控制台零报错**。

覆盖到的关键回归：SMIL 烘焙真的在动、`fill="remove"` 之后恢复原值、
有限 `repeatCount` 会循环、透明度是渐变而不是硬切、
不透明背景不再抹掉画面、`stroke-dasharray` 不再死循环、
Rust 与 Python 在抗锯齿边缘逐像素一致、超大画布返回错误而不是崩进程、
NaN 坐标不会打死引擎。

---

## HarmonyOS Sans 字体合规

HarmonyOS Sans 字体许可协议（© 2021 华为终端有限公司，全文见
`frontend/fonts/Huawei_HarmonyOS_Sans_License.txt`）授予免版税、全球范围许可，
允许*使用、复制、合并、嵌入、捆绑、再分发和/或销售**未经修改**的副本……与任何软件
（字体软件除外）*，我们按如下方式满足其条件：

| 协议条件 | 满足方式 |
| --- | --- |
| **显著声明使用了 HarmonyOS Sans 字体** | 状态栏常驻声明；关于面板（`?` / F1）中的完整声明与许可引用；仓库 `NOTICE`；两版 README |
| **不修改字体** | 随附 TTF 为官方文件，逐字节一致（SHA-256 已校验）。不转换（不做 WOFF2）、不子集化、不编辑 |
| **不单独再分发 / 销售** | 字体仅随本软件捆绑，绝不单独分发或销售 |
| **保留版权声明与协议** | 逐字完整的协议随字体一同分发；© 2021 华为版权声明保留 |

随附字体校验和（SHA-256，与官方发布文件一致）：

```
frontend/fonts/HarmonyOS_SansSC_Regular.ttf   984CF609545ACEE8EF060780FB70FC3099B058C0553416331B6E863FDF7C26FA
frontend/fonts/HarmonyOS_SansSC_Bold.ttf      C215D8AB1CB6709FEC2E063F8213E9AF86D7587D345B56325E36B67D6B947D98
frontend/fonts/Huawei_HarmonyOS_Sans_License.txt  （与官方协议文本一致）
```

*HarmonyOS 是华为终端有限公司的商标。*

---

## 性能基准

原生引擎承担真正的热点：扫描线多边形填充、渐变采样、alpha 混合、
超采样降采样，以及 GIF 编码（中位切分量化 + LZW）。

| 负载 | 纯 Python | Rust 引擎 | 加速比 |
| --- | --- | --- | --- |
| 静帧 PNG 800×600（渐变 + 30 圆 + 路径） | 3.94 s | 0.047 s | **83×** |
| 视频 24 fps × 1 s @ 640×360 | 54.91 s | 0.752 s | **73×** |
| 动画 GIF 320×240 × 12 帧 | 不可用 | 0.023 s | **>18000×** |

几何提取与 SMIL 烘焙每帧约 10 ms / 5 ms，可以忽略，因此留在 Python 侧。

---

## 已知限制

- 内置的 Python / Rust 光栅器使用 7×7 点阵字体渲染文本：
  ASCII 可用，**CJK 会变成空白**。需要中文文本请使用浏览器引擎（默认 `auto` 会优先选它）。
- 这两个引擎目前也不支持跨子路径的镂空（evenodd 洞）、`clip-path`、`mask`、`<image>`。
- 渐变在导入时以端点平均色近似（前端模型目前只存纯色填充）。
- 路径上的描边虚线长度按缓冲空间计算，视觉上约为标称值的 `1/SUPERSAMPLE`。

## 许可

[MIT](LICENSE) —— 文本取自权威的 [Open Source Initiative](https://opensource.org/license/mit)
/ [SPDX MIT](https://spdx.org/licenses/MIT.html)。Copyright (c) 2026 SVGen Studio contributors。

---

**[English](README.md) · 中文**
