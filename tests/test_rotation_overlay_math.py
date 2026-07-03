from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.skipif(not shutil.which("node"), reason="Node.js is not available")
def test_rotation_overlay_math_js():
    """Run Node-based unit tests for the pure rotation overlay geometry."""
    test_file = Path(__file__).with_suffix("") / ".." / "js" / "rotationOverlayMath.test.mjs"
    test_file = test_file.resolve()
    result = subprocess.run(
        ["node", str(test_file)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
    assert result.returncode == 0, "rotationOverlayMath JS tests failed"
