"""OS / architecture detection and a platform-appropriate filesystem layer.

Requirement: "first auto-detect which system architecture this runs on
(Win / Linux / mac ...) and then use that system's FS method."
"""

import os
import sys
import glob
import shutil
import tempfile
import platform as _platform
from pathlib import Path

from .logs import log

WINDOWS = os.name == "nt"
LINUX = os.name == "posix" and _platform.system() == "Linux"
MACOS = os.name == "posix" and _platform.system() == "Darwin"
POSIX = os.name == "posix"


def ensure_console_utf8():
    """Windows consoles are often cp936/cp1252 — force UTF-8 so Unicode logs
    and SVG text survive round trips."""
    if WINDOWS:
        try:
            os.system("")
        except Exception:
            pass
    if WINDOWS and sys.platform != "pypy":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
        try:
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def detect() -> dict:
    """Return a dict describing the current platform."""
    return {
        "os": _platform.system(),
        "os_version": _platform.release(),
        "arch": _platform.machine() or _platform.processor(),
        "cpu_bits": struct_size(),
        "python": sys.version.split()[0],
        "is_windows": WINDOWS,
        "is_linux": LINUX,
        "is_macos": MACOS,
        "fs": "win32" if WINDOWS else ("posix" if POSIX else "other"),
        "host": _platform.node(),
    }


def struct_size() -> int:
    """Return 64 or 32 based on the Python interpreter's pointer size."""
    import struct
    return struct.calcsize("P") * 8


# --------------------------------------------------------------------------
# Platform-appropriate filesystem helpers.  Everything goes through `fs` so
# path/encoding/temp decisions are made once per detected platform.
# --------------------------------------------------------------------------


class PlatformFS:
    def __init__(self):
        self.is_windows = WINDOWS
        self.is_posix = POSIX
        self.sep = os.sep
        self.path = os.path if WINDOWS else os.path

    # -- paths ------------------------------------------------------------
    def home(self) -> str:
        return str(Path.home())

    def config_dir(self) -> str:
        return os.path.join(self.home(), ".svgen")

    def temp_dir(self) -> str:
        """Use the OS-native temp location (Temp on Win, /tmp elsewhere)."""
        return tempfile.gettempdir()

    def temp_file(self, suffix: str) -> str:
        fd, path = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        return path

    def join(self, *parts) -> str:
        return os.path.join(*parts)

    def norm(self, path: str) -> str:
        return os.path.normpath(path)

    def abspath(self, path: str) -> str:
        return os.path.abspath(path)

    # -- io ---------------------------------------------------------------
    def exists(self, path: str) -> bool:
        return os.path.exists(path)

    def isfile(self, path: str) -> bool:
        return os.path.isfile(path)

    def isdir(self, path: str) -> bool:
        return os.path.isdir(path)

    def read_text(self, path: str) -> str:
        with open(path, "r", encoding="utf-8-sig", errors="replace") as fh:
            return fh.read()

    def write_text(self, path: str, text: str):
        os.makedirs(os.path.dirname(path), exist_ok=True) if os.path.dirname(path) else None
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)

    def read_bytes(self, path: str) -> bytes:
        with open(path, "rb") as fh:
            return fh.read()

    def write_bytes(self, path: str, data: bytes):
        with open(path, "wb") as fh:
            fh.write(data)

    def makedirs(self, path: str, exist_ok=True):
        os.makedirs(path, exist_ok=exist_ok)

    def listdir(self, path: str):
        try:
            return os.listdir(path)
        except OSError:
            return []

    def unlink(self, path: str):
        try:
            os.unlink(path)
        except OSError:
            pass


fs = PlatformFS()


# --------------------------------------------------------------------------
# Locate helper executables (ffmpeg, chrome/chromium/edge) per platform.
# --------------------------------------------------------------------------

_CHROME_CANDIDATES = {
    "win": [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ],
    "mac": [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
    "linux": [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
    ],
}


def find_executable(names, extra_paths=()):
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    for p in extra_paths:
        if os.path.isfile(p):
            return p
    # cross-platform wildcard search (Win/Linux/Mac aware)
    if WINDOWS:
        for pattern in (r"C:\Program Files\*\chrome.exe", r"C:\Program Files\*\msedge.exe",
                        r"C:\Program Files (x86)\*\chrome.exe", r"C:\Program Files (x86)\*\msedge.exe"):
            for match in glob.glob(pattern):
                if os.path.isfile(match):
                    return match
    for p in extra_paths:
        if shutil.which(p):
            return shutil.which(p)
    return None


def find_ffmpeg():
    return find_executable(["ffmpeg"])


def find_chrome():
    key = "win" if WINDOWS else ("mac" if MACOS else "linux")
    return find_executable([], _CHROME_CANDIDATES.get(key, []))


def find_firefox():
    """Locate a Firefox / Gecko binary for headless rendering."""
    candidates = []
    if WINDOWS:
        candidates += [
            r"C:\Program Files\Mozilla Firefox\firefox.exe",
            r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
            os.path.expandvars(r"%LOCALAPPDATA%\Mozilla Firefox\firefox.exe"),
        ]
        for pattern in (r"C:\Program Files\Mozilla Firefox\firefox.exe",
                        r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe"):
            for match in glob.glob(pattern):
                if os.path.isfile(match) and match not in candidates:
                    candidates.append(match)
    elif MACOS:
        candidates += [
            "/Applications/Firefox.app/Contents/MacOS/firefox",
            "/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox",
        ]
    else:
        candidates += ["/usr/bin/firefox", "/usr/bin/firefox-esr", "/snap/bin/firefox"]
    return find_executable(["firefox", "firefox-esr"], candidates)


def find_browsers():
    return {"chrome": find_chrome(), "firefox": find_firefox()}


def capabilities() -> dict:
    """Which renderers / tools are usable on this machine."""
    from . import __version__  # noqa: F401
    rust = False
    rust_info = None
    try:
        from . import rslib
        rust = rslib.available()
        rust_info = rslib.info()
    except Exception:
        pass
    return {
        "ffmpeg": bool(find_ffmpeg()),
        "ffmpeg_path": find_ffmpeg(),
        "chrome": bool(find_chrome()),
        "chrome_path": find_chrome(),
        "firefox": bool(find_firefox()),
        "firefox_path": find_firefox(),
        "pillow": _pillow_ok(),
        "rust": rust,
        "rust_info": rust_info,
        "engine": "chrome" if find_chrome() else ("firefox" if find_firefox() else ("rust" if rust else "raster")),
    }


def _pillow_ok():
    try:
        import PIL  # noqa: F401
        return True
    except Exception:
        return False


def init() -> dict:
    ensure_console_utf8()
    info = detect()
    log.debug("platform detected: %s" % info)
    return info


def guess_output_path(input_path: str, fmt: str) -> str:
    base = os.path.splitext(input_path or "out")[0]
    return "%s.%s" % (base, fmt)
