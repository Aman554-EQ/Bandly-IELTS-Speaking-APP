"""
Bandly examiner voice renderer (admin-side, offline).

Renders every examiner line in tools/voice/lines.json to a small MP3 in
public/voice/ and writes public/voice/manifest.json. Students never trigger
speech generation: the app only plays these files.

Engines
  kokoro (default)  Open-source Kokoro-82M, British voice "bf_emma". Unlimited, free.
  groq              Groq Orpheus TTS (preview model, low free quota). Backup only.

Clips are content-addressed: the file name contains a hash of
(engine, voice, speed, text). Unchanged lines are never re-rendered.

Usage (from the repo root, with the venv active):
  python tools/voice/render.py                    # render missing/changed clips
  python tools/voice/render.py --force            # re-render everything
  python tools/voice/render.py --only p2.         # only keys starting with "p2."
  python tools/voice/render.py --audition         # sample sentence in every British voice
  python tools/voice/render.py --engine groq      # use Groq Orpheus instead (needs GROQ_API_KEY)
  python tools/voice/render.py --prune            # delete clips no longer referenced
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
LINES_FILE = ROOT / "tools" / "voice" / "lines.json"
MODELS_DIR = ROOT / "tools" / "voice" / "models"
OUT_DIR = ROOT / "public" / "voice"
MANIFEST = OUT_DIR / "manifest.json"
AUDITION_DIR = ROOT / "tools" / "voice" / "audition"

SAMPLE_RATE_OUT = 24_000
SENTENCE_GAP_S = 0.25
LEAD_IN_S = 0.05
TAIL_S = 0.15
GROQ_TTS_URL = "https://api.groq.com/openai/v1/audio/speech"
GROQ_TTS_MODEL = "canopylabs/orpheus-v1-english"
GROQ_MAX_CHARS = 190  # Orpheus accepts < 200 characters per request


@dataclass
class Settings:
    engine: str
    voice: str
    speed: float


def load_env() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for name in (".env.local", ".env"):
        p = ROOT / name
        if p.exists():
            load_dotenv(p, override=False)


def clip_hash(text: str, s: Settings) -> str:
    raw = f"{s.engine}|{s.voice}|{s.speed:.2f}|{text}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:10]


def safe_key(key: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "-", key)


def split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.?!])\s+", text.strip())
    return [p for p in parts if p]


def silence(seconds: float, sr: int) -> np.ndarray:
    return np.zeros(int(sr * seconds), dtype=np.float32)


# --------------------------------------------------------------------- engines


class KokoroEngine:
    def __init__(self) -> None:
        from kokoro_onnx import Kokoro

        model = MODELS_DIR / "kokoro-v1.0.onnx"
        voices = MODELS_DIR / "voices-v1.0.bin"
        if not model.exists() or not voices.exists():
            sys.exit(
                "Kokoro model files are missing. Download them with:\n"
                "  python tools/voice/download_models.py"
            )
        self.k = Kokoro(str(model), str(voices))

    def voices(self) -> list[str]:
        return list(self.k.get_voices())

    def render(self, text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
        chunks: list[np.ndarray] = []
        sr = SAMPLE_RATE_OUT
        for i, sentence in enumerate(split_sentences(text)):
            samples, sr = self.k.create(sentence, voice=voice, speed=speed, lang="en-gb")
            if i > 0:
                chunks.append(silence(SENTENCE_GAP_S, sr))
            chunks.append(np.asarray(samples, dtype=np.float32))
        return np.concatenate(chunks), sr


class GroqEngine:
    """Backup engine. Orpheus is a preview model with a very low free quota."""

    def __init__(self) -> None:
        import requests

        self.requests = requests
        self.key = os.environ.get("GROQ_API_KEY", "")
        if not self.key or self.key.startswith("gsk_your"):
            sys.exit("GROQ_API_KEY is not set (add it to .env.local).")

    def _chunks(self, text: str) -> list[str]:
        out: list[str] = []
        for sentence in split_sentences(text):
            while len(sentence) > GROQ_MAX_CHARS:
                cut = sentence.rfind(",", 0, GROQ_MAX_CHARS)
                cut = cut if cut > 40 else sentence.rfind(" ", 0, GROQ_MAX_CHARS)
                out.append(sentence[: cut + 1].strip())
                sentence = sentence[cut + 1 :].strip()
            out.append(sentence)
        return out

    def render(self, text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
        chunks: list[np.ndarray] = []
        sr = SAMPLE_RATE_OUT
        for i, part in enumerate(self._chunks(text)):
            for attempt in range(4):
                r = self.requests.post(
                    GROQ_TTS_URL,
                    headers={"Authorization": f"Bearer {self.key}"},
                    json={"model": GROQ_TTS_MODEL, "voice": voice, "input": part, "response_format": "wav"},
                    timeout=60,
                )
                if r.status_code == 429 and attempt < 3:
                    wait = float(r.headers.get("retry-after", 2 ** (attempt + 1)))
                    print(f"    rate limited, waiting {wait:.0f}s")
                    time.sleep(wait)
                    continue
                if r.status_code >= 400:
                    raise RuntimeError(f"Groq TTS {r.status_code}: {r.text[:200]}")
                break
            data, sr = sf.read(io.BytesIO(r.content), dtype="float32")
            if data.ndim > 1:
                data = data.mean(axis=1)
            if i > 0:
                chunks.append(silence(SENTENCE_GAP_S, sr))
            chunks.append(data)
        return np.concatenate(chunks), sr


# ------------------------------------------------------------------- encoding

TARGET_RMS_DBFS = -18.0   # ≈ -16 LUFS for speech
PEAK_CEILING_DBFS = -1.5


def resample(samples: np.ndarray, sr: int, target: int) -> np.ndarray:
    if sr == target:
        return samples
    n = int(round(len(samples) * target / sr))
    x_old = np.linspace(0.0, 1.0, num=len(samples), endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n, endpoint=False)
    return np.interp(x_new, x_old, samples).astype(np.float32)


def normalise(samples: np.ndarray, sr: int) -> np.ndarray:
    """Gated RMS loudness normalisation + peak ceiling, so every clip has the same volume."""
    frame = max(1, int(sr * 0.05))
    usable = samples[: len(samples) - len(samples) % frame]
    if usable.size == 0:
        return samples
    rms = np.sqrt(np.mean(usable.reshape(-1, frame) ** 2, axis=1) + 1e-12)
    active = rms[20 * np.log10(rms) > -50]  # ignore silence between sentences
    if active.size == 0:
        return samples
    current = 20 * np.log10(np.sqrt(np.mean(active ** 2)))
    out = samples * (10 ** ((TARGET_RMS_DBFS - current) / 20))
    peak = float(np.max(np.abs(out))) or 1.0
    ceiling = 10 ** (PEAK_CEILING_DBFS / 20)
    if peak > ceiling:
        out = out * (ceiling / peak)
    return out.astype(np.float32)


def encode_mp3(samples: np.ndarray, sr: int, out: Path) -> None:
    """Pad, normalise and encode a 48 kbps mono MP3 (pure Python via LAME; no ffmpeg needed)."""
    import lameenc

    audio = resample(samples, sr, SAMPLE_RATE_OUT)
    audio = np.concatenate([silence(LEAD_IN_S, SAMPLE_RATE_OUT), audio, silence(TAIL_S, SAMPLE_RATE_OUT)])
    audio = normalise(audio, SAMPLE_RATE_OUT)
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(SAMPLE_RATE_OUT)
    enc.set_channels(1)
    enc.set_quality(2)
    out.write_bytes(enc.encode(pcm) + enc.flush())


# ----------------------------------------------------------------------- main


def load_manifest(out_dir: Path) -> dict:
    f = out_dir / "manifest.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    return {"clips": {}}


def audition(engine: KokoroEngine, speed: float) -> None:
    AUDITION_DIR.mkdir(parents=True, exist_ok=True)
    text = (
        "Good morning. My name is Emma Hayes, and I will be your examiner today. "
        "Now, I'm going to give you a topic, and I'd like you to talk about it for one to two minutes."
    )
    for v in [v for v in engine.voices() if v.startswith(("bf_", "bm_"))]:
        samples, sr = engine.render(text, v, speed)
        out = AUDITION_DIR / f"{v}.mp3"
        encode_mp3(samples, sr, out)
        print(f"  {out.relative_to(ROOT)}")
    print("Listen and pick a voice, then set it in src/engine/examiners.ts (kokoroVoice).")


def render_examiner(examiner: dict, settings: Settings, engine, args) -> int:
    """Renders one examiner's lines into public/voice/<id>/. Returns the number of failures."""
    out_dir = OUT_DIR / examiner["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    lines = examiner["lines"]
    manifest = load_manifest(out_dir)
    clips: dict = manifest.get("clips", {})

    todo = []
    for ln in lines:
        key, text = ln["key"], ln["text"]
        if args.only and not key.startswith(args.only):
            continue
        h = clip_hash(text, settings)
        entry = clips.get(key)
        file_ok = entry and (out_dir / entry["file"]).exists()
        if not args.force and entry and entry.get("hash") == h and file_ok:
            continue
        todo.append((key, text, h))

    print()
    print(f"{examiner['name']} ({examiner['id']}): {len(lines)} lines · {len(todo)} to render · "
          f"engine={settings.engine} voice={settings.voice}")

    failures = 0
    for n, (key, text, h) in enumerate(todo, 1):
        name = f"{safe_key(key)}.{h}.mp3"
        try:
            t0 = time.time()
            samples, sr = engine.render(text, settings.voice, settings.speed)
            encode_mp3(samples, sr, out_dir / name)
            old = clips.get(key)
            if old and old.get("file") != name and (out_dir / old["file"]).exists():
                (out_dir / old["file"]).unlink()
            clips[key] = {
                "file": name,
                "hash": h,
                "text": text,
                "durationMs": int(round((len(samples) / sr + LEAD_IN_S + TAIL_S) * 1000)),
                "engine": settings.engine,
                "voice": settings.voice,
            }
            print(f"  [{n}/{len(todo)}] {key}  ({time.time() - t0:.1f}s)")
        except Exception as e:  # keep going; the app falls back to the browser voice
            failures += 1
            print(f"  [{n}/{len(todo)}] FAILED {key}: {e}")

    if args.prune:
        keys = {ln["key"] for ln in lines}
        for key in [k for k in clips if k not in keys]:
            f = out_dir / clips[key]["file"]
            if f.exists():
                f.unlink()
            del clips[key]
        referenced = {c["file"] for c in clips.values()}
        for f in out_dir.glob("*.mp3"):
            if f.name not in referenced:
                f.unlink()

    manifest = {
        "version": 1,
        "examiner": {"id": examiner["id"], "name": examiner["name"], "engine": settings.engine, "voice": settings.voice},
        "clips": dict(sorted(clips.items())),
    }
    manifest_text = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    (out_dir / "manifest.json").write_text(manifest_text, encoding="utf-8")
    total_kb = sum((out_dir / c["file"]).stat().st_size for c in clips.values() if (out_dir / c["file"]).exists()) / 1024
    print(f"  manifest: {len(clips)} clips, {total_kb:.0f} KB. Failures: {failures}")
    return failures


def main() -> None:
    load_env()
    ap = argparse.ArgumentParser(description="Render Bandly examiner voice clips.")
    ap.add_argument("--engine", choices=["kokoro", "groq"], default="kokoro")
    ap.add_argument("--examiner", default=None, help="Only this examiner id (emma, james)")
    ap.add_argument("--voice", default=None, help="Override the voice (kokoro voice id, or groq: hannah/troy/…)")
    ap.add_argument("--speed", type=float, default=0.94, help="Kokoro speed (examiner pace ≈ 0.92–0.95)")
    ap.add_argument("--only", default=None, help="Only render keys starting with this prefix")
    ap.add_argument("--force", action="store_true", help="Re-render even if unchanged")
    ap.add_argument("--prune", action="store_true", help="Delete clip files no longer referenced")
    ap.add_argument("--audition", action="store_true", help="Render a sample in every British Kokoro voice")
    args = ap.parse_args()

    if args.audition:
        audition(KokoroEngine(), args.speed)
        return

    if not LINES_FILE.exists():
        sys.exit("tools/voice/lines.json not found. Run `pnpm voice:lines` first.")
    data = json.loads(LINES_FILE.read_text(encoding="utf-8"))
    examiners = [e for e in data["examiners"] if not args.examiner or e["id"] == args.examiner]
    engine = KokoroEngine() if args.engine == "kokoro" else GroqEngine()

    failures = 0
    for ex in examiners:
        voice = args.voice or (ex["voice"] if args.engine == "kokoro" else ("hannah" if ex["id"] == "emma" else "troy"))
        settings = Settings(engine=args.engine, voice=voice, speed=args.speed if args.engine == "kokoro" else 1.0)
        failures += render_examiner(ex, settings, engine, args)
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
