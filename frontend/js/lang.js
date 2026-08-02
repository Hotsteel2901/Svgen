// lang.js — lightweight i18n (中文 / English).
// Adds data-i18n (text) and data-i18n-title (tooltip) support + a global t().

const I18N = {
  en: {
    // topbar
    "new": "New", "open": "Open", "save": "Save", "svg": "SVG", "grid": "Grid",
    "export": "Export", "undo": "Undo (Ctrl+Z)", "redo": "Redo (Ctrl+Y)",
    "zoom.out": "Zoom out", "zoom.in": "Zoom in", "zoom.fit": "Fit to screen",
    "backend.online": "backend online", "backend.offline": "backend offline",
    // tools
    "tool.select": "Select / Move (V)", "tool.pen": "Freehand pen (P)",
    "tool.path": "Smooth path (B)", "tool.text": "Text (T)",
    "tool.rect": "Rectangle (R)", "tool.rounded": "Rounded rectangle",
    "tool.ellipse": "Ellipse (O)", "tool.line": "Line (L)", "tool.arrow": "Arrow (A)",
    "tool.poly": "Polygon (G)", "tool.star": "Star (S)",
    "tool.fill": "Fill color", "tool.stroke": "Stroke color", "tool.width": "Stroke width",
    "tool.clear": "Clear canvas",
    // side tabs
    "tab.properties": "Properties", "tab.layers": "Layers", "tab.export": "Export",
    // properties panel
    "prop.empty": "Select a shape on the canvas or in the timeline to edit its properties.",
    "prop.transform": "Transform", "prop.appearance": "Appearance", "prop.text": "Text",
    "prop.shape": "Shape", "prop.animation": "Animation",
    "prop.x": "X", "prop.y": "Y", "prop.width": "Width", "prop.height": "Height",
    "prop.rotation": "Rotation", "prop.scale": "Scale", "prop.opacity": "Opacity",
    "prop.fill": "Fill", "prop.stroke": "Stroke", "prop.strokeW": "Stroke width",
    "prop.fontSize": "Font size", "prop.sides": "Sides", "prop.points": "Points",
    "prop.clearKeys": "Clear all keyframes", "prop.delete": "Delete layer",
    // layers
    "layer.rename": "Rename layer:", "layer.up": "Bring forward",
    "layer.down": "Send backward", "layer.dup": "Duplicate", "layer.del": "Delete",
    // export
    "exp.checking": "Checking backend…",
    "exp.canvas": "Canvas", "exp.width": "Width", "exp.height": "Height",
    "exp.background": "Background", "exp.output": "Output", "exp.format": "Format",
    "exp.duration": "Duration (s)", "exp.fps": "FPS", "exp.engine": "Render engine",
    "exp.engine.auto": "Auto", "exp.engine.chrome": "Browser (Chrome/Edge)",
    "exp.engine.firefox": "Browser (Firefox/Gecko)", "exp.engine.rust": "Rust (native)",
    "exp.engine.raster": "Python (built-in)",
    "exp.go": "Export & Download", "exp.svg": "Download SVG", "exp.copy": "Copy SVG",
    "exp.validating": "Validating…", "exp.invalid": "SVG invalid: ",
    "exp.rendering": "Rendering {fps} fps × {dur}s… (this may take a moment)",
    "exp.render": "Rendering…", "exp.done": "Done — {name}", "exp.failed": "Export failed: ",
    "exp.offline": "Backend offline", "exp.offlineHint": "Start the backend with: python svgen.py serve",
    "exp.copied": "SVG copied to clipboard",
    "exp.copyFail": "Copy failed — select the text from the SVG file",
    "exp.imported": "Imported {n} shapes from SVG",
    "exp.importNone": "No supported shapes found in SVG",
    "exp.sceneLoaded": "Scene loaded", "exp.sceneSaved": "Scene saved",
    "exp.loadFailed": "Failed to load scene: ",
    // timeline
    "tl.prev": "Previous keyframe", "tl.play": "Play / Pause", "tl.next": "Next keyframe",
    "tl.stop": "Stop", "tl.loop": "Loop", "tl.addKey": "◆ Add key",
    "tl.onion": "Onion skin", "tl.fps": "{fps} fps",
    "tl.selFirst": "Select a shape first",
    "tl.x": "X", "tl.y": "Y", "tl.rot": "Rot", "tl.scale": "Scale", "tl.opacity": "Opacity",
    // status / toasts
    "status.ready": "Ready",
    "st.tool": "Tool: {name}", "st.exporting": "Exporting {fmt} ({w}×{h})…",
    "st.exported": "Exported {name}", "st.exportFail": "Export failed",
    "st.restored": "Restored autosaved scene",
    "toast.reconnected": "Backend reconnected",
    "toast.lost": "Backend connection lost — start `python svgen.py serve`",
    "toast.exported": "Exported {name}", "toast.exportFail": "Export failed: {msg}",
    "toast.validFail": "SVG validation failed", "toast.newScene": "New canvas created",
    // help
    "help.title": "Keyboard Shortcuts",
    "help.close": "Close",
    "help.foot": "Drag with the middle mouse button to pan · wheel to zoom · Ctrl+wheel to zoom at cursor",
    // misc
    "hint": "Draw with the tools on the left · click a shape, then use the timeline below to animate it",
    "lang": "中文",
    "yes": "OK", "cancel": "Cancel",
    "confirm.new": "Start a new canvas? Current work will be lost.",
    "confirm.clear": "Delete all shapes?",
    "shape.rect": "Rectangle", "shape.rounded": "Rounded Rectangle", "shape.ellipse": "Ellipse",
    "shape.line": "Line", "shape.arrow": "Arrow", "shape.poly": "Polygon", "shape.star": "Star",
    "shape.pen": "Freehand", "shape.path": "Path", "shape.text": "Text",
  },

  zh: {
    // topbar
    "new": "新建", "open": "打开", "save": "保存", "svg": "导入SVG", "grid": "网格",
    "export": "导出", "undo": "撤销 (Ctrl+Z)", "redo": "重做 (Ctrl+Y)",
    "zoom.out": "缩小", "zoom.in": "放大", "zoom.fit": "适应屏幕",
    "backend.online": "后端在线", "backend.offline": "后端离线",
    // tools
    "tool.select": "选择 / 移动 (V)", "tool.pen": "自由笔 (P)",
    "tool.path": "平滑路径 (B)", "tool.text": "文字 (T)",
    "tool.rect": "矩形 (R)", "tool.rounded": "圆角矩形",
    "tool.ellipse": "椭圆 (O)", "tool.line": "直线 (L)", "tool.arrow": "箭头 (A)",
    "tool.poly": "多边形 (G)", "tool.star": "星形 (S)",
    "tool.fill": "填充色", "tool.stroke": "描边色", "tool.width": "描边宽度",
    "tool.clear": "清空画布",
    // side tabs
    "tab.properties": "属性", "tab.layers": "图层", "tab.export": "导出",
    // properties panel
    "prop.empty": "在画布或时间轴中选择一个形状以编辑其属性。",
    "prop.transform": "变换", "prop.appearance": "外观", "prop.text": "文字",
    "prop.shape": "形状", "prop.animation": "动画",
    "prop.x": "X 坐标", "prop.y": "Y 坐标", "prop.width": "宽度", "prop.height": "高度",
    "prop.rotation": "旋转", "prop.scale": "缩放", "prop.opacity": "不透明度",
    "prop.fill": "填充", "prop.stroke": "描边", "prop.strokeW": "描边宽度",
    "prop.fontSize": "字号", "prop.sides": "边数", "prop.points": "顶点数",
    "prop.clearKeys": "清除所有关键帧", "prop.delete": "删除图层",
    // layers
    "layer.rename": "重命名图层：", "layer.up": "上移一层",
    "layer.down": "下移一层", "layer.dup": "复制", "layer.del": "删除",
    // export
    "exp.checking": "正在检测后端…",
    "exp.canvas": "画布", "exp.width": "宽度", "exp.height": "高度",
    "exp.background": "背景色", "exp.output": "输出", "exp.format": "格式",
    "exp.duration": "时长（秒）", "exp.fps": "帧率", "exp.engine": "渲染引擎",
    "exp.engine.auto": "自动", "exp.engine.chrome": "浏览器 (Chrome/Edge)",
    "exp.engine.firefox": "浏览器 (Firefox/Gecko)", "exp.engine.rust": "Rust（原生）",
    "exp.engine.raster": "Python（内置）",
    "exp.go": "导出并下载", "exp.svg": "下载 SVG", "exp.copy": "复制 SVG",
    "exp.validating": "正在校验…", "exp.invalid": "SVG 无效：",
    "exp.rendering": "正在渲染 {fps}fps × {dur}秒…（可能需要一点时间）",
    "exp.render": "正在渲染…", "exp.done": "完成 — {name}", "exp.failed": "导出失败：",
    "exp.offline": "后端离线", "exp.offlineHint": "请先运行：python svgen.py serve",
    "exp.copied": "SVG 已复制到剪贴板",
    "exp.copyFail": "复制失败 — 请从 SVG 文件中复制文本",
    "exp.imported": "已从 SVG 导入 {n} 个形状",
    "exp.importNone": "SVG 中没有支持的形状",
    "exp.sceneLoaded": "场景已加载", "exp.sceneSaved": "场景已保存",
    "exp.loadFailed": "场景加载失败：",
    // timeline
    "tl.prev": "上一个关键帧", "tl.play": "播放 / 暂停", "tl.next": "下一个关键帧",
    "tl.stop": "停止", "tl.loop": "循环", "tl.addKey": "◆ 添加关键帧",
    "tl.onion": "洋葱皮", "tl.fps": "{fps} fps",
    "tl.selFirst": "请先选择一个形状",
    "tl.x": "X", "tl.y": "Y", "tl.rot": "旋转", "tl.scale": "缩放", "tl.opacity": "不透明度",
    // status / toasts
    "status.ready": "就绪",
    "st.tool": "工具：{name}", "st.exporting": "正在导出 {fmt}（{w}×{h}）…",
    "st.exported": "已导出 {name}", "st.exportFail": "导出失败",
    "st.restored": "已恢复自动保存的场景",
    "toast.reconnected": "后端已重连",
    "toast.lost": "后端连接断开 — 请运行 `python svgen.py serve`",
    "toast.exported": "已导出 {name}", "toast.exportFail": "导出失败：{msg}",
    "toast.validFail": "SVG 校验失败", "toast.newScene": "已创建新画布",
    // help
    "help.title": "键盘快捷键",
    "help.close": "关闭",
    "help.foot": "按住鼠标中键拖拽平移 · 滚轮缩放 · Ctrl+滚轮以光标为中心缩放",
    // misc
    "hint": "用左侧工具绘图 · 点击形状，再用下方时间轴制作动画",
    "lang": "English",
    "yes": "确定", "cancel": "取消",
    "confirm.new": "要新建画布吗？当前内容将丢失。",
    "confirm.clear": "确定删除所有形状？",
    "shape.rect": "矩形", "shape.rounded": "圆角矩形", "shape.ellipse": "椭圆",
    "shape.line": "直线", "shape.arrow": "箭头", "shape.poly": "多边形", "shape.star": "星形",
    "shape.pen": "自由笔", "shape.path": "路径", "shape.text": "文字",
  },
};

let LANG = (() => {
  try {
    const saved = localStorage.getItem("svgen-lang");
    if (saved === "zh" || saved === "en") return saved;
  } catch (e) {}
  const nav = (navigator.language || "").toLowerCase();
  return nav.startsWith("zh") ? "zh" : "en";
})();

function t(key, params) {
  const dict = I18N[LANG] || I18N.en;
  let s = dict[key] != null ? dict[key] : (I18N.en[key] != null ? I18N.en[key] : key);
  if (params) {
    for (const k of Object.keys(params)) {
      s = s.replace(new RegExp("\\{" + k + "\\}", "g"), params[k]);
    }
  }
  return s;
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.documentElement.lang = LANG === "zh" ? "zh-CN" : "en";
  const btn = document.getElementById("lang-toggle");
  if (btn) btn.textContent = t("lang");
  const a = window.app;
  if (a && a.panels && a.timeline) {
    a.panels.render();
    a.timeline.rebuild();
    a.updateHud();
  }
}

function setLang(l) {
  LANG = l;
  try { localStorage.setItem("svgen-lang", l); } catch (e) {}
  applyI18n();
}
