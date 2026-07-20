// NOW PLAYING — the mode that IS the song information: album art left, track
// identity center, karaoke lyrics right. Everything comes from the shared
// nowplaying service (src/nowplaying.js); this file only draws.
//
// Composed for the 1920×480 panel: three columns that each earn their width
// (art / identity / lyrics), sized off h so it stays legible on the small
// physical panel. Degrades cleanly to any dev-window shape. No shadowBlur
// anywhere (the Pi rule) — glow is cheap additive overdraw.

import { nowplaying } from "./nowplaying.js";

const FONT = '-apple-system, "Segoe UI", system-ui, sans-serif';

export class NowPlayingMode {
  constructor() {
    this.cfg = { preset: "Default", sensitivity: 1.25 };
    this._freq = new Uint8Array(1024);
    this._bass = 0;
    this._spin = 0;
    this._lastNow = 0;
    this._lyricY = 0; // eased scroll offset, synced lyrics
    this._plainCache = null; // { key, lines } wrapped plain lyrics
    this._pulse = 0; // listening-dot phase
  }

  render(ctx, analyser, w, h, now) {
    const dt = Math.min(0.1, (now - this._lastNow) / 1000) || 0.016;
    this._lastNow = now;
    this._pulse += dt;

    // subtle bass level for the glow — decorative only, never layout
    if (analyser) {
      analyser.getByteFrequencyData(this._freq);
      let sum = 0;
      for (let i = 2; i < 24; i++) sum += this._freq[i];
      const level = (sum / 22 / 255) * this.cfg.sensitivity;
      this._bass += (level - this._bass) * (level > this._bass ? 0.5 : 0.08);
    } else {
      this._bass *= 0.95;
    }

    // background: near-black vertical wash
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#07070c");
    bg.addColorStop(1, "#0b0d16");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const st = nowplaying.status;
    if (st === "matched" && nowplaying.match) {
      this._drawMatched(ctx, w, h, now, dt);
    } else {
      this._drawWaiting(ctx, w, h, st);
    }
  }

  // ------------------------------------------------------------- waiting
  _drawWaiting(ctx, w, h, st) {
    const cx = w / 2;
    const cy = h / 2;
    const r = h * 0.09;
    const phase = (Math.sin(this._pulse * 2.2) + 1) / 2;

    // pulsing listening ring (additive halo, thin core)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(106, 92, 254, ${0.10 + phase * 0.12})`;
    ctx.lineWidth = h * 0.02;
    ctx.beginPath();
    ctx.arc(cx, cy - h * 0.08, r * (1 + phase * 0.25), 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 106, 90, ${0.5 + phase * 0.4})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy - h * 0.08, r * (1 + phase * 0.25), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const label =
      st === "identifying" ? "Identifying…"
      : st === "nomatch" ? "Nothing recognized yet"
      : st === "error" ? "Recognizer unreachable"
      : "Listening…";
    ctx.fillStyle = "rgba(230, 235, 245, 0.85)";
    ctx.font = `600 ${Math.round(h * 0.085)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, cx, cy + h * 0.1);
    ctx.fillStyle = "rgba(139, 148, 167, 0.7)";
    ctx.font = `400 ${Math.round(h * 0.045)}px ${FONT}`;
    ctx.fillText(
      st === "nomatch" ? "still listening for the next song" : "play some music",
      cx,
      cy + h * 0.22
    );
    ctx.textAlign = "left";
  }

  // ------------------------------------------------------------- matched
  _drawMatched(ctx, w, h, now, dt) {
    const m = nowplaying.match;
    const pad = h * 0.14;
    const art = h * 0.72;
    const artX = pad;
    const artY = (h - art) / 2;

    // bass-breathing glow behind the art (additive, cheap)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(
      artX + art / 2, artY + art / 2, art * 0.2,
      artX + art / 2, artY + art / 2, art * (0.75 + this._bass * 0.25)
    );
    glow.addColorStop(0, `rgba(106, 92, 254, ${0.10 + this._bass * 0.12})`);
    glow.addColorStop(1, "rgba(106, 92, 254, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w * 0.5, h);
    ctx.restore();

    this._drawArt(ctx, artX, artY, art, dt);

    // ---- identity column
    const textX = artX + art + h * 0.13;
    const lyricsX = Math.max(w * 0.56, textX + w * 0.22);
    const textW = lyricsX - textX - h * 0.1;
    let y = h * 0.24;

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(246, 244, 241, 0.97)";
    ctx.font = `700 ${Math.round(h * 0.115)}px ${FONT}`;
    ctx.fillText(this._fit(ctx, m.title, textW), textX, y);
    y += h * 0.135;
    ctx.fillStyle = "rgba(246, 244, 241, 0.65)";
    ctx.font = `600 ${Math.round(h * 0.078)}px ${FONT}`;
    ctx.fillText(this._fit(ctx, m.artist, textW), textX, y);
    y += h * 0.105;
    const albumLine = [m.album, m.releaseYear].filter(Boolean).join("  ·  ");
    if (albumLine) {
      ctx.fillStyle = "rgba(139, 148, 167, 0.85)";
      ctx.font = `400 ${Math.round(h * 0.052)}px ${FONT}`;
      ctx.fillText(this._fit(ctx, albumLine, textW), textX, y);
    }

    this._drawLyrics(ctx, lyricsX, w - h * 0.12, h, now, dt);
  }

  _drawArt(ctx, x, y, size, dt) {
    const r = size * 0.045;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, r);
    ctx.clip();
    const img = nowplaying.artImage;
    if (img) {
      ctx.drawImage(img, x, y, size, size);
    } else {
      // vinyl placeholder — spins gently while we have a match
      this._spin += dt * 0.6;
      ctx.fillStyle = "#101018";
      ctx.fillRect(x, y, size, size);
      const cx = x + size / 2;
      const cy = y + size / 2;
      ctx.fillStyle = "#0a0a0e";
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.44, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, size * (0.18 + i * 0.055), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(106, 92, 254, 0.55)";
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(10,10,14,0.9)";
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.015, 0, Math.PI * 2);
      ctx.fill();
      // a light glint that orbits so the disc reads as turning
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = size * 0.012;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.3, this._spin, this._spin + 0.9);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, size - 1, size - 1, r);
    ctx.stroke();
  }

  // --------------------------------------------------------------- lyrics
  _drawLyrics(ctx, x0, x1, h, now, dt) {
    const lyr = nowplaying.lyrics;
    const width = x1 - x0;
    if (!lyr || (!lyr.synced && !lyr.plain)) {
      ctx.fillStyle = "rgba(139, 148, 167, 0.45)";
      ctx.font = `300 ${Math.round(h * 0.16)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("♪", x0 + width / 2, h * 0.5);
      ctx.font = `400 ${Math.round(h * 0.042)}px ${FONT}`;
      ctx.fillText("no lyrics found", x0 + width / 2, h * 0.62);
      ctx.textAlign = "left";
      return;
    }

    if (lyr.synced) {
      const lines = lyr.synced;
      const index = nowplaying.currentLineIndex() ?? -1;
      const lineH = h * 0.115;
      // ease the scroll toward the current line (screen may not step — the
      // Harmonic Ribbon lesson)
      const targetY = Math.max(0, index) * lineH;
      this._lyricY += (targetY - this._lyricY) * Math.min(1, dt * 7);

      const centerY = h * 0.5;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, h * 0.06, width, h * 0.88);
      ctx.clip();
      for (let i = 0; i < lines.length; i++) {
        const y = centerY + i * lineH - this._lyricY;
        if (y < -lineH || y > h + lineH) continue;
        const isCurrent = i === index;
        const dist = Math.min(3, Math.abs(y - centerY) / lineH);
        const alpha = isCurrent ? 1 : Math.max(0.14, 0.55 - dist * 0.14);
        ctx.fillStyle = isCurrent ? "rgba(255, 106, 90, 1)" : `rgba(214, 220, 232, ${alpha})`;
        ctx.font = `${isCurrent ? 650 : 400} ${Math.round(h * (isCurrent ? 0.075 : 0.06))}px ${FONT}`;
        ctx.textBaseline = "middle";
        ctx.fillText(this._fit(ctx, lines[i].text || "♪", width), x0, y);
      }
      ctx.restore();
      ctx.textBaseline = "alphabetic";
      return;
    }

    // plain (unsynced) lyrics: wrapped column, gentle constant crawl
    const key = `${nowplaying.match?.providerTrackId}:${Math.round(width)}`;
    if (this._plainCache?.key !== key) {
      ctx.font = `400 ${Math.round(h * 0.055)}px ${FONT}`;
      this._plainCache = { key, lines: this._wrap(ctx, lyr.plain, width) };
    }
    const lineH = h * 0.085;
    const total = this._plainCache.lines.length * lineH;
    const elapsed = nowplaying.clock ? (Date.now() - nowplaying.clock.capturedAtMs) / 1000 : 0;
    const crawl = Math.min(Math.max(0, total - h * 0.7), elapsed * lineH * 0.14);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, h * 0.08, width, h * 0.84);
    ctx.clip();
    ctx.font = `400 ${Math.round(h * 0.055)}px ${FONT}`;
    ctx.textBaseline = "top";
    this._plainCache.lines.forEach((line, i) => {
      const y = h * 0.1 + i * lineH - crawl;
      if (y < -lineH || y > h) return;
      ctx.fillStyle = "rgba(214, 220, 232, 0.72)";
      ctx.fillText(line, x0, y);
    });
    ctx.restore();
    ctx.textBaseline = "alphabetic";
  }

  _wrap(ctx, text, width) {
    const out = [];
    for (const para of String(text).split(/\r?\n/)) {
      if (!para.trim()) { out.push(""); continue; }
      let line = "";
      for (const word of para.split(/\s+/)) {
        const probe = line ? line + " " + word : word;
        if (ctx.measureText(probe).width > width && line) {
          out.push(line);
          line = word;
        } else line = probe;
      }
      if (line) out.push(line);
    }
    return out;
  }

  _fit(ctx, text, width) {
    if (ctx.measureText(text).width <= width) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > width) t = t.slice(0, -1);
    return t + "…";
  }
}
