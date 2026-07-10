// Pixel Quest — cinematic opening sequence.
//
// A ~24s silent-film intro that plays before normal gameplay: 6 story plates
// with a subtle Ken-Burns drift/zoom + crossfades, code-rendered title cards,
// and layered golden FX (music fragments, sparkles, an orb forming, pulse rings,
// a golden path). Skippable (key / click / tap), disable-able, Pi-safe (no
// per-pixel effects, capped particles, no shadowBlur), and graceful on missing
// assets — a missing plate logs a warning and drops straight into gameplay.
//
// Renders on the REAL (unscaled) canvas, over the top of the Pixel Quest render
// (which early-returns to it while active). See PixelQuest.render.

const STORY_DIR = "/assets/pixelquest/opening_story/";
const FX_DIR = "/assets/pixelquest/opening_fx/";

// Authoritative sequence (mirrored by opening_story/opening_story_sequence.json).
export const PIXEL_QUEST_OPENING_SEQUENCE = [
  // title cards are intentionally sparse — only the opening and closing lines
  // carry text; the middle beats let the art speak (titleCard: "" = no card).
  { id: "silent_world", image: "01_silent_world.png", titleCard: "THE WORLD FELL SILENT", durationMs: 3000, overlay: "none" },
  { id: "first_note", image: "02_first_note.png", titleCard: "", durationMs: 3000, overlay: "first_note" },
  { id: "music_awakens", image: "03_music_awakens.png", titleCard: "", durationMs: 3500, overlay: "music_particles" },
  // orbFocus = where the ORB is painted IN THE PLATE IMAGE (fraction of the image,
  // measured from the art), mapped to the screen through the plate's cover+Ken-
  // Burns transform (see _focus) so the FX sits exactly on it at any display
  // aspect — instead of drawing a second, competing orb.
  { id: "orb_forms", image: "04_orb_forms.png", titleCard: "", durationMs: 4000, overlay: "orb_forming", orbFocus: { x: 0.493, y: 0.554 } },
  { id: "orb_chooses_him", image: "05_orb_chooses_him.png", titleCard: "", durationMs: 3500, overlay: "orb_glow", orbFocus: { x: 0.523, y: 0.426 } },
  { id: "bring_music_back", image: "06_bring_music_back.png", titleCard: "BRING MUSIC BACK", durationMs: 4000, overlay: "golden_path", orbFocus: { x: 0.541, y: 0.660 } },
];

// FX strips — filenames are loose; each is used by what it visually is.
const FX = {
  fragment: { file: "music_fragments_strip.png", frames: 6 }, // golden note/fragment variants
  sparkle: { file: "orb_forming_strip.png", frames: 6 },      // sparkle-burst animation
  pulseRing: { file: "pulse_rings_strip.png", frames: 4 },    // expanding rings
  orbForm: { file: "golden_path_tile.png", frames: 5 },       // notes gather into the orb
  path: { file: "sparkles_strip.png", frames: 1 },            // golden glowing road band
};

const CROSSFADE = 0.55; // seconds
const TITLE_FADE = 0.5;
const HANDOFF = 0.65;
const MAX_PARTICLES = 80; // Pi-safe cap
const SEEN_KEY = "vizzy-pq-opening-seen";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);

export class PixelQuestOpening {
  constructor(pq) {
    this.pq = pq;
    this.state = "idle"; // idle | loading | playing | skipping | finished | failed
    this.beat = 0;
    this.beatT = 0;
    this.elapsed = 0;
    this.plates = [];
    this.fx = {};
    this.particles = [];
    this._w = 0; this._h = 0;
    this._audio = 0; this._bassInst = 0; this._freq = null;
    this._sparkT = 0; this._fragT = 0;
    this._handoff = false; this._handoffT = 0; this._handoffDur = HANDOFF;
    this._loadStarted = false; this._loadTimer = 0;
    this._onKey = null; this._onPointer = null;
    this._checked = false;      // one-time lazy enter guard
    this.playedThisLaunch = false;
  }

  // ---- config -------------------------------------------------------------
  get cfg() { return this.pq.cfg; }
  playMode() { return this.cfg.openingSequencePlayMode || "startup"; }
  isEnabled() { return this.cfg.openingSequenceEnabled !== false && this.playMode() !== "disabled"; }
  setEnabled(on) { this.cfg.openingSequenceEnabled = !!on; }
  hasSeen() { try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; } }
  markSeen() { try { localStorage.setItem(SEEN_KEY, "1"); } catch {} }
  shouldPlay() {
    if (!this.isEnabled()) return false;
    const m = this.playMode();
    if (m === "always") return true;
    if (m === "firstRunOnly") return !this.hasSeen();
    if (m === "startup") return !this.playedThisLaunch;
    return false;
  }

  // ---- lifecycle ----------------------------------------------------------
  active() { return this.state === "loading" || this.state === "playing" || this.state === "skipping"; }
  wantsGameplayBehind() { return this._handoff; }

  // Called from main.js on mode change. Only one controller ever runs.
  onEnterMode() {
    this._checked = true;
    if (this.active()) return;
    if (this.shouldPlay()) this.start();
  }
  onExitMode() {
    if (this.active()) { this.cleanup(); this.state = "finished"; this._handoff = false; }
  }

  start() {
    if (this.active()) return;
    this.state = "loading";
    this.beat = 0; this.beatT = 0; this.elapsed = 0;
    this.particles.length = 0;
    this._handoff = false; this._handoffT = 0;
    this.playedThisLaunch = true;
    this._addInputListeners();
    if (!this._loadStarted) { this._loadStarted = true; this._loadAssets(); }
    else this._maybeBeginPlaying();
  }

  // dev: replay regardless of playMode / seen flag
  replay() {
    this.cleanup();
    this.state = "loading";
    this.beat = 0; this.beatT = 0; this.elapsed = 0;
    this.particles.length = 0;
    this._handoff = false; this._handoffT = 0;
    this._addInputListeners();
    if (!this._loadStarted) { this._loadStarted = true; this._loadAssets(); }
    else this._maybeBeginPlaying();
    return "replaying";
  }

  skip() {
    if (!this.active()) return;
    this.state = "skipping";
    this._beginHandoff(true);
    return "skipped";
  }

  finish() {
    this.markSeen();
    this.cleanup();
    this.state = "finished";
    this._handoff = false;
    const orb = this.pq.adventure?.orb;
    if (orb) { orb.visible = true; orb.charge = Math.max(orb.charge || 0, 0.28); } // the orb "chose him"
  }

  cleanup() { this.particles.length = 0; this._removeInputListeners(); }

  status() {
    return {
      state: this.state, beat: this.beat, beatId: PIXEL_QUEST_OPENING_SEQUENCE[this.beat]?.id,
      elapsedMs: Math.round(this.elapsed * 1000), particles: this.particles.length,
      platesLoaded: this.plates.filter((p) => p && p.complete && p.naturalWidth).length + "/" + this.plates.length,
      playMode: this.playMode(), enabled: this.isEnabled(), handoff: this._handoff,
    };
  }

  // ---- assets -------------------------------------------------------------
  _loadAssets() {
    if (typeof Image === "undefined") return this._fail("no Image() available");
    const mk = (src) => { const i = new Image(); i.src = src; return i; };
    this.plates = PIXEL_QUEST_OPENING_SEQUENCE.map((b) => mk(STORY_DIR + b.image));
    for (const k in FX) this.fx[k] = mk(FX_DIR + FX[k].file);
    const p0 = this.plates[0];
    p0.addEventListener("load", () => this._maybeBeginPlaying());
    p0.addEventListener("error", () => this._fail("first opening plate failed to load"));
    this._loadTimer = setTimeout(() => { if (this.state === "loading") this._fail("opening assets timed out"); }, 6000);
    if (p0.complete) this._maybeBeginPlaying();
  }
  _maybeBeginPlaying() {
    if (this.state !== "loading") return;
    const p0 = this.plates[0];
    if (!(p0 && p0.complete && p0.naturalWidth)) return;
    clearTimeout(this._loadTimer);
    this.state = "playing";
    this.beat = 0; this.beatT = 0;
  }
  _fail(msg) {
    console.warn(`[pixelquest-opening] ${msg} — starting gameplay.`);
    clearTimeout(this._loadTimer);
    this.cleanup();
    this.state = "failed";
    this._handoff = false;
  }

  // ---- input (skip) -------------------------------------------------------
  _addInputListeners() {
    if (!this._skippable()) return; // the intro cannot be bypassed unless explicitly enabled
    if (this._onKey || typeof window === "undefined") return;
    // capture-phase so a keypress skips the intro instead of switching modes
    this._onKey = (e) => {
      if (!this.active() || !this._skippable()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      this.skip();
    };
    this._onPointer = (e) => {
      if (!this.active() || !this._skippable()) return;
      if (e.target?.closest?.("#controls")) return; // let the controls panel work
      this.skip();
    };
    window.addEventListener("keydown", this._onKey, true);
    window.addEventListener("pointerdown", this._onPointer, true);
  }
  _removeInputListeners() {
    if (this._onKey) window.removeEventListener("keydown", this._onKey, true);
    if (this._onPointer) window.removeEventListener("pointerdown", this._onPointer, true);
    this._onKey = null; this._onPointer = null;
  }
  _skippable() { return this.cfg.openingSequenceSkippable !== false; }

  // ---- update -------------------------------------------------------------
  update(dt, analyser) {
    if (this.state === "loading") { this._maybeBeginPlaying(); return; }
    if (this.state !== "playing" && this.state !== "skipping") return;
    this._readAudio(analyser);
    this.elapsed += dt;

    if (this._handoff) {
      this._handoffT += dt;
      this._updateParticles(dt);
      if (this._handoffT >= this._handoffDur) this.finish();
      return;
    }

    this.beatT += dt;
    const beat = PIXEL_QUEST_OPENING_SEQUENCE[this.beat];
    this._spawnOverlay(beat.overlay, dt);
    this._updateParticles(dt);

    if (this.beatT >= beat.durationMs / 1000) {
      if (this.beat >= PIXEL_QUEST_OPENING_SEQUENCE.length - 1) this._beginHandoff(false);
      else { this.beat++; this.beatT = 0; }
    }
  }

  _beginHandoff(quick) {
    if (this._handoff) return;
    this._handoff = true;
    this._handoffT = 0;
    this._handoffDur = quick ? 0.3 : HANDOFF;
    const orb = this.pq.adventure?.orb;
    if (orb) { orb.visible = true; orb.charge = Math.max(orb.charge || 0, 0.28); }
  }

  _readAudio(analyser) {
    let e = 0;
    if (analyser) {
      if (!this._freq) this._freq = new Uint8Array(analyser.frequencyBinCount || 1024);
      analyser.getByteFrequencyData(this._freq);
      let s = 0; const n = Math.min(64, this._freq.length);
      for (let i = 1; i < n; i++) s += this._freq[i];
      e = clamp01((s / (n * 255)) * 2.4);
    }
    this._bassInst = e;
    this._audio += (e - this._audio) * 0.12;
  }

  // ---- particles ----------------------------------------------------------
  // the on-screen rect the plate image for beat `idx` is drawn into at time
  // `beatT` (cover-fit + Ken-Burns zoom/drift) — matches _drawPlate exactly so we
  // can map image-space points (the orb) to their true screen position.
  _plateTransform(w, h, idx, beatT) {
    const image = this.plates[idx];
    const beat = PIXEL_QUEST_OPENING_SEQUENCE[idx];
    const beatDur = beat ? beat.durationMs / 1000 : 3;
    const k = clamp01(beatT / beatDur);
    const scale = 1 + 0.03 * k;
    const dx = (idx % 2 === 0 ? 1 : -1) * 12 * k;
    const iw = (image && image.naturalWidth) || 1280;
    const ih = (image && image.naturalHeight) || 720;
    const s = Math.max(w / iw, h / ih) * scale;
    const dw = iw * s, dh = ih * s;
    return { x0: (w - dw) / 2 + dx, y0: (h - dh) / 2, dw, dh };
  }

  // screen position of the current beat's illustrated orb (from its image-space
  // orbFocus), so FX line up on it regardless of aspect ratio / Ken-Burns.
  _focus(w, h) {
    const f = PIXEL_QUEST_OPENING_SEQUENCE[this.beat]?.orbFocus || { x: 0.5, y: 0.5 };
    const t = this._plateTransform(w, h, this.beat, this.beatT);
    return { cx: t.x0 + f.x * t.dw, cy: t.y0 + f.y * t.dh, s: t.dw };
  }

  _spawnOverlay(kind, dt) {
    const w = this._w, h = this._h; if (!w) return;
    const { cx, cy } = this._focus(w, h);
    const heroX = w * 0.28, heroY = h * 0.66; // matches the plates' hero placement
    const room = this.particles.length < MAX_PARTICLES;
    if (kind === "first_note") {
      this._fragT += dt;
      if (room && this._fragT > 0.75) { this._fragT = 0; this._pushFrag(heroX + (Math.random() - 0.5) * w * 0.05, heroY, -h * 0.03); }
    } else if (kind === "music_particles") {
      this._fragT += dt;
      if (room && this._fragT > 0.34 - this._audio * 0.12) { this._fragT = 0; this._pushFrag(w * (0.18 + Math.random() * 0.64), h * (0.62 + Math.random() * 0.22), -h * (0.05 + Math.random() * 0.05)); }
      this._maybeSpark(dt, 0.5);
    } else if (kind === "orb_forming") {
      this._fragT += dt;
      if (room && this._fragT > 0.13 - this._audio * 0.04) { this._fragT = 0; this._pushInward(cx, cy, Math.min(w, h) * 0.42); }
      this._maybeSpark(dt, 1.0, cx, cy, Math.min(w, h) * 0.22);
    } else if (kind === "orb_glow") {
      this._maybeSpark(dt, 0.7, cx, cy, Math.min(w, h) * 0.14);
    } else if (kind === "golden_path") {
      this._maybeSpark(dt, 0.9, 0, h * 0.82, w, true);
      this._fragT += dt;
      if (room && this._fragT > 0.26) { this._fragT = 0; this._pushFrag(w * Math.random(), h * (0.8 + Math.random() * 0.1), -h * 0.06); }
    }
  }
  _pushFrag(x, y, vy) {
    this.particles.push({ t: "frag", x, y, vx: (Math.random() - 0.5) * 14, vy: vy + (Math.random() - 0.5) * 8, age: 0, life: 2.2 + Math.random() * 1.2, frame: (Math.random() * FX.fragment.frames) | 0, sz: 0.8 + Math.random() * 0.5 });
  }
  _pushInward(cx, cy, r) {
    const a = Math.random() * Math.PI * 2;
    this.particles.push({ t: "in", x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.7, cx, cy, a, r, age: 0, life: 1.0 + Math.random() * 0.5, frame: (Math.random() * FX.fragment.frames) | 0, sz: 0.7 + Math.random() * 0.5 });
  }
  _maybeSpark(dt, rate, x, y, r, band) {
    this._sparkT += dt;
    if (this._sparkT < 0.12 / (rate * (0.6 + this._bassInst * 1.2)) || this.particles.length >= MAX_PARTICLES) return;
    this._sparkT = 0;
    let sx, sy;
    if (band) { sx = (x || 0) + Math.random() * (r || this._w); sy = (y || 0) + (Math.random() - 0.5) * this._h * 0.06; }
    else if (r) { const a = Math.random() * Math.PI * 2, rr = Math.random() * r; sx = (x || this._w / 2) + Math.cos(a) * rr; sy = (y || this._h / 2) + Math.sin(a) * rr; }
    else { sx = Math.random() * this._w; sy = Math.random() * this._h; }
    this.particles.push({ t: "spark", x: sx, y: sy, age: 0, life: 0.5 + Math.random() * 0.5, frame: (Math.random() * FX.sparkle.frames) | 0, sz: 0.7 + Math.random() * 0.6 });
  }
  _updateParticles(dt) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i]; p.age += dt;
      if (p.age >= p.life) { ps.splice(i, 1); continue; }
      if (p.t === "frag") { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 6 * dt; }
      else if (p.t === "in") { const k = clamp01(p.age / p.life); p.a += dt * 1.7; const rr = p.r * (1 - smooth(k)); p.x = p.cx + Math.cos(p.a) * rr; p.y = p.cy + Math.sin(p.a) * rr * 0.7; }
    }
  }

  // ---- render -------------------------------------------------------------
  render(ctx, w, h, now) {
    this._w = w; this._h = h;
    ctx.save();
    ctx.fillStyle = "#05060a"; ctx.fillRect(0, 0, w, h);
    if (this.state === "loading") { ctx.restore(); return; } // brief black while the first plate decodes
    this._drawPlate(ctx, w, h, this.beat, this.beatT, false, 1);
    this._drawFX(ctx, w, h, 1);
    this._drawTitle(ctx, w, h);
    ctx.restore();
  }

  // during the last-beat handoff, gameplay is already drawn underneath; dissolve
  // the final plate + FX out over it
  renderHandoff(ctx, w, h) {
    if (!this._handoff) return;
    this._w = w; this._h = h;
    const a = 1 - smooth(clamp01(this._handoffT / this._handoffDur));
    if (a <= 0.01) return;
    ctx.save();
    this._drawPlate(ctx, w, h, Math.min(this.beat, this.plates.length - 1), this.beatT, true, a);
    this._drawFX(ctx, w, h, a);
    ctx.restore();
  }

  _drawPlate(ctx, w, h, idx, beatT, noFade, gAlpha) {
    ctx.imageSmoothingEnabled = true;
    const one = (image, kbIdx, alpha) => {
      if (!image || !image.complete || !image.naturalWidth) return;
      const t = this._plateTransform(w, h, kbIdx, beatT); // same math the FX aligns to
      ctx.globalAlpha = alpha * gAlpha;
      ctx.drawImage(image, t.x0, t.y0, t.dw, t.dh);
    };
    if (!noFade && idx > 0 && beatT < CROSSFADE) {
      one(this.plates[idx - 1], idx - 1, 1);
      one(this.plates[idx], idx, smooth(clamp01(beatT / CROSSFADE)));
    } else {
      one(this.plates[idx], idx, 1);
    }
    ctx.globalAlpha = 1;
  }

  _drawTitle(ctx, w, h) {
    const beat = PIXEL_QUEST_OPENING_SEQUENCE[this.beat]; if (!beat || !beat.titleCard) return;
    const dur = beat.durationMs / 1000, t = this.beatT, inT = 0.4, outStart = dur - 0.6;
    let a = 0;
    if (t < inT) a = 0;
    else if (t < inT + TITLE_FADE) a = (t - inT) / TITLE_FADE;
    else if (t < outStart) a = 1;
    else a = 1 - (t - outStart) / 0.6;
    a = clamp01(a);
    if (a <= 0.01) return;
    const cx = w * 0.5, cy = h * 0.8; // lower third, clear of the hero (lower-left)
    ctx.save();
    ctx.globalAlpha = a;
    const sH = Math.round(h * 0.12);
    const g = ctx.createLinearGradient(0, cy - sH, 0, cy + sH);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.5, "rgba(0,0,0,0.55)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, cy - sH, w, sH * 2);
    const size = Math.round(Math.min(w * 0.042, h * 0.058));
    ctx.font = `700 ${size}px "Courier New", monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    try { ctx.letterSpacing = Math.round(size * 0.18) + "px"; } catch {}
    ctx.fillStyle = "rgba(0,0,0,0.65)"; // cheap outline (no shadowBlur — Pi)
    for (const [ox, oy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) ctx.fillText(beat.titleCard, cx + ox, cy + oy);
    ctx.fillStyle = "rgba(255,226,168,0.98)";
    ctx.fillText(beat.titleCard, cx, cy);
    try { ctx.letterSpacing = "0px"; } catch {}
    ctx.restore();
  }

  _drawFrame(ctx, img, frames, frame, cx, cy, targetH) {
    if (!img || !img.complete || !img.naturalWidth) return;
    const fw = img.naturalWidth / frames, fh = img.naturalHeight;
    const s = targetH / fh, dw = fw * s, dh = fh * s;
    ctx.drawImage(img, frame * fw, 0, fw, fh, cx - dw / 2, cy - dh / 2, dw, dh);
  }

  _drawFX(ctx, w, h, gAlpha) {
    const beat = PIXEL_QUEST_OPENING_SEQUENCE[this.beat]; const kind = beat?.overlay;
    const { cx, cy } = this._focus(w, h);
    const dim = Math.min(w, h);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // NOTE: the plates already PAINT the orb (04/05) and the golden path (06),
    // so we deliberately do NOT draw an orb object or a path band here — that was
    // the "two orbs" clash. We only add supportive, non-competing FX centered on
    // the plate's orb: converging fragments (spawned in _spawnOverlay) + sparkles
    // + faint expanding rings that read as the illustrated orb pulsing energy.
    if (kind === "orb_forming") {
      this._drawPulseRings(ctx, cx, cy, dim, gAlpha * 0.7);
    }
    // particles
    for (const p of this.particles) {
      const fade = clamp01(1 - p.age / p.life) * clamp01(p.age * 5);
      ctx.globalAlpha = gAlpha * fade;
      if (p.t === "spark") this._drawFrame(ctx, this.fx.sparkle, FX.sparkle.frames, (p.frame + Math.floor(p.age * 12)) % FX.sparkle.frames, p.x, p.y, 24 * p.sz);
      else this._drawFrame(ctx, this.fx.fragment, FX.fragment.frames, p.frame, p.x, p.y, 30 * p.sz);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawPulseRings(ctx, cx, cy, dim, gAlpha) {
    const img = this.fx.pulseRing; if (!img?.complete || !img.naturalWidth) return;
    for (let r = 0; r < 2; r++) {
      const phase = (this.elapsed * 0.6 + r * 0.5) % 1;
      ctx.globalAlpha = gAlpha * clamp01((1 - phase) * 0.75);
      this._drawFrame(ctx, img, FX.pulseRing.frames, Math.min(FX.pulseRing.frames - 1, Math.floor(phase * FX.pulseRing.frames)), cx, cy, dim * (0.14 + phase * 0.5));
    }
    ctx.globalAlpha = 1;
  }
}
