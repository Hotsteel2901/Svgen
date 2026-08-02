"""SVGen — SVG drawing & animation studio backend.

A dependency-light backend written in pure Python (stdlib only) that powers the
front-end studio and also works standalone through its own CLI.
"""

__version__ = "1.0.0"
__app_name__ = "svgen"

from . import platform as _platform
from .logs import log

APP_NAME = __app_name__
VERSION = __version__
