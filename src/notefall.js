// Note-Fall — the music, transcribing itself. A live piano roll written at
// the NOW edge and scrolling away across the panel's full width.
//
// A vertical keyboard sits at the left; when chroma's note tracker hears a
// note, a glowing bar is born at that key's row and extends while the note
// holds, then the whole record slides left — ~30 seconds of what was played,
// as architecture. Drums appear as brief full-height shimmer columns: visible
// as texture, never as fake notes (chroma's percussive discriminator owns
// that line). Uncertain notes are DIM — confidence maps to brightness, so a
// tracking error reads as atmosphere, not as a wrong note asserted boldly.
//
// THE PAST IS WRITE-ONCE BY CONSTRUCTION. The roll is a scrolled bitmap: only
// the newest columns are ever painted, and scrolling is the only thing that
// happens to the rest. (This is the same immutability the Harmonic Ribbon had
// to learn the hard way — but a piano roll's past is rectangles, so the
// bitmap trick that was wrong there is exactly right here.)
//
// One deliberate deviation from the spec: it asked for an auto-centred
// keyboard window that glides with the music's register. A gliding window
// under an immutable past would misalign every drawn bar with the keys it was
// born on. The window is FIXED at A2..C7 instead — chroma tracks pitch from
// 130Hz (~C3) to 5kHz, so this covers everything it can physically hear, with
// an octave of slack below.

import { Chroma, hiResOf } from "./chroma.js";

const MIDI_LO = 45; // A2
const MIDI_HI = 96; // C7
const NROWS = MIDI_HI - MIDI_LO + 1; // 52
const SPEED = 60; // px/s — ~30s of history across the panel
const BLACK = new Set([1, 3, 6, 8, 10]);

const PALETTES = {
  "Pitch Hue": {
    note: (midi, a) => `hsla(${(midi % 12) * 30} 85% 62% / ${a})`,
    cap: (midi, a) => `hsla(${(midi % 12) * 30} 90% 80% / ${a})`,
    ink: [225, 232, 248], dim: [90, 105, 140], bg: [5, 6, 12], shimmer: [150, 165, 200],
  },
  Register: {
    // low = ember, high = ice: you see WHERE the music lives
    note: (midi, a) => {
      const f = (midi - MIDI_LO) / (NROWS - 1);
      const r = Math.round(255 - f * 115), g = Math.round(120 + f * 100), b = Math.round(60 + f * 195);
      return `rgba(${r},${g},${b},${a})`;
    },
    cap: (midi, a) => `rgba(255,255,255,${a})`,
    ink: [235, 235, 245], dim: [105, 100, 120], bg: [7, 5, 10], shimmer: [180, 160, 150],
  },
  "Mono Gold": {
    note: (midi, a) => `rgba(255,198,112,${a})`,
    cap: (midi, a) => `rgba(255,236,190,${a})`,
    ink: [246, 232, 200], dim: [110, 95, 62], bg: [8, 7, 5], shimmer: [170, 150, 110],
  },
};

export class NoteFall {
  constructor() {
    this.cfg = { preset: "Pitch Hue" }; // self-governing: chroma gates itself
    this.chroma = new Chroma();
    this.roll = null; // the write-once record
    this.rollKey = "";
    this._scrollAcc = 0;
    this._prevPerc = 0;
    // bench ground truth: what was painted, and where
    this.stats = { notePaints: 0, shimmerCols: 0, onsets: [] };
    this.scrolled = 0; // total columns ever written — the bench's scroll odometer
    this.t = 0;
    this.lastNow = 0;
    this.ms = 0;
  }

  _pal() { return PALETTES[this.cfg.preset] || PALETTES["Pitch Hue"]; }
  rowOf(midi) { return MIDI_HI - Math.max(MIDI_LO, Math.min(MIDI_HI, midi)); }

  _ensureRoll(w, h) {
    const key = `${w}x${h}|${this.cfg.preset}`;
    if (this.roll && this.rollKey === key) return;
    this.roll = document.createElement("canvas");
    this.roll.width = Math.max(2, Math.round(w));
    this.roll.height = Math.max(2, Math.round(h));
    this.rollKey = key;
    const c = this.roll.getContext("2d");
    c.fillStyle = `rgb(${this._pal().bg})`;
    c.fillRect(0, 0, w, h);
  }

  // advance the record by `px` columns and write NOW into the fresh strip.
  // Only this method ever touches the roll — the past cannot change.
  _writeColumns(px, rowH) {
    this.scrolled += px;
    const c = this.roll.getContext("2d");
    const w = this.roll.width, h = this.roll.height;
    const pal = this._pal();
    c.globalCompositeOperation = "copy";
    c.drawImage(this.roll, -px, 0);
    c.globalCompositeOperation = "source-over";
    c.fillStyle = `rgb(${pal.bg})`;
    c.fillRect(w - px, 0, px, h);

    // drums: a brief full-height shimmer — texture, never notes.
    // percussive is pure spectral flatness, and room tone is ALSO flat — so
    // shimmer additionally requires actual loudness, or silence would snow.
    const perc = this.chroma.percussive;
    const loud = (this.chroma._peakDb ?? -200) > -66;
    if (perc > 0.55 && loud) {
      const [sr, sg, sb] = pal.shimmer;
      for (let i = 0; i < 26; i++) {
        const sy = Math.random() * h;
        c.fillStyle = `rgba(${sr},${sg},${sb},${0.04 + Math.random() * 0.07 * perc})`;
        c.fillRect(w - px, sy, px, 1.5);
      }
      if (this._prevPerc <= 0.55) this.stats.shimmerCols++;
    }
    this._prevPerc = perc;

    // live notes: their rows, at their confidence
    for (const nt of this.chroma.notes) {
      if (nt.midi < MIDI_LO || nt.midi > MIDI_HI || nt.conf < 0.1) continue;
      const y = this.rowOf(nt.midi) * rowH;
      const a = Math.min(1, nt.conf * (0.35 + nt.vel * 0.65));
      c.fillStyle = pal.note(nt.midi, 0.25 + a * 0.7);
      c.fillRect(w - px, y + 1, px, rowH - 2);
      // a hot core line makes held bars read as beams, not smears
      c.fillStyle = pal.cap(nt.midi, 0.25 + a * 0.5);
      c.fillRect(w - px, y + rowH / 2 - 0.75, px, 1.5);
      if (nt.state === "on" && !nt._seenByRoll) {
        nt._seenByRoll = true;
        // birth flash: a full-height-of-row bright cap in the fresh strip only
        // (never a pixel further left — the past is already written)
        c.fillStyle = pal.cap(nt.midi, Math.min(1, 0.5 + a * 0.5));
        c.fillRect(w - px, y, px, rowH);
        this.stats.onsets.push({ midi: nt.midi, row: this.rowOf(nt.midi), t: this.t });
        if (this.stats.onsets.length > 400) this.stats.onsets.shift();
      }
      this.stats.notePaints++;
    }
  }

  _drawKeyboard(ctx, x, y, w, h, rowH) {
    const pal = this._pal();
    const live = new Map();
    for (const nt of this.chroma.notes) {
      if (nt.conf > 0.1) live.set(nt.midi, Math.max(live.get(nt.midi) || 0, nt.conf * nt.vel));
    }
    const idle = live.size === 0;
    const breathe = idle ? 0.85 + 0.15 * Math.sin(this.t * 0.9) : 1;
    for (let row = 0; row < NROWS; row++) {
      const midi = MIDI_HI - row;
      const pc = ((midi % 12) + 12) % 12;
      const ky = y + row * rowH;
      const black = BLACK.has(pc);
      ctx.fillStyle = black
        ? `rgba(${pal.dim},${0.16 * breathe})`
        : `rgba(${pal.ink},${0.13 * breathe})`;
      ctx.fillRect(x, ky + 0.5, black ? w * 0.62 : w, rowH - 1);
      const glow = live.get(midi);
      if (glow) {
        ctx.fillStyle = pal.note(midi, Math.min(1, 0.35 + glow));
        ctx.fillRect(x, ky + 0.5, w, rowH - 1);
      }
      if (pc === 0) { // label the Cs — the eye needs anchors
        ctx.font = "9px ui-monospace, Menlo, monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = `rgba(${pal.dim},0.85)`;
        ctx.fillText(`C${Math.floor(midi / 12) - 1}`, x - 4, ky + rowH / 2);
      }
    }
  }

  render(ctx, analyser, w, h, now) {
    const t0 = performance.now();
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    this.t += dt;
    this.chroma.update(hiResOf(analyser), dt);

    const pal = this._pal();
    ctx.fillStyle = `rgb(${pal.bg})`;
    ctx.fillRect(0, 0, w, h);

    // layout: C labels | keyboard | the roll, all sharing row geometry
    const top = h * 0.1, rh = h * 0.84;
    const rowH = rh / NROWS;
    const kbX = w * 0.024, kbW = w * 0.034;
    const rollX = kbX + kbW + 2, rollW = Math.round(w - rollX - w * 0.012);

    this._ensureRoll(rollW, rh);
    this._scrollAcc += dt * SPEED;
    const px = Math.floor(this._scrollAcc);
    if (px >= 1) {
      this._scrollAcc -= px;
      this._writeColumns(Math.min(px, 8), rowH); // clamp: a hitch is not 200 columns
    }
    ctx.drawImage(this.roll, rollX, top);

    // NOW line + header
    ctx.strokeStyle = `rgba(${pal.ink},0.22)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rollX + rollW + 0.5, top);
    ctx.lineTo(rollX + rollW + 0.5, top + rh);
    ctx.stroke();
    ctx.font = "600 11px -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = `rgba(${pal.dim},0.9)`;
    const prev = ctx.letterSpacing;
    try { ctx.letterSpacing = "1.5px"; } catch {}
    ctx.fillText("NOTE FALL", rollX, top - 12);
    try { ctx.letterSpacing = prev || "0px"; } catch {}
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = `rgba(${pal.dim},0.7)`;
    ctx.fillText("NOW", rollX + rollW, top - 12);
    ctx.textAlign = "left";
    ctx.fillText(`-${Math.round(rollW / SPEED)}s`, rollX, top + rh + 14);

    this._drawKeyboard(ctx, kbX, top, kbW, rh, rowH);

    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
}
