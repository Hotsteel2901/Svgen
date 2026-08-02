"""Command-line interface. The backend works fully standalone:

    svgen info
    svgen validate file.svg
    svgen render file.svg -f png|jpg|bmp|webp|gif|mp4|webm [--width W] [--height H]
    svgen render - < input.svg -f png -o out.png
    svgen serve [--host H] [--port P] [--static DIR] [--open] [--logs on|off]
    svgen logs on|off
"""

import argparse
import os
import sys
import webbrowser

from . import platform, __version__
from .logs import log
from .platform import fs
from . import renderer, animate


def cmd_info(args):
    info = platform.detect()
    caps = platform.capabilities()
    print("SVGen backend %s" % __version__)
    print("=" * 46)
    print("  OS              : %s (%s)" % (info["os"], info["os_version"]))
    print("  Architecture    : %s (%d-bit)" % (info["arch"], info["cpu_bits"]))
    print("  Filesystem mode : %s" % info["fs"])
    print("  Python          : %s" % info["python"])
    print("  Hostname        : %s" % info["host"])
    print("  ffmpeg          : %s" % (caps["ffmpeg_path"] or "not found"))
    print("  Chrome/Edge     : %s" % (caps["chrome_path"] or "not found"))
    print("  Firefox/Gecko   : %s" % (caps.get("firefox_path") or "not found"))
    print("  Rust engine     : %s" % (caps["rust_info"]["path"] if caps.get("rust") else "not built (run: svgen build-rs)"))
    print("  Pillow          : %s" % ("yes" if caps["pillow"] else "no"))
    print("  default engine  : %s" % caps["engine"])


def cmd_validate(args):
    svg_text = fs.read_text(args.input)
    result = _validate_svg(svg_text)
    if not result.get("ok"):
        print("INVALID: %s" % result["error"], file=sys.stderr)
        return 1
    print("OK  (%d XML elements)" % result.get("elements", 0))
    if result["animations"]:
        print("Animation timeline:")
        for a in result["animations"]:
            print("  - %s (%s) dur=%gs begin=%gs keyTimes=%s" % (
                a["attribute"], a["type"], a["dur"], a["begin"], a["keyTimes"]))
        print("Total duration: %gs" % result["duration"])
    else:
        print("No animation (static image).")
    return 0


def _validate_svg(svg_text):
    import xml.etree.ElementTree as ET
    result = animate.timeline_info(svg_text)
    if not result.get("ok"):
        return result
    try:
        root = ET.fromstring(svg_text)
        count = len([e for e in root.iter()])
        result["elements"] = count
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    return result


def cmd_render(args):
    if args.input == "-":
        svg_text = sys.stdin.read()
        input_name = "stdin"
    else:
        svg_text = fs.read_text(args.input)
        input_name = args.input

    fmt = args.format
    if fmt in renderer.SUPPORTED_VIDEO:
        data = renderer.render_video(svg_text, fmt, args.width, args.height,
                                     args.duration, args.fps, args.background,
                                     args.engine, args.quality)
    else:
        data = renderer.render_static(svg_text, fmt, args.width, args.height,
                                      args.background, args.engine, args.quality)

    out = args.output or platform.guess_output_path(input_name, fmt)
    fs.write_bytes(out, data)
    print("Wrote %s (%d bytes) [engine: %s]" % (out, len(data), "ffmpeg+chrome" if fmt in renderer.SUPPORTED_VIDEO else args.engine))
    return 0


def cmd_serve(args):
    from . import api
    if args.logs is not None:
        log.set_enabled(args.logs.lower() == "on")
    host = args.host or "127.0.0.1"
    port = args.port
    server = api.make_server(host, port, args.static)
    url = "http://%s:%d" % (host, port)
    print("SVGen studio running at %s" % url)
    print("Press Ctrl+C to stop.")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


def cmd_logs(args):
    on = args.state.lower() == "on"
    log.set_enabled(on)
    print("Logging %s." % ("enabled" if on else "disabled"))


def cmd_build_rs(args):
    import subprocess as sp
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    crate = os.path.join(here, "rust", "svgen_rs")
    if not os.path.isfile(os.path.join(crate, "Cargo.toml")):
        print("Rust crate not found at %s" % crate, file=sys.stderr)
        return 1
    cmd = ["cargo", "build", "--release"] if not args.debug else ["cargo", "build"]
    print("Building svgen_rs (%s)..." % crate)
    proc = sp.run(cmd, cwd=crate)
    if proc.returncode != 0:
        print("Build failed — is Rust (cargo) installed?", file=sys.stderr)
        return 1
    from . import rslib
    if rslib.available():
        print("Native Rust engine ready: %s" % rslib.info()["path"])
    else:
        print("Build completed but the engine could not be located at runtime.", file=sys.stderr)
        return 1
    return 0


def main(argv=None):
    platform.init()
    parser = argparse.ArgumentParser(
        prog="svgen",
        description="SVGen — SVG drawing & animation studio backend (standalone).",
        epilog="Examples:\n"
               "  svgen info\n"
               "  svgen validate art.svg\n"
               "  svgen render art.svg -f png -o out.png\n"
               "  svgen render art.svg -f mp4 --duration 2 --fps 30 -o out.mp4\n"
               "  svgen serve --port 8090 --open\n"
               "  svgen logs on\n")
    parser.add_argument("--version", action="version", version="svgen " + __version__)
    parser.add_argument("--quiet", action="store_true", help="disable all logging output")
    parser.add_argument("--verbose", action="store_true", help="enable debug logging")
    sub = parser.add_subparsers(dest="command", required=True)

    p_info = sub.add_parser("info", help="show platform / tool capabilities")
    p_info.set_defaults(func=cmd_info)

    p_val = sub.add_parser("validate", help="validate an SVG file")
    p_val.add_argument("input", help="input .svg file (use - for stdin)")
    p_val.set_defaults(func=cmd_validate)

    p_render = sub.add_parser("render", help="render an SVG to an image/video")
    p_render.add_argument("input", help="input .svg file (use - for stdin)")
    p_render.add_argument("-f", "--format", default="png", choices=sorted(
        set(renderer.SUPPORTED_STILL + renderer.SUPPORTED_VIDEO)),
        help="output format")
    p_render.add_argument("--width", type=int, default=None)
    p_render.add_argument("--height", type=int, default=None)
    p_render.add_argument("--duration", type=float, default=None, help="video length in seconds")
    p_render.add_argument("--fps", type=int, default=30, help="video frame rate")
    p_render.add_argument("--background", default=None, help="background color (hex)")
    p_render.add_argument("--engine", default="auto", choices=["auto", "chrome", "firefox", "raster", "rust"])
    p_render.add_argument("--quality", type=int, default=None, help="JPEG/MP4 quality (0-100)")
    p_render.add_argument("-o", "--output", default=None, help="output file path")
    p_render.set_defaults(func=cmd_render)

    p_serve = sub.add_parser("serve", help="start the HTTP API + front-end server")
    p_serve.add_argument("--host", default="127.0.0.1", help="bind host")
    p_serve.add_argument("--port", type=int, default=8090, help="bind port")
    p_serve.add_argument("--static", default=None, help="front-end static dir (auto-detect)")
    p_serve.add_argument("--open", action="store_true", help="open the studio in a browser")
    p_serve.add_argument("--logs", choices=["on", "off"], default=None, help="enable/disable logging")
    p_serve.set_defaults(func=cmd_serve)

    p_logs = sub.add_parser("logs", help="persist the logging on/off state")
    p_logs.add_argument("state", choices=["on", "off"])
    p_logs.set_defaults(func=cmd_logs)

    p_build = sub.add_parser("build-rs", help="compile the native Rust renderer (needs cargo)")
    p_build.add_argument("--debug", action="store_true", help="build without optimizations")
    p_build.set_defaults(func=cmd_build_rs)

    args = parser.parse_args(argv)
    if args.quiet:
        log.set_enabled(False)
    if args.verbose:
        log.set_level("debug")
    try:
        code = args.func(args)
        sys.exit(code or 0)
    except renderer.RenderError as exc:
        print("Error: %s" % exc, file=sys.stderr)
        sys.exit(1)
    except OSError as exc:
        print("Error: %s" % exc, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
