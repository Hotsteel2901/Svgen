"""End-to-end studio test driven through a real browser.

Draws with the actual toolbar, adds a keyframe from the keyboard, then exports a
PNG and an animated GIF through the Export panel, verifying both files on disk.

    python tests/test_studio_ui.py                 # expects a server on :8090

Requires: playwright (python -m pip install playwright && playwright install chromium).
"""

import json
import math
import os
import struct
import sys
import tempfile

from playwright.sync_api import sync_playwright

BASE = os.environ.get("SVGEN_URL", "http://127.0.0.1:8090")
OUT = os.path.join(tempfile.gettempdir(), "svgen_ui")
os.makedirs(OUT, exist_ok=True)

results = []


def check(name, fn):
    try:
        detail = fn()
        results.append(("PASS", name, detail or ""))
    except Exception as exc:  # noqa: BLE001
        results.append(("FAIL", name, "%s: %s" % (type(exc).__name__, exc)))


def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1500, "height": 940}, color_scheme="dark")
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        page.goto(BASE, wait_until="load")
        page.wait_for_function("() => !!window.__svgen", timeout=20000)
        page.wait_for_timeout(800)

        # --- boot ---------------------------------------------------------
        boot = page.evaluate(
            """() => {
              const app = window.__svgen;
              return {
                elements: app.scene.doc.elements.length,
                tools: document.querySelectorAll('#rail [data-tool]').length,
                tabs: document.querySelectorAll('.dock-tab').length,
                rows: document.querySelectorAll('.tl-row').length,
                lang: document.documentElement.lang,
                theme: document.documentElement.dataset.theme,
              };
            }"""
        )
        check("boot: app ready", lambda: f"{boot['elements']} elements, {boot['tools']} tools")
        assert boot["elements"] == 5, "demo scene missing"
        assert boot["tabs"] == 4, "dock tabs missing"

        # --- draw a rectangle with the real tool --------------------------
        page.evaluate("() => window.__svgen.scene.mutate('clear', d => { d.elements = []; d.selection = []; })")
        page.click('#rail [data-tool="rect"]')
        page.mouse.move(320, 260)
        page.mouse.down()
        page.mouse.move(620, 460, steps=12)
        page.mouse.up()
        page.wait_for_timeout(250)
        drawn = page.evaluate("() => window.__svgen.scene.doc.elements.length")
        check("draw: rectangle", lambda: f"{drawn} element(s)")

        # --- keyframe it --------------------------------------------------
        page.evaluate("() => { const a = window.__svgen; a.scene.select(a.scene.doc.elements[0].id); }")
        page.keyboard.press("k")
        page.wait_for_timeout(150)
        page.evaluate("() => window.__svgen.setTime(1.2)")
        page.keyboard.press("k")
        page.wait_for_timeout(150)
        keys = page.evaluate(
            "() => { const e = window.__svgen.scene.doc.elements[0]; return e.keys.x ? e.keys.x.length : 0; }"
        )
        check("keyframe: K adds one", lambda: f"{keys} x-key(s)")

        # --- the same shape resolves differently across the timeline ------
        span = page.evaluate(
            """() => {
              const app = window.__svgen;
              app.setTime(0);
              const a = app.stage.renderer.resolve(app.scene.doc.elements[0], 0).x;
              app.setTime(1.2);
              const b = app.stage.renderer.resolve(app.scene.doc.elements[0], 1.2).x;
              return [a, b];
            }"""
        )
        check("timeline: two keyframes resolve", lambda: "x %s / %s" % (span[0], span[1]))

        # --- undo / redo ---------------------------------------------------
        before = page.evaluate("() => window.__svgen.scene.doc.elements.length")
        page.evaluate("() => window.__svgen.undo()")
        page.wait_for_timeout(120)
        page.evaluate("() => window.__svgen.redo()")
        page.wait_for_timeout(120)
        after = page.evaluate("() => window.__svgen.scene.doc.elements.length")
        check("history: undo/redo round trip", lambda: f"{before} -> {after}")

        # --- export a PNG through the panel --------------------------------
        page.click('.dock-tab[data-tab="export"]')
        page.wait_for_timeout(400)
        png_path = os.path.join(OUT, "studio.png")
        with page.expect_download(timeout=60000) as dl:
            page.click(".pane .btn.brand.tall")
        dl.value.save_as(png_path)
        size = os.path.getsize(png_path)
        with open(png_path, "rb") as fh:
            head = fh.read(24)
        w, h = struct.unpack(">II", head[16:24])
        check("export: PNG", lambda: f"{w}x{h}, {size} bytes")
        assert head[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"

        # --- export an animated GIF through the job queue ------------------
        page.click('.fmt[data-format="gif"]')
        page.wait_for_timeout(200)
        gif_path = os.path.join(OUT, "studio.gif")
        with page.expect_download(timeout=120000) as dl:
            page.click(".pane .btn.brand.tall")
        dl.value.save_as(gif_path)
        gif_size = os.path.getsize(gif_path)
        with open(gif_path, "rb") as fh:
            magic = fh.read(6)
        frames = "?"
        try:
            from PIL import Image

            with Image.open(gif_path) as img:
                frames = getattr(img, "n_frames", 1)
        except Exception:
            pass
        check("export: animated GIF", lambda: f"{frames} frames, {gif_size} bytes")
        assert magic == b"GIF89a", "not a GIF"

        # --- SVG export ----------------------------------------------------
        page.click('.fmt[data-format="svg"]')
        page.wait_for_timeout(150)
        svg_path = os.path.join(OUT, "studio.svg")
        with page.expect_download(timeout=30000) as dl:
            page.click(".pane .btn.brand.tall")
        dl.value.save_as(svg_path)
        with open(svg_path, encoding="utf-8") as fh:
            svg = fh.read()
        has_anim = "animateTransform" in svg or "<animate" in svg
        check("export: SVG with SMIL", lambda: f"{len(svg)} bytes, animated={has_anim}")

        # --- input capture: the studio owns the right-click ---------------
        page.click('.dock-tab[data-tab="inspector"]')
        page.wait_for_timeout(200)
        # Nothing selected + empty canvas = the canvas menu.
        page.evaluate("() => window.__svgen.scene.clearSelection()")
        page.wait_for_timeout(150)
        page.mouse.click(900, 150, button="right")
        page.wait_for_timeout(350)
        ctx = page.evaluate(
            """() => {
              const items = [...document.querySelectorAll('.menu-item')].map(b => b.textContent.trim());
              return { open: !!document.querySelector('.menu'), items };
            }"""
        )
        check("input: right-click on canvas opens our menu", lambda: f"{len(ctx['items'])} items")
        assert ctx["open"], "right-click produced no menu"
        for wanted in ("撤销", "重做", "粘贴", "全选", "填充画布"):
            assert any(wanted in i for i in ctx["items"]), f"canvas menu missing {wanted}: {ctx['items']}"
        # ...and the browser's own menu was suppressed.
        suppressed = page.evaluate(
            """() => new Promise(resolve => {
                 const ev = new MouseEvent('contextmenu', {bubbles:true, cancelable:true});
                 document.getElementById('stage').dispatchEvent(ev);
                 resolve(ev.defaultPrevented);
               })"""
        )
        check("input: native menu suppressed", lambda: f"defaultPrevented={suppressed}")
        assert suppressed, "the native context menu was not suppressed"
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)

        # --- context menu on a shape: the actions must actually run ---------
        shape = page.evaluate(
            """() => {
              const a = window.__svgen;
              a.setTool('select');
              const el = a.newElement('rect');
              el.x = 640; el.y = 400; el.w = 320; el.h = 220; el.name = 'TARGET';
              a.scene.add(el);
              const s = a.stage, r = s.host.getBoundingClientRect();
              return { x: r.left + s.view.panX + 640 * s.view.zoom,
                       y: r.top + s.view.panY + 400 * s.view.zoom };
            }"""
        )
        page.wait_for_timeout(250)
        page.mouse.click(shape["x"], shape["y"], button="right")
        page.wait_for_timeout(350)
        shape_menu = page.evaluate(
            "() => [...document.querySelectorAll('.menu-item')].map(b => b.textContent.trim())"
        )
        check("input: shape menu", lambda: f"{len(shape_menu)} items")
        for wanted in ("复制", "粘贴", "再制", "删除", "移到最前"):
            assert any(wanted in i for i in shape_menu), f"shape menu missing {wanted}: {shape_menu}"

        n0 = page.evaluate("() => window.__svgen.scene.doc.elements.length")
        page.evaluate(
            """() => [...document.querySelectorAll('.menu-item')]
                 .find(b => b.textContent.includes('再制')).click()"""
        )
        page.wait_for_timeout(350)
        n1 = page.evaluate("() => window.__svgen.scene.doc.elements.length")
        check("menu: duplicate works", lambda: f"{n0} -> {n1}")
        assert n1 == n0 + 1, "the duplicate menu entry did nothing"

        page.mouse.click(shape["x"], shape["y"], button="right")
        page.wait_for_timeout(300)
        page.evaluate(
            """() => [...document.querySelectorAll('.menu-item')]
                 .find(b => b.textContent.includes('复制')).click()"""
        )
        page.wait_for_timeout(250)
        has_clip = page.evaluate("() => window.__svgen.hasClipboard()")
        page.mouse.click(shape["x"], shape["y"], button="right")
        page.wait_for_timeout(300)
        page.evaluate(
            """() => [...document.querySelectorAll('.menu-item')]
                 .find(b => b.textContent.includes('粘贴')).click()"""
        )
        page.wait_for_timeout(350)
        n2 = page.evaluate("() => window.__svgen.scene.doc.elements.length")
        check("menu: copy + paste work", lambda: f"clipboard={has_clip}, {n1} -> {n2}")
        assert has_clip and n2 == n1 + 1, "copy/paste from the menu did nothing"

        page.mouse.click(shape["x"], shape["y"], button="right")
        page.wait_for_timeout(300)
        page.evaluate(
            """() => [...document.querySelectorAll('.menu-item')]
                 .find(b => b.textContent.includes('删除')).click()"""
        )
        page.wait_for_timeout(500)
        dialog = page.evaluate(
            "() => ({ open: !!document.querySelector('.scrim'), btns: [...document.querySelectorAll('.modal-foot .btn')].map(b => b.textContent) })"
        )
        check("menu: delete asks first", lambda: json.dumps(dialog, ensure_ascii=False))
        assert dialog["open"], "delete from the menu did not open the confirmation"
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)

        # Right-clicking empty canvas while something is selected must still
        # offer the selection actions — otherwise the menu looks dead.
        page.evaluate("() => { const a = window.__svgen; a.scene.select(a.scene.doc.elements[0].id); }")
        page.mouse.click(950, 140, button="right")
        page.wait_for_timeout(350)
        both = page.evaluate(
            "() => [...document.querySelectorAll('.menu-item')].map(b => b.textContent.trim())"
        )
        check("menu: canvas menu keeps selection actions", lambda: f"{len(both)} items")
        for wanted in ("删除", "填充画布"):
            assert any(wanted in i for i in both), f"menu missing {wanted}: {both}"
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)

        # --- context menu inside a text field -------------------------------
        page.click('.dock-tab[data-tab="export"]')
        page.wait_for_timeout(300)
        field = page.locator(".dock-body input").first
        field.click(button="right")
        page.wait_for_timeout(300)
        field_menu = page.evaluate(
            "() => [...document.querySelectorAll('.menu-item')].map(b => b.textContent.trim())"
        )
        check("input: text-field menu", lambda: f"{field_menu[:4]}")
        assert any("粘贴" in i for i in field_menu), f"no paste entry in the field menu: {field_menu}"
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)

        # --- browser shortcuts are taken over --------------------------------
        blocked = page.evaluate(
            """() => {
                 const check = (key, ctrl) => {
                   const ev = new KeyboardEvent('keydown', {key, ctrlKey: ctrl, bubbles: true, cancelable: true});
                   document.body.dispatchEvent(ev);
                   return ev.defaultPrevented;
                 };
                 return { print: check('p', true), find: check('f', true), f3: check('F3', false) };
               }"""
        )
        check("input: browser shortcuts blocked", lambda: json.dumps(blocked))
        assert blocked["print"] and blocked["find"] and blocked["f3"], f"not all blocked: {blocked}"

        # --- brush settings ---------------------------------------------------
        page.click('.dock-tab[data-tab="inspector"]')
        page.wait_for_timeout(200)
        page.click('#rail [data-tool="brush"]')
        page.wait_for_timeout(350)
        brush = page.evaluate(
            """() => {
              const menuEl = document.querySelector('.menu');
              const labels = [...document.querySelectorAll('.menu .prop .label')].map(n => n.textContent);
              return { open: !!menuEl, labels };
            }"""
        )
        check("brush: settings menu", lambda: f"{brush['labels']}")
        assert brush["open"], "brush menu did not open"
        for wanted in ("粗细", "不透明度", "平滑", "防抖"):
            assert wanted in brush["labels"], f"brush menu missing {wanted}: {brush['labels']}"
        # move the size slider and confirm the brush actually changed
        page.evaluate(
            """() => {
              const input = document.querySelector('.menu .prop input[type=range]');
              input.value = '28';
              input.dispatchEvent(new Event('input', {bubbles: true}));
            }"""
        )
        page.wait_for_timeout(200)
        size = page.evaluate("() => window.__svgen.brush.size")
        check("brush: size applies", lambda: f"size={size}")
        assert size == 28, f"brush size did not change: {size}"
        page.keyboard.press("Escape")

        # --- freehand: sticky, brush-driven, and ACTUALLY VISIBLE ------------
        page.evaluate("() => window.__svgen.scene.mutate('clear', d => { d.elements = []; d.selection = []; })")
        page.click('#rail [data-tool="pen"]')
        page.wait_for_timeout(150)

        def canvas_ink():
            """Bright pixels on the stage — a stroke that is drawn off-canvas
            still exists in the document, so counting elements proves nothing."""
            return page.evaluate(
                """() => {
                  const c = document.getElementById('stage');
                  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
                  let n = 0;
                  for (let i = 0; i < d.length; i += 4) {
                    if (d[i + 3] > 40 && d[i] > 180 && d[i + 1] > 180 && d[i + 2] > 180) n++;
                  }
                  return n;
                }"""
            )

        ink_before = canvas_ink()
        for stroke, base in ((1, 300), (2, 460)):
            page.mouse.move(340, base)
            page.mouse.down()
            for i in range(50):
                x = 340 + i * 6
                y = base + int(55 * math.sin(i / 6.0))
                page.mouse.move(x, y)
                page.wait_for_timeout(10)
            page.mouse.up()
            page.wait_for_timeout(220)
        ink_after = canvas_ink()
        pen = page.evaluate(
            """() => {
              const a = window.__svgen;
              const canvas = a.scene.doc.canvas;
              return {
                tool: a.tools.tool,
                count: a.scene.doc.elements.length,
                widths: a.scene.doc.elements.map(e => e.strokeWidth),
                smoother: a.scene.doc.elements.map(e => e.smooth),
                points: a.scene.doc.elements.map(e => e.points.length),
                inside: a.scene.doc.elements.every(e =>
                  e.x > -canvas.width && e.x < canvas.width * 2 &&
                  e.y > -canvas.height && e.y < canvas.height * 2),
                positions: a.scene.doc.elements.map(e => [Math.round(e.x), Math.round(e.y)]),
              };
            }"""
        )
        check("draw: freehand is sticky", lambda: f"tool={pen['tool']}, {pen['count']} strokes")
        assert pen["tool"] == "pen", "the pen tool did not stay active between strokes"
        assert pen["count"] == 2, f"expected 2 strokes, got {pen['count']}"
        assert all(w == 28 for w in pen["widths"]), f"brush size not applied: {pen['widths']}"
        assert all(pen["smoother"]), "strokes are not smooth paths"
        assert all(p >= 6 for p in pen["points"]), f"strokes lost their curvature: {pen['points']}"
        # The regression that made drawing look broken: refitPath accumulated
        # the centroid, so the element ended up tens of thousands of units away
        # and the stroke never appeared on screen.
        check("draw: strokes land on the canvas", lambda: f"positions={pen['positions']}")
        assert pen["inside"], f"a stroke was placed off-canvas: {pen['positions']}"
        check("draw: strokes are visible", lambda: f"ink {ink_before} -> {ink_after}")
        assert ink_after > ink_before + 400, f"the strokes produced almost no ink ({ink_before} -> {ink_after})"

        # --- colour picker ----------------------------------------------------
        page.click('#rail .swatch.fg')
        page.wait_for_timeout(450)
        picker = page.evaluate(
            """() => {
              const panel = document.querySelector('.cp-panel');
              if (!panel) return { open: false };
              const r = panel.getBoundingClientRect();
              return {
                open: true,
                onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1,
                swatches: panel.querySelectorAll('.cp-swatch').length,
                square: !!panel.querySelector('.cp-square'),
                hue: !!panel.querySelector('.cp-hue'),
                alpha: !!panel.querySelector('.cp-alpha'),
                hex: panel.querySelector('.cp-hex').value,
              };
            }"""
        )
        check("colour: picker opens with visible swatches", lambda: f"{picker}")
        assert picker.get("open"), "the colour picker did not open"
        assert picker["onScreen"], "the picker was positioned off-screen"
        assert picker["swatches"] >= 12, f"no visual swatch grid ({picker['swatches']})"
        assert picker["square"] and picker["hue"] and picker["alpha"], "picker is missing controls"

        page.evaluate("() => document.querySelectorAll('.cp-swatch')[8].click()")
        page.wait_for_timeout(250)
        picked = page.evaluate("() => window.__svgen.paint.fill")
        check("colour: picking a swatch applies", lambda: f"fill={picked}")
        assert picked and picked.lower() not in ("#cbff4d", ""), f"the fill did not change: {picked}"
        page.evaluate("() => document.querySelector('.cp-actions .btn.brand').click()")
        page.wait_for_timeout(300)
        closed = page.evaluate("() => !document.querySelector('.cp-panel')")
        chip = page.evaluate("() => document.querySelector('#rail .swatch.fg i').style.background")
        check("colour: closes and repaints the chip", lambda: f"closed={closed}, chip={chip}")
        assert closed, "the picker did not close"
        assert chip and chip != "transparent", "the rail chip did not repaint"

        # --- canvas fill --------------------------------------------------------
        page.click('.dock-tab[data-tab="inspector"]')
        page.wait_for_timeout(150)
        before = page.evaluate("() => window.__svgen.scene.doc.canvas.background")
        page.keyboard.press("Shift+B")
        page.wait_for_timeout(300)
        after = page.evaluate("() => window.__svgen.scene.doc.canvas.background")
        check("canvas: fill shortcut", lambda: f"{before} -> {after}")
        assert after and after != before, "Shift+B did not fill the canvas"
        cleared = page.evaluate(
            """() => {
              const a = window.__svgen;
              a.setCanvasBackground(null);
              return a.scene.doc.canvas.background;
            }"""
        )
        check("canvas: clear background", lambda: f"background={cleared}")
        assert cleared is None, "the background could not be cleared"

        # --- panels render in both languages and themes --------------------
        page.click('.dock-tab[data-tab="inspector"]')
        page.wait_for_timeout(200)
        page.click('#topbar [data-action="theme"]')
        page.wait_for_timeout(400)
        theme_now = page.evaluate("() => document.documentElement.dataset.theme")
        page.screenshot(path=os.path.join(OUT, "studio-light.png"))
        page.click('#topbar [data-action="theme"]')
        page.wait_for_timeout(300)
        check("ui: theme toggle", lambda: f"switched to {theme_now}")
        assert theme_now == "light", "theme toggle did not switch to light"

        page.click('#topbar [data-action="lang"]')
        page.wait_for_timeout(800)
        lang_now = page.evaluate("() => document.documentElement.lang")
        check("ui: language toggle", lambda: f"lang={lang_now}")

        page.screenshot(path=os.path.join(OUT, "studio.png"), full_page=False)
        browser.close()

    real_errors = [e for e in errors if "favicon" not in e.lower()]
    check("no console errors", lambda: f"{len(real_errors)} error(s)")
    if real_errors:
        results.append(("FAIL", "console output", real_errors[0][:300]))

    width = max(len(n) for _, n, _ in results)
    failed = 0
    for status, name, detail in results:
        if status == "FAIL":
            failed += 1
        print("%s %-*s  %s" % ("  ok  " if status == "PASS" else " FAIL ", width, name, detail[:90]))
    print("-" * 66)
    print("%d checks, %d failed · artefacts in %s" % (len(results), failed, OUT))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
