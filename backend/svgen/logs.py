"""Tiny toggle-able logger.

The whole point: logs can be switched on/off at runtime (CLI `svgen logs on|off`
or the /api/logs endpoint) so the backend stays quiet in normal use and verbose
when debugging.
"""

import os
import sys
import json
import time

# Levels: 0 quiet, 1 info, 2 debug
LEVELS = {"quiet": 0, "info": 1, "debug": 2}

_CONFIG_DIR = None
_CONFIG_FILE = None


def _config_path():
    global _CONFIG_DIR, _CONFIG_FILE
    if _CONFIG_DIR is None:
        home = os.path.expanduser("~")
        _CONFIG_DIR = os.path.join(home, ".svgen")
        _CONFIG_FILE = os.path.join(_CONFIG_DIR, "config.json")
    return _CONFIG_FILE


def load_defaults():
    """Read the persisted on/off preference (if any)."""
    try:
        with open(_config_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return bool(data.get("logs_enabled", True))
    except Exception:
        return True


def save_defaults(enabled):
    try:
        os.makedirs(os.path.dirname(_config_path()), exist_ok=True)
        data = {}
        try:
            with open(_config_path(), "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:
            data = {}
        data["logs_enabled"] = bool(enabled)
        with open(_config_path(), "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
    except Exception:
        pass


class _Log:
    def __init__(self):
        self.enabled = load_defaults()
        self.level = LEVELS["info"]
        self._color = hasattr(sys.stdout, "isatty") and sys.stdout.isatty()

    # ---- runtime toggling -------------------------------------------------
    def set_enabled(self, on):
        self.enabled = bool(on)
        save_defaults(self.enabled)

    def set_level(self, level):
        if isinstance(level, str):
            level = LEVELS.get(level.lower(), LEVELS["info"])
        self.level = level

    # ---- output -----------------------------------------------------------
    def _emit(self, tag, color, msg):
        if not self.enabled:
            return
        ts = time.strftime("%H:%M:%S")
        prefix = "[%s %s] " % (ts, tag)
        if self._color:
            prefix = "\033[%sm%s\033[0m" % (color, prefix)
        try:
            print(prefix + msg, file=sys.stderr)
        except Exception:
            pass

    def info(self, msg):
        if self.level >= 1:
            self._emit("INFO", "36", msg)

    def warn(self, msg):
        if self.level >= 1:
            self._emit("WARN", "33", msg)

    def error(self, msg):
        if self.level >= 0:
            self._emit("ERROR", "31", msg)

    def debug(self, msg):
        if self.level >= 2:
            self._emit("DEBUG", "90", msg)


log = _Log()
