/**
 * i18n. Two flat dictionaries, a `t()` with `{placeholder}` interpolation, and
 * declarative binding via `data-i18n`, `data-i18n-title`, `data-i18n-ph`.
 */

import { Emitter } from "../core/emitter.js";

const DICT = {
  en: {
    "app.name": "SVGen",
    "app.tagline": "Studio",

    /* file */
    "file.new": "New",
    "file.open": "Open project",
    "file.save": "Save project",
    "file.saveAs": "Save as…",
    "file.importSvg": "Import SVG…",
    "file.exportSvg": "Export SVG",
    "file.copySvg": "Copy SVG",
    "file.snapshot": "Save PNG snapshot",
    "file.untitled": "Untitled",
    "file.dirty": "Unsaved changes",

    /* edit */
    "edit.undo": "Undo",
    "edit.redo": "Redo",
    "edit.duplicate": "Duplicate",
    "edit.delete": "Delete",
    "edit.selectAll": "Select all",
    "edit.deselect": "Deselect",
    "edit.copy": "Copy",
    "edit.paste": "Paste",
    "edit.group": "Group",
    "edit.bringFront": "Bring to front",
    "edit.sendBack": "Send to back",
    "edit.raise": "Bring forward",
    "edit.lower": "Send backward",
    "edit.flipH": "Flip horizontally",
    "edit.flipV": "Flip vertically",

    /* canvas context menu */
    "ctx.canvas": "Canvas",
    "ctx.view": "View",
    "ctx.app": "Studio",
    "ctx.canvasSettings": "Canvas settings…",
    "ctx.nShapes": "{n} shapes",
    "ctx.cut": "Cut",
    "ctx.copy": "Copy",
    "ctx.paste": "Paste",
    "ctx.selectAll": "Select all",
    "ctx.clear": "Clear",
    "ctx.clipboardBlocked": "Clipboard blocked — press Ctrl+V instead",

    /* element types */
    "type.rect": "Rectangle",
    "type.ellipse": "Ellipse",
    "type.polygon": "Polygon",
    "type.star": "Star",
    "type.line": "Line",
    "type.arrow": "Arrow",
    "type.path": "Path",
    "type.text": "Text",

    /* brush */
    "brush.title": "Brush",
    "brush.size": "Size",
    "brush.opacity": "Opacity",
    "brush.smooth": "Smoothing",
    "brush.stabiliser": "Stabiliser",
    "brush.taper": "Taper",
    "brush.colour": "Colour",
    "brush.swap": "Swap",
    "brush.settings": "Brush settings",

    /* document / canvas */
    "doc.title": "Canvas",
    "doc.fill": "Background",
    "doc.fillNone": "Transparent",
    "doc.pickBackground": "Fill the canvas",
    "doc.size": "Size",
    "doc.preset": "Preset",
    "doc.grid": "Grid",
    "doc.gridSize": "Grid step",
    "doc.snap": "Snap to grid",
    "doc.showGrid": "Show grid",
    "doc.fps": "Frame rate",
    "doc.duration": "Duration",
    "doc.backgroundSet": "Canvas filled with {color}",
    "doc.noSelection": "Nothing selected",

    "align.left": "Align left",
    "align.center": "Align centres",
    "align.right": "Align right",
    "align.top": "Align top",
    "align.middle": "Align middles",
    "align.bottom": "Align bottom",

    "insp.editText": "Edit text…",
    "insp.addText": "Add text",

    /* view */
    "view.zoomIn": "Zoom in",
    "view.zoomOut": "Zoom out",
    "view.zoomFit": "Fit to window",
    "view.zoom100": "Actual size",
    "view.grid": "Show grid",
    "view.snap": "Snap to grid",
    "view.onion": "Onion skin",
    "view.theme": "Switch theme",
    "view.panel": "Toggle side panel",
    "view.timeline": "Toggle timeline",

    /* tools */
    "tool.select": "Select",
    "tool.pen": "Freehand",
    "tool.brush": "Brush",
    "tool.path": "Curve",
    "tool.text": "Text",
    "tool.rect": "Rectangle",
    "tool.rounded": "Rounded rectangle",
    "tool.ellipse": "Ellipse",
    "tool.line": "Line",
    "tool.arrow": "Arrow",
    "tool.polygon": "Polygon",
    "tool.star": "Star",
    "tool.hand": "Pan",
    "tool.eyedropper": "Pick colour",
    "tool.heal": "Erase point",
    "tool.fill": "Fill",
    "tool.stroke": "Stroke",
    "tool.strokeWidth": "Stroke width",
    "tool.swapColors": "Swap fill and stroke",

    /* dock */
    "dock.inspector": "Inspector",
    "dock.layers": "Layers",
    "dock.export": "Export",
    "dock.about": "About",

    /* inspector */
    "insp.empty": "Nothing selected",
    "insp.emptyHint": "Pick a shape on the canvas, or draw a new one.",
    "insp.multi": "{n} shapes selected",
    "insp.multiHint": "Changes apply to every selected shape.",
    "insp.shape": "Shape",
    "insp.transform": "Transform",
    "insp.appearance": "Appearance",
    "insp.stroke": "Stroke",
    "insp.text": "Text",
    "insp.animation": "Animation",
    "insp.name": "Name",
    "insp.x": "X",
    "insp.y": "Y",
    "insp.w": "W",
    "insp.h": "H",
    "insp.rotation": "Rotation",
    "insp.scaleX": "Scale X",
    "insp.scaleY": "Scale Y",
    "insp.opacity": "Opacity",
    "insp.radius": "Corner radius",
    "insp.sides": "Sides",
    "insp.innerRatio": "Inner ratio",
    "insp.fontSize": "Size",
    "insp.fontWeight": "Weight",
    "insp.fontFamily": "Font",
    "insp.content": "Content",
    "insp.dash": "Dash",
    "insp.cap": "Cap",
    "insp.join": "Join",
    "insp.closed": "Closed path",
    "insp.smooth": "Smooth",
    "insp.points": "{n} points",
    "insp.keyCount": "{n} keyframes",
    "insp.addKey": "Add keyframe at the playhead",
    "insp.removeKeys": "Clear keyframes",
    "insp.align": "Align",
    "insp.order": "Order",

    /* layers */
    "layers.empty": "No layers yet",
    "layers.emptyHint": "Draw something — it lands here.",
    "layers.up": "Bring forward",
    "layers.down": "Send backward",
    "layers.duplicate": "Duplicate",
    "layers.delete": "Delete",
    "layers.rename": "Rename",
    "layers.show": "Show",
    "layers.hide": "Hide",
    "layers.lock": "Lock",
    "layers.unlock": "Unlock",
    "layers.drop": "Drop to reorder",

    /* timeline */
    "tl.play": "Play",
    "tl.pause": "Pause",
    "tl.stop": "Stop",
    "tl.prevKey": "Previous keyframe",
    "tl.nextKey": "Next keyframe",
    "tl.toStart": "Go to start",
    "tl.toEnd": "Go to end",
    "tl.loop": "Loop playback",
    "tl.onion": "Onion skin",
    "tl.addKey": "Add keyframe",
    "tl.delKey": "Remove keyframe",
    "tl.ease": "Easing",
    "tl.easeFor": "Easing for the selected keyframe",
    "tl.time": "Time",
    "tl.duration": "Duration",
    "tl.fps": "Frame rate",
    "tl.empty": "Add a shape, then keyframe it here.",
    "tl.trackOf": "{name} · {prop}",
    "tl.selectFirst": "Select a shape first",
    "tl.noKeys": "No keyframes on this shape yet",
    "tl.keyAdded": "Keyframe added",
    "tl.keyRemoved": "Keyframe removed",
    "tl.zoom": "Timeline zoom",

    /* properties of the timeline */
    "prop.x": "X",
    "prop.y": "Y",
    "prop.rotation": "Rotation",
    "prop.scaleX": "Scale X",
    "prop.scaleY": "Scale Y",
    "prop.opacity": "Opacity",
    "prop.strokeWidth": "Stroke",
    "prop.width": "Width",
    "prop.height": "Height",

    "ease.linear": "Linear",
    "ease.hold": "Hold",
    "ease.in": "Ease in",
    "ease.out": "Ease out",
    "ease.inout": "Ease in-out",
    "ease.bezier": "Custom curve",

    /* export */
    "exp.title": "Export",
    "exp.canvas": "Canvas",
    "exp.width": "Width",
    "exp.height": "Height",
    "exp.background": "Background",
    "exp.transparent": "Transparent",
    "exp.format": "Format",
    "exp.output": "Output",
    "exp.duration": "Duration",
    "exp.fps": "Frame rate",
    "exp.quality": "Quality",
    "exp.engine": "Render engine",
    "exp.engine.auto": "Auto (best available)",
    "exp.engine.chrome": "Chrome / Edge",
    "exp.engine.firefox": "Firefox",
    "exp.engine.rust": "Native (Rust)",
    "exp.engine.raster": "Built-in (Python)",
    "exp.go": "Render & download",
    "exp.copySvg": "Copy SVG",
    "exp.downloadSvg": "Download SVG",
    "exp.snapshot": "PNG snapshot",
    "exp.ready": "Ready",
    "exp.offline": "Backend offline",
    "exp.offlineHint": "Start it with: python svgen.py serve",
    "exp.stage.bake": "Baking frames…",
    "exp.stage.browser": "Rendering with the browser…",
    "exp.stage.raster": "Rasterizing…",
    "exp.stage.frames": "Rendering frames",
    "exp.stage.encode": "Encoding…",
    "exp.stage.starting": "Starting…",
    "exp.stage.queued": "Queued",
    "exp.stage.done": "Done",
    "exp.cancel": "Cancel",
    "exp.cancelled": "Cancelled",
    "exp.done": "Saved {name}",
    "exp.failed": "Export failed",
    "exp.capabilities": "This machine",
    "exp.videoNeedsFfmpeg": "{fmt} needs ffmpeg",
    "exp.frames": "{n} frames",
    "exp.estimate": "≈ {n} frames to render",

    /* about */
    "about.version": "Version",
    "about.fonts": "Fonts",
    "about.language": "Language",
    "about.storage": "Storage",
    "about.storageNote": "Your scene is saved in this browser.",
    "about.clearStorage": "Clear saved scene",
    "about.cleared": "Saved scene cleared",
    "about.chain": "Render chain",
    "about.formats": "Image formats",
    "about.videoFormats": "Video formats",
    "about.ffmpeg": "ffmpeg",
    "about.notAvailable": "not available",
    "about.help": "About & shortcuts",
    "about.built": "Canvas studio",
    "about.fontNotice":
      "This software uses HarmonyOS Sans Fonts, licensed under the HarmonyOS Sans Fonts License Agreement (Huawei Device Co., Ltd., © 2021). The fonts are bundled unmodified under frontend/fonts/ — see Huawei_HarmonyOS_Sans_License.txt.",
    "about.fontShort": "Fonts: HarmonyOS Sans SC © 2021 Huawei Device Co., Ltd.",
    "about.trademark": "HarmonyOS is a trademark of Huawei Device Co., Ltd.",
    "about.backend": "Backend",
    "about.shortcuts": "Keyboard shortcuts",
    "about.mouse": "Mouse & trackpad",

    /* option labels */
    "opt.preset": "Preset",
    "opt.cap.butt": "Butt",
    "opt.cap.round": "Round",
    "opt.cap.square": "Square",
    "opt.join.miter": "Miter",
    "opt.join.round": "Round",
    "opt.join.bevel": "Bevel",
    "opt.align.left": "Left",
    "opt.align.center": "Center",
    "opt.align.right": "Right",
    "opt.none": "None",

    /* status */
    "st.ready": "Ready",
    "st.tool": "Tool: {name}",
    "st.layers": "{n} layers",
    "st.layer": "{n} layer",
    "st.saved": "Project saved",
    "st.loaded": "Loaded {name}",
    "st.imported": "Imported {n} shapes",
    "st.importNone": "Nothing importable in that SVG",
    "st.importWarn": "{n} notes while importing",
    "st.restored": "Restored your last session",
    "st.newScene": "New canvas",
    "st.deleted": "Deleted",
    "st.duplicated": "Duplicated",
    "st.copied": "Copied SVG to the clipboard",
    "st.copyFailed": "Clipboard blocked — use Download SVG",
    "st.cleared": "Canvas cleared",
    "st.undo": "Undo {label}",
    "st.redo": "Redo {label}",
    "st.nothingToUndo": "Nothing to undo",
    "st.nothingToRedo": "Nothing to redo",
    "st.online": "Backend online",
    "st.offline": "Backend offline",
    "st.reconnected": "Backend reconnected",
    "st.lost": "Backend connection lost",

    /* dialogs */
    "dlg.cancel": "Cancel",
    "dlg.confirm": "Confirm",
    "dlg.ok": "OK",
    "dlg.deleteTitle": "Delete {n} layer(s)?",
    "dlg.deleteBody": "This can be undone with Ctrl+Z.",
    "dlg.newTitle": "Start a new canvas?",
    "dlg.newBody": "The current scene will be replaced. You can undo this.",
    "dlg.clearTitle": "Clear the canvas?",
    "dlg.clearBody": "Every layer will be removed. You can undo this.",
    "dlg.overwriteTitle": "Replace the current scene?",
    "dlg.overwriteBody": "Opening a project replaces what is on the canvas.",

    /* hints */
    "hint.title": "Start drawing",
    "hint.1": "Pick a shape from the left rail",
    "hint.2": "Click a shape, then press K to keyframe it",
    "hint.3": "Export stills or video from the Export tab",

    /* the sample scene */
    "demo.title": "SVGen",
    "demo.titleLayer": "Title",
    "demo.ball": "Ball",
    "demo.sun": "Sun",
    "demo.star": "Star",
    "demo.ground": "Ground",

    /* shortcuts help */
    "help.tools": "Tools",
    "help.editing": "Editing",
    "help.playback": "Playback",
    "help.view": "View",
    "help.pan": "Pan",
    "help.zoom": "Zoom at cursor",
    "help.marquee": "Marquee select",
    "help.multi": "Add to selection",
    "help.constrain": "Constrain proportions",
    "help.fromCenter": "Draw from the centre",
    "help.nudge": "Nudge selection",
    "help.nudgeBig": "Nudge ×10",
    "help.playPause": "Play / pause",
  },

  zh: {
    "app.name": "SVGen",
    "app.tagline": "工作室",

    "file.new": "新建",
    "file.open": "打开工程",
    "file.save": "保存工程",
    "file.saveAs": "另存为…",
    "file.importSvg": "导入 SVG…",
    "file.exportSvg": "导出 SVG",
    "file.copySvg": "复制 SVG",
    "file.snapshot": "保存 PNG 快照",
    "file.untitled": "未命名",
    "file.dirty": "有未保存的修改",

    "edit.undo": "撤销",
    "edit.redo": "重做",
    "edit.duplicate": "再制",
    "edit.delete": "删除",
    "edit.selectAll": "全选",
    "edit.deselect": "取消选择",
    "edit.copy": "复制",
    "edit.paste": "粘贴",
    "edit.group": "编组",
    "edit.bringFront": "移到最前",
    "edit.sendBack": "移到最后",
    "edit.raise": "上移一层",
    "edit.lower": "下移一层",
    "edit.flipH": "水平翻转",
    "edit.flipV": "垂直翻转",

    "ctx.canvas": "画布",
    "ctx.view": "视图",
    "ctx.app": "工作室",
    "ctx.canvasSettings": "画布设置…",
    "ctx.nShapes": "{n} 个图形",
    "ctx.cut": "剪切",
    "ctx.copy": "复制",
    "ctx.paste": "粘贴",
    "ctx.selectAll": "全选",
    "ctx.clear": "清空",
    "ctx.clipboardBlocked": "剪贴板被拒绝——请直接按 Ctrl+V",

    "type.rect": "矩形",
    "type.ellipse": "椭圆",
    "type.polygon": "多边形",
    "type.star": "星形",
    "type.line": "直线",
    "type.arrow": "箭头",
    "type.path": "路径",
    "type.text": "文字",

    "brush.title": "画笔",
    "brush.size": "粗细",
    "brush.opacity": "不透明度",
    "brush.smooth": "平滑",
    "brush.stabiliser": "防抖",
    "brush.taper": "两端收笔",
    "brush.colour": "颜色",
    "brush.swap": "交换",
    "brush.settings": "画笔设置",

    "doc.title": "画布",
    "doc.fill": "背景",
    "doc.fillNone": "透明",
    "doc.pickBackground": "填充画布",
    "doc.size": "尺寸",
    "doc.preset": "预设",
    "doc.grid": "网格",
    "doc.gridSize": "网格间距",
    "doc.snap": "对齐网格",
    "doc.showGrid": "显示网格",
    "doc.fps": "帧率",
    "doc.duration": "时长",
    "doc.backgroundSet": "画布已填充为 {color}",
    "doc.noSelection": "未选中任何对象",

    "align.left": "左对齐",
    "align.center": "水平居中",
    "align.right": "右对齐",
    "align.top": "顶对齐",
    "align.middle": "垂直居中",
    "align.bottom": "底对齐",

    "insp.editText": "编辑文字…",
    "insp.addText": "添加文字",

    "view.zoomIn": "放大",
    "view.zoomOut": "缩小",
    "view.zoomFit": "适应窗口",
    "view.zoom100": "实际大小",
    "view.grid": "显示网格",
    "view.snap": "对齐网格",
    "view.onion": "洋葱皮",
    "view.theme": "切换主题",
    "view.panel": "显示/隐藏侧栏",
    "view.timeline": "显示/隐藏时间轴",

    "tool.select": "选择",
    "tool.pen": "自由绘制",
    "tool.brush": "笔刷",
    "tool.path": "曲线",
    "tool.text": "文字",
    "tool.rect": "矩形",
    "tool.rounded": "圆角矩形",
    "tool.ellipse": "椭圆",
    "tool.line": "直线",
    "tool.arrow": "箭头",
    "tool.polygon": "多边形",
    "tool.star": "星形",
    "tool.hand": "平移",
    "tool.eyedropper": "取色",
    "tool.heal": "删除锚点",
    "tool.fill": "填充",
    "tool.stroke": "描边",
    "tool.strokeWidth": "描边宽度",
    "tool.swapColors": "交换填充与描边",

    "dock.inspector": "属性",
    "dock.layers": "图层",
    "dock.export": "导出",
    "dock.about": "关于",

    "insp.empty": "未选中任何对象",
    "insp.emptyHint": "在画布上点选一个图形，或直接绘制。",
    "insp.multi": "已选中 {n} 个图形",
    "insp.multiHint": "修改将应用到所有选中的图形。",
    "insp.shape": "形状",
    "insp.transform": "变换",
    "insp.appearance": "外观",
    "insp.stroke": "描边",
    "insp.text": "文字",
    "insp.animation": "动画",
    "insp.name": "名称",
    "insp.x": "X",
    "insp.y": "Y",
    "insp.w": "宽",
    "insp.h": "高",
    "insp.rotation": "旋转",
    "insp.scaleX": "X 缩放",
    "insp.scaleY": "Y 缩放",
    "insp.opacity": "不透明度",
    "insp.radius": "圆角半径",
    "insp.sides": "边数",
    "insp.innerRatio": "内径比",
    "insp.fontSize": "字号",
    "insp.fontWeight": "字重",
    "insp.fontFamily": "字体",
    "insp.content": "内容",
    "insp.dash": "虚线",
    "insp.cap": "端点",
    "insp.join": "拐角",
    "insp.closed": "闭合路径",
    "insp.smooth": "平滑",
    "insp.points": "{n} 个点",
    "insp.keyCount": "{n} 个关键帧",
    "insp.addKey": "在播放头添加关键帧",
    "insp.removeKeys": "清除关键帧",
    "insp.align": "对齐",
    "insp.order": "层级",

    "layers.empty": "还没有图层",
    "layers.emptyHint": "画点什么，它就会出现在这里。",
    "layers.up": "上移一层",
    "layers.down": "下移一层",
    "layers.duplicate": "再制",
    "layers.delete": "删除",
    "layers.rename": "重命名",
    "layers.show": "显示",
    "layers.hide": "隐藏",
    "layers.lock": "锁定",
    "layers.unlock": "解锁",
    "layers.drop": "拖放以重新排序",

    "tl.play": "播放",
    "tl.pause": "暂停",
    "tl.stop": "停止",
    "tl.prevKey": "上一个关键帧",
    "tl.nextKey": "下一个关键帧",
    "tl.toStart": "回到开头",
    "tl.toEnd": "跳到结尾",
    "tl.loop": "循环播放",
    "tl.onion": "洋葱皮",
    "tl.addKey": "添加关键帧",
    "tl.delKey": "删除关键帧",
    "tl.ease": "缓动",
    "tl.easeFor": "所选关键帧的缓动",
    "tl.time": "时间",
    "tl.duration": "时长",
    "tl.fps": "帧率",
    "tl.empty": "先添加一个图形，再来这里打关键帧。",
    "tl.trackOf": "{name} · {prop}",
    "tl.selectFirst": "请先选中一个图形",
    "tl.noKeys": "该图形还没有关键帧",
    "tl.keyAdded": "已添加关键帧",
    "tl.keyRemoved": "已删除关键帧",
    "tl.zoom": "时间轴缩放",

    "prop.x": "X",
    "prop.y": "Y",
    "prop.rotation": "旋转",
    "prop.scaleX": "X 缩放",
    "prop.scaleY": "Y 缩放",
    "prop.opacity": "不透明度",
    "prop.strokeWidth": "描边",
    "prop.width": "宽度",
    "prop.height": "高度",

    "ease.linear": "线性",
    "ease.hold": "保持",
    "ease.in": "缓入",
    "ease.out": "缓出",
    "ease.inout": "缓入缓出",
    "ease.bezier": "自定义曲线",

    "exp.title": "导出",
    "exp.canvas": "画布",
    "exp.width": "宽度",
    "exp.height": "高度",
    "exp.background": "背景",
    "exp.transparent": "透明",
    "exp.format": "格式",
    "exp.output": "输出",
    "exp.duration": "时长",
    "exp.fps": "帧率",
    "exp.quality": "质量",
    "exp.engine": "渲染引擎",
    "exp.engine.auto": "自动（最佳可用）",
    "exp.engine.chrome": "Chrome / Edge",
    "exp.engine.firefox": "Firefox",
    "exp.engine.rust": "原生（Rust）",
    "exp.engine.raster": "内置（Python）",
    "exp.go": "渲染并下载",
    "exp.copySvg": "复制 SVG",
    "exp.downloadSvg": "下载 SVG",
    "exp.snapshot": "PNG 快照",
    "exp.ready": "就绪",
    "exp.offline": "后端未连接",
    "exp.offlineHint": "请先启动：python svgen.py serve",
    "exp.stage.bake": "正在烘焙帧…",
    "exp.stage.browser": "正在用浏览器渲染…",
    "exp.stage.raster": "正在光栅化…",
    "exp.stage.frames": "正在渲染帧",
    "exp.stage.encode": "正在编码…",
    "exp.stage.starting": "正在启动…",
    "exp.stage.queued": "排队中",
    "exp.stage.done": "完成",
    "exp.cancel": "取消",
    "exp.cancelled": "已取消",
    "exp.done": "已保存 {name}",
    "exp.failed": "导出失败",
    "exp.capabilities": "本机环境",
    "exp.videoNeedsFfmpeg": "{fmt} 需要 ffmpeg",
    "exp.frames": "{n} 帧",
    "exp.estimate": "约需渲染 {n} 帧",

    "about.version": "版本",
    "about.fonts": "字体",
    "about.language": "界面语言",
    "about.storage": "存储",
    "about.storageNote": "工程会自动保存在此浏览器中。",
    "about.clearStorage": "清除已保存的工程",
    "about.cleared": "已清除保存的工程",
    "about.chain": "渲染链路",
    "about.formats": "图片格式",
    "about.videoFormats": "视频格式",
    "about.ffmpeg": "ffmpeg",
    "about.notAvailable": "不可用",
    "about.help": "关于与快捷键",
    "about.built": "画布工作室",
    "about.fontNotice":
      "本软件使用了 HarmonyOS Sans 字体，遵循《HarmonyOS Sans 字体许可协议》（华为终端有限公司，© 2021）。字体以未经修改的原始文件形式随软件分发，位于 frontend/fonts/ —— 详见 Huawei_HarmonyOS_Sans_License.txt。",
    "about.fontShort": "字体：HarmonyOS Sans SC © 2021 华为终端有限公司",
    "about.trademark": "HarmonyOS 是华为终端有限公司的商标。",
    "about.backend": "后端",
    "about.shortcuts": "快捷键",
    "about.mouse": "鼠标与触控板",

    "opt.preset": "尺寸预设",
    "opt.cap.butt": "平头",
    "opt.cap.round": "圆头",
    "opt.cap.square": "方头",
    "opt.join.miter": "尖角",
    "opt.join.round": "圆角",
    "opt.join.bevel": "斜切",
    "opt.align.left": "左对齐",
    "opt.align.center": "居中",
    "opt.align.right": "右对齐",
    "opt.none": "无",

    "st.ready": "就绪",
    "st.tool": "工具：{name}",
    "st.layers": "{n} 个图层",
    "st.layer": "{n} 个图层",
    "st.saved": "工程已保存",
    "st.loaded": "已载入 {name}",
    "st.imported": "已导入 {n} 个图形",
    "st.importNone": "该 SVG 中没有可导入的内容",
    "st.importWarn": "导入时有 {n} 条提示",
    "st.restored": "已恢复上次的编辑内容",
    "st.newScene": "新画布",
    "st.deleted": "已删除",
    "st.duplicated": "已再制",
    "st.copied": "SVG 已复制到剪贴板",
    "st.copyFailed": "剪贴板被拒绝——请使用“下载 SVG”",
    "st.cleared": "画布已清空",
    "st.undo": "撤销：{label}",
    "st.redo": "重做：{label}",
    "st.nothingToUndo": "没有可撤销的操作",
    "st.nothingToRedo": "没有可重做的操作",
    "st.online": "后端已连接",
    "st.offline": "后端未连接",
    "st.reconnected": "后端已重新连接",
    "st.lost": "与后端的连接已断开",

    "dlg.cancel": "取消",
    "dlg.confirm": "确定",
    "dlg.ok": "好",
    "dlg.deleteTitle": "删除 {n} 个图层？",
    "dlg.deleteBody": "可以用 Ctrl+Z 撤销。",
    "dlg.newTitle": "新建画布？",
    "dlg.newBody": "当前场景将被替换，可以撤销。",
    "dlg.clearTitle": "清空画布？",
    "dlg.clearBody": "所有图层都会被删除，可以撤销。",
    "dlg.overwriteTitle": "替换当前场景？",
    "dlg.overwriteBody": "打开工程会替换画布上的内容。",

    "hint.title": "开始绘制",
    "hint.1": "从左侧工具栏选择形状",
    "hint.2": "选中图形后按 K 打关键帧",
    "hint.3": "在“导出”面板输出图片或视频",

    "demo.title": "SVGen",
    "demo.titleLayer": "标题",
    "demo.ball": "小球",
    "demo.sun": "太阳",
    "demo.star": "星星",
    "demo.ground": "地面",

    "help.tools": "工具",
    "help.editing": "编辑",
    "help.playback": "播放",
    "help.view": "视图",
    "help.pan": "平移",
    "help.zoom": "以光标为中心缩放",
    "help.marquee": "框选",
    "help.multi": "加选",
    "help.constrain": "等比约束",
    "help.fromCenter": "从中心绘制",
    "help.nudge": "微调选中对象",
    "help.nudgeBig": "微调 ×10",
    "help.playPause": "播放 / 暂停",
  },
};

export const LANGS = [
  { id: "en", label: "English" },
  { id: "zh", label: "中文" },
];

export const i18n = new Emitter();

/** Chinese is the studio's default language; the choice is remembered. */
const FALLBACK_LANG = "zh";

let current = FALLBACK_LANG;

function detectLang() {
  const stored = safeGet("svgen.lang");
  if (stored && DICT[stored]) return stored;
  return FALLBACK_LANG;
}

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — not fatal */
  }
}

export function lang() {
  return current;
}

export function setLang(id) {
  if (!DICT[id] || id === current) return;
  current = id;
  safeSet("svgen.lang", id);
  document.documentElement.setAttribute("lang", id === "zh" ? "zh-CN" : "en");
  applyI18n();
  i18n.emit("change", id);
}

export function toggleLang() {
  setLang(current === "zh" ? "en" : "zh");
}

/**
 * Translate. `t("exp.frames", { n: 12 })`.
 * Unknown keys fall back to English, then to the key itself (visible, so it is
 * obvious during development that something is missing).
 */
export function t(key, vars) {
  const table = DICT[current] || DICT.en;
  let text = table[key];
  if (text === undefined) text = DICT.en[key];
  if (text === undefined) return key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

/** Bind every `data-i18n*` attribute in `root` (document by default). */
export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    const text = t(key);
    el.setAttribute("title", text);
    el.setAttribute("aria-label", el.getAttribute("aria-label") || text);
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
  });
}

export function initI18n() {
  current = detectLang();
  document.documentElement.setAttribute("lang", current === "zh" ? "zh-CN" : "en");
  return current;
}
