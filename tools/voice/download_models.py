"""Downloads the Kokoro-82M ONNX model and voice pack (~340 MB) into tools/voice/models/."""

from __future__ import annotations

import sys
from pathlib import Path

import requests

BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
FILES = ["kokoro-v1.0.onnx", "voices-v1.0.bin"]
DEST = Path(__file__).resolve().parent / "models"


def download(name: str) -> None:
    target = DEST / name
    if target.exists() and target.stat().st_size > 1_000_000:
        print(f"✓ {name} already present")
        return
    print(f"↓ {name}")
    with requests.get(f"{BASE}/{name}", stream=True, timeout=60) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        tmp = target.with_suffix(target.suffix + ".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
                done += len(chunk)
                if total:
                    sys.stdout.write(f"\r  {done / total:6.1%}")
                    sys.stdout.flush()
        tmp.replace(target)
    print()


if __name__ == "__main__":
    DEST.mkdir(parents=True, exist_ok=True)
    for f in FILES:
        download(f)
