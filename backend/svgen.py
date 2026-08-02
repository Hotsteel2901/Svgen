#!/usr/bin/env python3
"""SVGen backend launcher (works from anywhere).

    python svgen.py info
    python svgen.py serve --open
    ...
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from svgen.cli import main  # noqa: E402

if __name__ == "__main__":
    main()
