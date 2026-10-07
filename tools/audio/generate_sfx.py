#!/usr/bin/env python3
"""Genera los sonidos PROVISIONALES del prototipo (síntesis simple, sin licencias externas) en public/assets/audio/.

No son los sonidos finales: assets.json los marca `placeholder: true` y `mode: "presentation"` los rechaza. Tampoco son los tonos
`audio.sfx.test-*` del repositorio de referencia. Para sustituirlos, reemplazar los .wav (o apuntar `audio.events` a otros recursos del
catálogo) y volver a ejecutar `npm run validate:project`.

Uso: python3 tools/audio/generate_sfx.py
"""
import hashlib, json, math, struct, wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).resolve().parents[2] / "public" / "assets" / "audio"
MANIFEST = Path(__file__).resolve().parents[2] / "public" / "assets" / "assets.json"


def tone(freq, dur, decay, partials=((1.0, 1.0),), attack=0.004, gain=1.0):
    n = int(RATE * dur)
    out = []
    for i in range(n):
        t = i / RATE
        env = min(1.0, t / attack) * math.exp(-t * decay)
        out.append(gain * env * sum(a * math.sin(2 * math.pi * freq * m * t) for m, a in partials))
    return out


def mix(*layers):
    n = max(len(l) for l in layers)
    return [sum(l[i] if i < len(l) else 0.0 for l in layers) for i in range(n)]


def at(delay, samples):
    return [0.0] * int(RATE * delay) + samples


def normalize(samples, peak=0.55):
    m = max(abs(s) for s in samples) or 1.0
    # fundido final para evitar el «clic» del corte
    fade = int(RATE * 0.02)
    samples = [s / m * peak for s in samples]
    for i in range(fade):
        samples[-1 - i] *= i / fade
    return samples


BELL = ((1.0, 1.0), (2.76, 0.5), (5.4, 0.25))
SOUNDS = {
    "click": ("Clic suave de la linterna (provisional)", normalize(tone(1400, 0.07, 70, gain=1.0), 0.35)),
    "bell": ("Campanita (provisional)", normalize(tone(880, 1.1, 4.2, BELL))),
    "piece": ("Pieza conseguida (provisional)", normalize(mix(tone(659.3, 0.7, 5, BELL[:2]), at(0.16, tone(987.8, 0.8, 4.5, BELL[:2]))))),
    "inventor": ("Inventor encendido (provisional)", normalize(mix(*[at(0.15 * k, tone(f, 0.9, 4.0, BELL[:2])) for k, f in enumerate([523.3, 659.3, 784.0, 1046.5])]))),
    "finished": ("Final de la aventura (provisional)", normalize(mix(*[tone(f, 2.0, 1.6, ((1.0, 1.0), (2.0, 0.3)), attack=0.08) for f in [523.3, 659.3, 784.0, 1046.5]]))),
}

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
OUT.mkdir(parents=True, exist_ok=True)
for name, (label, samples) in SOUNDS.items():
    path = OUT / f"{name}.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples))
    data = path.read_bytes()
    manifest["assets"][f"lab.audio.{name}"] = {
        "path": f"audio/{name}.wav",
        "type": "audio",
        "format": "wav",
        "category": "audio",
        "label": label,
        "kind": "sfx",
        "sizeBytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "durationMs": round(len(samples) / RATE * 1000),
        "placeholder": True,
        "provenance": "Generado para el prototipo con síntesis simple (tools/audio/generate_sfx.py), sin licencia externa. Sustituir por sonidos finales antes de mode: presentation.",
    }
manifest["assetCount"] = len(manifest["assets"])
counts = {}
for a in manifest["assets"].values():
    counts[a["category"]] = counts.get(a["category"], 0) + 1
manifest["categoryCounts"] = counts
MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Sonidos escritos en", OUT, "·", manifest["assetCount"], "recursos en el catálogo")
for name in SOUNDS:
    p = OUT / f"{name}.wav"
    print(f"  {name}.wav  {p.stat().st_size / 1024:.1f} KiB")
