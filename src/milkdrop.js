// MilkDrop — the classic, for real. Butterchurn (a WebGL2 port of MilkDrop 2)
// renders genuine .milk presets to an offscreen WebGL canvas that gets blitted
// onto the app's shared 2D canvas each frame.
//
// Vizzy's twist on the original: preset changes are DIRECTED by the music
// instead of MilkDrop's blind timer — a slow blended rotation while a song
// plays, an instant hard cut when a drop lands, and a fresh preset when a new
// song starts after silence. Behavior presets:
//   "Auto Cycle" — blend-rotate ~35s, hard-cut on drops        (default)
//   "Hard Cuts"  — no blends, cut every ~16s and on every drop
//   "Hold"       — stay on the current preset until P is pressed
//
// Pi-friendliness: butterchurn renders at an internal resolution that a
// frame-time governor scales between 40% and 100% of the display; the blit
// upscales. WebGL2 is required (Pi 5 Chromium has it); if creation fails the
// mode paints a quiet explanation instead of crashing the loop.

import butterchurn from "butterchurn";
import butterchurnPresets from "butterchurn-presets";

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// frame-time governor steps (fraction of display resolution)
const SCALES = [1, 0.8, 0.65, 0.5, 0.4];

// mulberry32 — session-seeded shuffle so the preset order differs every boot
function shuffled(arr, seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Milkdrop {
  constructor() {
    this.cfg = { sensitivity: 1.25, preset: "Auto Cycle" };
    this.canvas = document.createElement("canvas");
    this.viz = null;
    this.failed = false;
    this._audioCtx = null; // context the visualizer was created with
    this._connected = null; // node currently feeding it

    const all = butterchurnPresets.getPresets();
    this._names = shuffled(Object.keys(all), Date.now());
    this._presets = all;
    this._idx = -1;
    this._name = "";
    this._nameUntil = 0;
    this._nextAt = 0; // when the rotation timer fires next

    // audio direction state (self-contained; cheap)
    this._freq = new Uint8Array(1024);
    this._t = 0;
    this._bassFast = 0;
    this._bassSlow = 0;
    this._level = 0;
    this._quietMs = 0; // time spent in a breakdown/quiet stretch
    this._silentMs = 0; // time spent in true silence (song gap)
    this._lastCut = 0;

    // resolution governor
    this._scaleIdx = 1; // start at 0.8 — one governor step settles it either way
    this._ms = 6;
    this._frames = 0;
  }

  _ensure(analyser) {
    if (this.failed) return false;
    // butterchurn nodes must share the analyser's AudioContext, so (re)create
    // the visualizer if the context appears or changes
    // idle before any mic: build against a silent (suspended) context so the
    // presets already flow; when the mic's analyser shows up with a different
    // context, the visualizer is rebuilt against that one
    const ctx = analyser
      ? analyser.context
      : (this._audioCtx ||= new (window.AudioContext || window.webkitAudioContext)());
    if (!this.viz || ctx !== this._audioCtx) {
      try {
        this._audioCtx = ctx;
        this._connected = null;
        this.viz = butterchurn.createVisualizer(ctx, this.canvas, {
          width: this.canvas.width || 640,
          height: this.canvas.height || 360,
          meshWidth: 32,
          meshHeight: 24,
          pixelRatio: 1,
          textureRatio: 1,
        });
      } catch (err) {
        console.warn("MilkDrop: butterchurn unavailable (WebGL2?)", err);
        this.failed = true;
        return false;
      }
    }
    if (analyser && this._connected !== analyser) {
      if (this._connected) try { this.viz.disconnectAudio(this._connected); } catch {}
      this.viz.connectAudio(analyser);
      this._connected = analyser;
    }
    return true;
  }

  _load(blendSec, now) {
    this._idx = (this._idx + 1) % this._names.length;
    this._name = this._names[this._idx];
    this.viz.loadPreset(this._presets[this._name], blendSec);
    this._nameUntil = now + 4200;
    this._lastCut = now;
  }

  next(now = performance.now()) {
    if (this.viz) this._load(0, now);
  }

  // bass-flux drop detector + song-gap detector; returns direction events
  _listen(analyser, now) {
    const dt = Math.min(100, this._t ? now - this._t : 16.7);
    this._t = now;
    if (!analyser) return { drop: false, newSong: false };
    analyser.getByteFrequencyData(this._freq);
    let bass = 0;
    for (let i = 2; i < 26; i++) bass += this._freq[i];
    bass /= 24 * 255;
    let level = 0;
    for (let i = 2; i < 372; i += 6) level += this._freq[i];
    level /= 62 * 255;

    const kFast = 1 - Math.exp(-dt / 120);
    const kSlow = 1 - Math.exp(-dt / 5000);
    this._bassFast += (bass - this._bassFast) * kFast;
    this._bassSlow += (bass - this._bassSlow) * kSlow;
    this._level += (level - this._level) * kFast;

    // a drop needs a quiet stretch first — that's what makes the slam a slam
    if (this._bassFast < this._bassSlow * 0.6) this._quietMs += dt;
    else this._quietMs = Math.max(0, this._quietMs - dt * 3);
    const drop =
      this._quietMs > 2200 &&
      this._bassFast > Math.max(0.28, this._bassSlow * 1.5) &&
      now - this._lastCut > 12000;
    if (drop) this._quietMs = 0;

    // true silence for a while, then music again = a new song
    let newSong = false;
    if (this._level < 0.012) this._silentMs += dt;
    else {
      if (this._silentMs > 4000 && this._level > 0.04) newSong = true;
      this._silentMs = 0;
    }
    return { drop, newSong };
  }

  _govern(w, h) {
    // EMA the WebGL render cost; step the internal resolution to hold ~60fps
    if (++this._frames % 90 === 0) {
      if (this._ms > 10 && this._scaleIdx < SCALES.length - 1) this._scaleIdx++;
      else if (this._ms < 4.5 && this._scaleIdx > 0) this._scaleIdx--;
    }
    const iw = Math.max(320, Math.round(w * SCALES[this._scaleIdx]));
    const ih = Math.max(180, Math.round(h * SCALES[this._scaleIdx]));
    if (Math.abs(this.canvas.width - iw) > 4 || Math.abs(this.canvas.height - ih) > 4) {
      this.canvas.width = iw;
      this.canvas.height = ih;
      this.viz.setRendererSize(iw, ih);
    }
  }

  render(ctx, analyser, w, h, now) {
    if (!this._ensure(analyser)) {
      if (this.failed) {
        ctx.fillStyle = "rgba(200,205,220,0.5)";
        ctx.font = "500 16px -apple-system, 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("MilkDrop needs WebGL2 — not available on this device", w / 2, h / 2);
      }
      return;
    }
    this._govern(w, h);

    const mode = this.cfg.preset;
    const { drop, newSong } = this._listen(analyser, now);
    if (this._idx < 0) {
      this._load(0, now);
      this._nextAt = now + (mode === "Hard Cuts" ? 16000 : 35000);
    } else if (mode !== "Hold") {
      if (drop || newSong) {
        this._load(0, now); // the slam lands on a fresh world — classic MilkDrop
        this._nextAt = now + (mode === "Hard Cuts" ? 16000 : 35000);
      } else if (now >= this._nextAt) {
        this._load(mode === "Hard Cuts" ? 0 : 5.7, now);
        this._nextAt = now + (mode === "Hard Cuts" ? 16000 : 35000);
      }
    }

    const t0 = performance.now();
    this.viz.render();
    this._ms += (performance.now() - t0 - this._ms) * 0.08;

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, 0, 0, w, h);

    // the classic touch: the preset's (gloriously weird) name, fading out
    if (now < this._nameUntil) {
      const a = Math.min(1, (this._nameUntil - now) / 1200) * 0.55;
      ctx.fillStyle = `rgba(235,238,248,${a})`;
      ctx.font = "500 13px -apple-system, 'Segoe UI', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(this._name, 14, h - 12);
    }
  }
}
