// Murmuration — a starling flock over a dusk marsh, flying the music.
//
// Everyone has watched one of these on mute. The whole mode is an argument
// that the soundtrack was always the missing half: loud tight passages ball
// the flock into a dense pulsing mass, a kick sends a predator through it and
// it explodes and reforms, and when the music stops the birds LAND on the reed
// line and sit there as silhouettes until the next song wakes them.
//
// Real boids (separation / alignment / cohesion) over a spatial hash, so the
// emergent behaviour is genuine — the audio only moves the weights. Nothing
// here is keyframed.
//
// Pi-friendly: ~1000 birds x ~8 neighbours via an O(n) hash, typed arrays,
// zero per-frame allocation, batched into 3 stroke calls. No shadowBlur.

import { SilenceGate } from "./silencegate.js";

const PALETTES = {
  Dusk: {
    skyTop: [16, 12, 26], skyBot: [214, 118, 54], sun: [255, 196, 120],
    bird: [10, 6, 10], reed: [8, 5, 8], additive: false, trail: 0.3,
  },
  "Night Neon": {
    skyTop: [2, 4, 12], skyBot: [8, 22, 48], sun: [60, 200, 255],
    bird: [90, 230, 255], reed: [2, 6, 12], additive: true, trail: 0.22,
  },
  "Dawn Silver": {
    skyTop: [40, 48, 66], skyBot: [188, 196, 214], sun: [255, 246, 230],
    bird: [18, 20, 26], reed: [16, 18, 24], additive: false, trail: 0.32,
  },
  Storm: {
    skyTop: [10, 14, 16], skyBot: [56, 66, 62], sun: [150, 168, 160],
    bird: [6, 8, 8], reed: [4, 6, 6], additive: false, trail: 0.26,
  },
};

const N_MAX = 1200;
const R = 34; // perception radius (px) — also the hash cell size
const SEP_K = 500; // local separation: stops birds overlapping

// THE FLOCK'S SIZE IS STATED, NOT HOPED FOR.
//
// Boid cohesion only sees 34px, so nothing holds a flock spanning hundreds of
// pixels together: measured, the flock fragmented into scattered debris and
// its radius came out bimodal (~150px or ~600px, on luck). The instinct is to
// add a centroid spring and tune it against separation until the size looks
// right — but those two just cancel (separation 500 -> 1200 moved bird spacing
// by nothing, because the spring had been raised to compensate), and the size
// still wandered 76-213px between runs.
//
// So: a soft CONTAINMENT radius instead. Inside it birds are pure boids and
// nothing is fighting them; only birds that stray past the edge get pulled
// back. The flock's size becomes a number you set — and that number is what
// the music moves, which is the whole point of the mode.
const FLOCK_R_LOOSE = 290; // drifting, quiet passage
const FLOCK_R_TIGHT = 165; // balled up, loud chorus
const CONTAIN_K = 1.1;

export class Murmuration {
  constructor() {
    this.cfg = { preset: "Dusk", quality: "auto" }; // self-governing (auto:null)
    this.freq = new Uint8Array(1024);
    this.gate = new SilenceGate();

    this.n = 1000;
    this.x = new Float32Array(N_MAX);
    this.y = new Float32Array(N_MAX);
    this.vx = new Float32Array(N_MAX);
    this.vy = new Float32Array(N_MAX);
    this.perchX = new Float32Array(N_MAX);
    this.perchY = new Float32Array(N_MAX);
    this.tier = new Uint8Array(N_MAX); // render tier: fakes depth
    this.seeded = false;

    // spatial hash (rebuilt each frame; sized on first layout)
    this.head = null;
    this.next = new Int32Array(N_MAX);
    this.cols = 0; this.rows = 0;

    // audio-driven state
    this.energy = 0; // smoothed 0..1 — drives cohesion + airspeed
    this.beat = 0;
    this.treble = 0;
    this.ground = 1; // 1 = landed on the reeds, 0 = in the air
    this._loudPeak = 0.06;
    this._bassPeak = 0.05;
    this._trebPeak = 0.05;
    this._prevBass = 0;
    this._fluxAvg = 0.03;
    this._lastHawk = 0;

    // the flock roams: a wandering target, plus the hawk
    this.tgtX = 0; this.tgtY = 0;
    this.hawkX = 0; this.hawkY = 0; this.hawkT = 0; this.hawkOn = 0;
    this.flockR = 120; // measured each frame; sizes the hawk

    this.sky = null; this.skyKey = "";
    this.t = 0;
    this.lastNow = 0;
    this.frameAvg = 16;
    this.autoQuality = 1;
  }

  seed(w, h) {
    const reedY = h * 0.86;
    for (let i = 0; i < N_MAX; i++) {
      this.x[i] = Math.random() * w;
      this.y[i] = Math.random() * reedY * 0.8 + h * 0.05;
      const a = Math.random() * Math.PI * 2;
      this.vx[i] = Math.cos(a) * 60;
      this.vy[i] = Math.sin(a) * 60;
      // perches spread along the reed line, deterministic per bird so the
      // flock lands as a settled ROW rather than a clump
      this.perchX[i] = ((i * 37) % 1000) / 1000 * w * 0.96 + w * 0.02;
      // perch ABOVE the reed tips (which stand up to 29px proud), not down in
      // them: dark birds inside a dark reed silhouette are simply invisible,
      // and the landed flock is the whole point of the silence state. Up here
      // they read as a row of silhouettes against the lit sky.
      this.perchY[i] = reedY - 26 - Math.random() * 14;
      this.tier[i] = i % 3;
    }
    this.tgtX = w * 0.5; this.tgtY = h * 0.4;
    this.seeded = true;
  }

  analyze(dt, now) {
    const f = this.freq;
    const g = this.gate.update(f, dt);
    const band = (lo, hi) => {
      let s = 0;
      for (let i = lo; i < hi; i++) s += f[i];
      return Math.max(0, s / ((hi - lo) * 255) - g.sub);
    };
    const rawBass = band(1, 6);
    const rawTreb = band(92, 372);
    const rawLoud = g.loud;

    // peaks adapt only while the gate is open — silence must never wind the
    // gain up (silencegate.js explains why this is not optional)
    if (g.open) {
      const dk = 1 - dt * 0.05;
      this._loudPeak = Math.max(this._loudPeak * dk, rawLoud, 0.04);
      this._bassPeak = Math.max(this._bassPeak * dk, rawBass, 0.04);
      this._trebPeak = Math.max(this._trebPeak * dk, rawTreb, 0.03);
    }
    const loudN = g.gate * Math.min(1, rawLoud / this._loudPeak);
    this.energy += (loudN - this.energy) * Math.min(1, dt * 2.2);
    this.treble += (g.gate * Math.min(1, rawTreb / this._trebPeak) - this.treble) * Math.min(1, dt * 6);

    // kick from raw bass flux, volume-independent + adaptive threshold
    const fluxN = g.open ? Math.max(0, rawBass - this._prevBass) / Math.max(0.04, this._bassPeak) : 0;
    this._prevBass = rawBass;
    this._fluxAvg += (fluxN - this._fluxAvg) * Math.min(1, dt * 1.5);
    if (g.open && fluxN > Math.max(0.05, this._fluxAvg * 2.1)) this.beat = 1;
    // A big accent sends the HAWK through the flock — the money shot. It dives
    // THROUGH the flock's current centre on a random heading, because a
    // predator hunts the flock; flying a fixed path across the screen meant it
    // missed entirely whenever the flock had roamed elsewhere, and the whole
    // effect became a coin toss.
    if (g.open && fluxN > Math.max(0.13, this._fluxAvg * 3.8) && now - this._lastHawk > 5000) {
      this._lastHawk = now;
      this.hawkOn = 1;
      this.hawkT = 0;
      this.aimHawk();
    }
    this.beat = Math.max(0, this.beat - dt * 4);

    // (There was a "busy music splits the flock into two sub-flocks" feature
    // here. Cut, and worth knowing why: it was never emergent — just two fixed
    // targets tugging alternate birds — and it wrecked everything measurable
    // around it. With the flock in two clumps ~900px apart, its "radius" reads
    // 453px instead of ~150, which mis-sized the hawk so badly it reached 97
    // of 996 birds, and made every spread reading a coin flip on where `split`
    // happened to be. One coherent flock that breathes with the music, bursts
    // for the hawk, and lands at silence is the stronger mode.)

    // landing/takeoff: slow, so a gap between songs doesn't ground them
    const wantGround = g.gate < 0.25 ? 1 : 0;
    this.ground += (wantGround - this.ground) * Math.min(1, dt * (wantGround ? 0.22 : 0.9));
  }

  // plot a dive straight through the flock's centre, entering from a random
  // side and exiting the far one
  aimHawk() {
    const a = Math.random() * Math.PI * 2;
    const d = Math.max(320, this.flockR * 2.2);
    this.hawkFromX = this.flockCx + Math.cos(a) * d;
    this.hawkFromY = this.flockCy + Math.sin(a) * d * 0.45; // shallower dive: 4:1 panel
    this.hawkToX = this.flockCx - Math.cos(a) * d;
    this.hawkToY = this.flockCy - Math.sin(a) * d * 0.45;
  }

  buildHash(w, h) {
    const cols = Math.max(1, Math.ceil(w / R)), rows = Math.max(1, Math.ceil(h / R));
    if (!this.head || this.cols !== cols || this.rows !== rows) {
      this.cols = cols; this.rows = rows;
      this.head = new Int32Array(cols * rows);
    }
    this.head.fill(-1);
    for (let i = 0; i < this.n; i++) {
      const cx = Math.max(0, Math.min(cols - 1, (this.x[i] / R) | 0));
      const cy = Math.max(0, Math.min(rows - 1, (this.y[i] / R) | 0));
      const c = cy * cols + cx;
      this.next[i] = this.head[c];
      this.head[c] = i;
    }
  }

  flock(dt, w, h) {
    const { x, y, vx, vy, head, next, cols, rows } = this;
    const air = 1 - this.ground;
    // the flock's own radius: the hawk is sized against it (see below)
    let mx = 0, my = 0;
    for (let i = 0; i < this.n; i++) { mx += x[i]; my += y[i]; }
    mx /= this.n; my /= this.n;
    let sp = 0;
    for (let i = 0; i < this.n; i++) sp += Math.hypot(x[i] - mx, y[i] - my);
    this.flockR = sp / this.n;
    this.flockCx = mx; this.flockCy = my;
    // the audio's whole job: loud = tight and fast, quiet = loose and drifting
    // Local cohesion is deliberately GENTLE. Cranked up it out-pulls the
    // containment radius, and the flock packs into a dense clump rattling
    // around inside a boundary it never touches — so the radius (the thing the
    // music actually moves) stops mattering. Keep it just strong enough to
    // knit neighbours together and let containment set the size; alignment is
    // what makes them read as one flock anyway.
    const coh = 0.15 + this.energy * 0.35;
    const ali = 0.7 + this.energy * 1.6;
    const sep = 1.5;
    const speed = (46 + this.energy * 118) * (0.6 + air * 0.4);
    // the flock's size IS the audio response: loud balls it up, quiet lets it
    // drift open (see the containment note at the top)
    const wantR = FLOCK_R_LOOSE + (FLOCK_R_TIGHT - FLOCK_R_LOOSE) * this.energy;
    const R2 = R * R;
    // The hawk reaches MOST of the flock (1.3x its radius), not just the birds
    // it brushes past. Sized at 0.6-0.85x it touched a small, luck-dependent
    // share and the flock-wide reaction came out anywhere from 0.87x to 1.6x —
    // sometimes invisible. A real murmuration reacts as one body: the whole
    // flock knows the predator is there. The scatter still shears rather than
    // shoves because `panic` makes them SPRINT outward (see the speed clamp),
    // not just drift.
    const hawkR = Math.max(85, Math.min(240, this.flockR * 1));
    // Personal space SHRINKS as the music drives them. Raising cohesion alone
    // doesn't tighten the flock: its density is set by where separation
    // balances cohesion, and energy was raising airspeed too, which spreads
    // the flock by exactly as much as the extra cohesion pulled it in (203 vs
    // 192 px — a wash). Excited starlings really do pack tighter; this is the
    // knob that makes a chorus visibly ball them up.
    const SEP2 = (R * (0.5 - this.energy * 0.2)) ** 2;
    const hawkR2 = hawkR * hawkR;

    for (let i = 0; i < this.n; i++) {
      let ax = 0, ay = 0;
      let cx = 0, cy = 0, avx = 0, avy = 0, cnt = 0;
      let sx = 0, sy = 0;
      const gx = Math.max(0, Math.min(cols - 1, (x[i] / R) | 0));
      const gy = Math.max(0, Math.min(rows - 1, (y[i] / R) | 0));
      for (let oy = -1; oy <= 1; oy++) {
        const ry = gy + oy;
        if (ry < 0 || ry >= rows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const rx = gx + ox;
          if (rx < 0 || rx >= cols) continue;
          for (let j = head[ry * cols + rx]; j !== -1; j = next[j]) {
            if (j === i) continue;
            const dx = x[j] - x[i], dy = y[j] - y[i];
            const d2 = dx * dx + dy * dy;
            if (d2 > R2 || d2 === 0) continue;
            cx += x[j]; cy += y[j];
            avx += vx[j]; avy += vy[j];
            cnt++;
            // Separation has to STAND UP to cohesion at the spacing you want,
            // or the flock keeps packing until it's a dot (the first version,
            // at 60, collapsed 1000 birds into a ~50px ball). Bird spacing is
            // what sets the flock's size: radius ~= spacing * sqrt(N/pi), so
            // on this panel 12px spacing buys a ~210px murmuration and 6px
            // buys a ~110px clump.
            if (d2 < SEP2) { const inv = 1 / d2; sx -= dx * inv * SEP_K; sy -= dy * inv * SEP_K; }
          }
        }
      }
      if (cnt > 0) {
        ax += ((cx / cnt) - x[i]) * coh * 0.5;
        ay += ((cy / cnt) - y[i]) * coh * 0.5;
        ax += ((avx / cnt) - vx[i]) * ali;
        ay += ((avy / cnt) - vy[i]) * ali;
      }
      ax += sx * sep; ay += sy * sep;

      // Roam. The pull is deliberately weak (0.05, not 0.28): a strong spring
      // to a point IS a second cohesion force, and it flattened the flock's
      // own dynamics into a ball orbiting a dot. The flock should be led, not
      // dragged.
      ax += (this.tgtX - x[i]) * 0.05;
      ay += (this.tgtY - y[i]) * 0.05;
      // Containment: free inside the flock's radius, reeled in past it — and
      // released as they land, because a flock spread along a reed line isn't
      // a flock. Without the (1 - ground) it hauls landing birds back toward
      // the centre of the perch row and they never reach their own perches.
      const dxc = x[i] - this.flockCx, dyc = y[i] - this.flockCy;
      const rc = Math.sqrt(dxc * dxc + dyc * dyc);
      if (rc > wantR && rc > 1 && this.ground < 0.99) {
        const f = ((rc - wantR) * CONTAIN_K * (1 - this.ground)) / rc;
        ax -= dxc * f; ay -= dyc * f;
      }

      // the hawk: local scatter, strongest at its centre
      let panic = 0;
      if (this.hawkOn > 0.01) {
        const dx = x[i] - this.hawkX, dy = y[i] - this.hawkY;
        const d2 = dx * dx + dy * dy;
        if (d2 < hawkR2 && d2 > 1) {
          panic = (1 - d2 / hawkR2) * this.hawkOn;
          const f = panic * 3200;
          const inv = 1 / Math.sqrt(d2);
          ax += dx * inv * f; ay += dy * inv * f;
        }
      }
      // feather noise
      ax += (Math.random() - 0.5) * (30 + this.treble * 260);
      ay += (Math.random() - 0.5) * (30 + this.treble * 260);
      // Soft walls, set WIDE and firm. The flock cannot slow down — the speed
      // normalizer below pins every bird at cruise speed, so a wall can only
      // TURN it, and the turn radius (v^2/a, ~110px at cruise) is what decides
      // where it actually stops. Add ~150px of flock radius on top and a
      // narrow margin let the centroid reach x=82 and y=20 with a third of the
      // birds off the panel. This is a 4:1 bar: headroom is the scarce axis.
      const m = 200;
      if (x[i] < m) ax += (m - x[i]) * 7;
      if (x[i] > w - m) ax -= (x[i] - (w - m)) * 7;
      const ceil = h * 0.2;
      if (y[i] < ceil) ay += (ceil - y[i]) * 12;
      const floorY = h * 0.78;
      if (y[i] > floorY) ay -= (y[i] - floorY) * 12;

      // perch-seeking takes over as the flock lands
      let perchD = 0;
      if (this.ground > 0.01) {
        const px = this.perchX[i], py = this.perchY[i];
        perchD = Math.hypot(px - x[i], py - y[i]);
        // a DAMPED spring (the -v term). An undamped one is a pendulum: the
        // birds fell into their perches and then orbited them forever at
        // ~11px/s, so the flock never actually came to rest. c ~= 2*sqrt(k) is
        // roughly critical — they arrive and stay arrived.
        const k = this.ground * this.ground;
        ax = ax * (1 - k) + ((px - x[i]) * 3.4 - vx[i] * 3.7) * k;
        ay = ay * (1 - k) + ((py - y[i]) * 3.4 - vy[i] * 3.7) * k;
      }

      vx[i] += ax * dt; vy[i] += ay * dt;
      // wingbeat: the whole flock contracts a touch on every kick.
      // The panic term matters more than it looks: this normalizer pins every
      // bird to cruise speed, so it was ERASING the hawk's impulse within
      // ~0.3s — the birds turned but never actually got away, and the flock
      // barely opened (1.0-1.3x packing). A startled starling sprints; without
      // letting `want` rise, no impulse of any size can scatter this flock.
      const sp = Math.hypot(vx[i], vy[i]) || 1;
      // Landing birds fly at cruise until they're NEAR their perch, then brake
      // into it. Scaling the speed cap by (1 - ground) instead throttled them
      // to ~6px/s the moment the flock decided to land, so a bird 400px from
      // its perch needed a minute to get there and the flock never settled.
      const air = speed * (1 + this.beat * 0.22 + panic * 2.4);
      const land = Math.max(3, Math.min(speed, perchD * 2));
      const want = air * (1 - this.ground) + land * this.ground;
      // Clamp into a BAND; don't pin. Forcing every bird to exactly cruise
      // speed means no force can ever slow one down — only turn it — so the
      // flock orbited its containment radius as a wide ring instead of
      // settling into it (measured: spread still 378px after 22 seconds, then
      // slowly spiralling in), and walls turned it in a big arc rather than
      // stopping it. A floor keeps birds from stalling in mid-air.
      // the floor must vanish as they land, or perched birds keep creeping at
      // a few px/s and wander off the reed line they just settled on
      const hi = want, lo = want * 0.4 * (1 - this.ground);
      if (sp > hi) { const k = hi / sp; vx[i] *= k; vy[i] *= k; }
      else if (sp < lo) { const k = lo / sp; vx[i] *= k; vy[i] *= k; }
      x[i] += vx[i] * dt; y[i] += vy[i] * dt;
    }
  }

  drawSky(w, h, pal) {
    const key = `${w}x${h}${this.cfg.preset}`;
    if (this.sky && this.skyKey === key) return;
    this.skyKey = key;
    if (!this.sky) this.sky = document.createElement("canvas");
    this.sky.width = w; this.sky.height = h;
    const c = this.sky.getContext("2d");
    const reedY = h * 0.86;
    const g = c.createLinearGradient(0, 0, 0, reedY);
    g.addColorStop(0, `rgb(${pal.skyTop})`);
    g.addColorStop(1, `rgb(${pal.skyBot})`);
    c.fillStyle = g;
    c.fillRect(0, 0, w, reedY);
    // low sun/moon behind the flock
    const sx = w * 0.76, sy = reedY - h * 0.06;
    const sg = c.createRadialGradient(sx, sy, 0, sx, sy, h * 0.42);
    sg.addColorStop(0, `rgba(${pal.sun},0.85)`);
    sg.addColorStop(0.25, `rgba(${pal.sun},0.22)`);
    sg.addColorStop(1, `rgba(${pal.sun},0)`);
    c.fillStyle = sg;
    c.fillRect(0, 0, w, reedY);
    c.fillStyle = `rgba(${pal.sun},0.9)`;
    c.beginPath();
    c.arc(sx, sy, h * 0.05, 0, Math.PI * 2);
    c.fill();
    // water hint below the reeds, then the reed line itself
    const wg = c.createLinearGradient(0, reedY, 0, h);
    wg.addColorStop(0, `rgba(${pal.sun},0.10)`);
    wg.addColorStop(1, `rgb(${pal.reed})`);
    c.fillStyle = wg;
    c.fillRect(0, reedY, w, h - reedY);
    c.strokeStyle = `rgb(${pal.reed})`;
    c.lineWidth = 1.2;
    c.beginPath();
    for (let i = 0; i < w; i += 3) {
      const hh = 6 + ((i * 977) % 23);
      c.moveTo(i, reedY + 2);
      c.lineTo(i + ((i * 31) % 5) - 2, reedY - hh);
    }
    c.stroke();
    c.fillStyle = `rgb(${pal.reed})`;
    c.fillRect(0, reedY + 1, w, h - reedY);
  }

  render(ctx, analyser, w, h, now) {
    const t0 = performance.now();
    const dt = Math.min(Math.max(this.lastNow ? now - this.lastNow : 16.7, 0) / 1000, 0.05);
    this.lastNow = now;
    this.t += dt;
    if (analyser) analyser.getByteFrequencyData(this.freq);
    else this.freq.fill(0);
    this.analyze(dt, now);
    if (!this.seeded) this.seed(w, h);

    const pal = PALETTES[this.cfg.preset] || PALETTES.Dusk;
    this.drawSky(w, h, pal);
    this.n = Math.max(400, Math.round(N_MAX * 0.83 * this.autoQuality));

    // roaming targets wander; the flock follows
    const reedY = h * 0.86;
    // the target must leave room for the flock's own RADIUS (~150px): aiming
    // it at 0.94w parked the flock against the right wall with half its birds
    // off the panel
    this.tgtX = w * (0.5 + Math.sin(this.t * 0.17) * 0.24 + Math.sin(this.t * 0.06) * 0.05);
    // narrow vertical wander: on a 4:1 panel the flock has plenty of room to
    // roam sideways and almost none to climb
    this.tgtY = h * (0.46 + Math.sin(this.t * 0.24 + 1) * 0.1);
    if (this.hawkOn > 0.01) {
      // the hawk dives THROUGH the flock (aimHawk plotted the line) and out
      // the far side; its force fades as it leaves
      this.hawkT += dt;
      const p = Math.min(1, this.hawkT / 1.3);
      this.hawkX = this.hawkFromX + (this.hawkToX - this.hawkFromX) * p;
      this.hawkY = this.hawkFromY + (this.hawkToY - this.hawkFromY) * p;
      // Presence, NOT progress. This used to be `1 - p`, which made the hawk
      // weakest exactly where it should be scariest: at full strength (p=0)
      // it's still 400px away, outside its own radius, and by the time it
      // reaches the flock's centre it had already faded to half. The scatter
      // is spatial — (1 - d2/r2) in flock() does that job — so this only has
      // to say "the hawk is here", then let go at the end of the dive.
      this.hawkOn = p >= 1 ? 0 : Math.min(1, (1 - p) * 5);
    }

    this.buildHash(w, h);
    this.flock(dt, w, h);

    // trails: fade the previous frame TOWARD THE SKY (not toward black — the
    // flock flies over a lit dusk gradient, and fading to black would smear a
    // dark halo across it). One cached blit; the registry fade is a no-op.
    ctx.globalAlpha = pal.trail;
    ctx.drawImage(this.sky, 0, 0, w, h);
    ctx.globalAlpha = 1;

    // birds: 3 tiers batched into 3 strokes (1000 individual stroke calls
    // would cost more than the whole simulation)
    ctx.save();
    if (pal.additive) ctx.globalCompositeOperation = "lighter";
    const [br, bg, bb] = pal.bird;
    for (let tier = 0; tier < 3; tier++) {
      const len = 1.5 + tier * 0.9;
      ctx.lineWidth = 0.9 + tier * 0.5;
      const a = pal.additive ? 0.5 + tier * 0.22 : 0.55 + tier * 0.2;
      ctx.strokeStyle = `rgba(${br},${bg},${bb},${a})`;
      ctx.beginPath();
      for (let i = tier; i < this.n; i += 3) {
        const sp = Math.hypot(this.vx[i], this.vy[i]) || 1;
        const ux = this.vx[i] / sp, uy = this.vy[i] / sp;
        // a landed bird is a dot, not a dash
        const l = len * (1 - this.ground * 0.45);
        ctx.moveTo(this.x[i] - ux * l, this.y[i] - uy * l);
        ctx.lineTo(this.x[i] + ux * l * 0.5, this.y[i] + uy * l * 0.5);
      }
      ctx.stroke();
    }
    ctx.restore();

    // the reeds sit IN FRONT: landed birds perch among them
    ctx.drawImage(this.sky, 0, reedY + 1, w, h - reedY - 1, 0, reedY + 1, w, h - reedY - 1);

    const ms = performance.now() - t0;
    this.frameAvg += (ms - this.frameAvg) * 0.04;
    if (this.cfg.quality === "auto") {
      if (this.frameAvg > 26) this.autoQuality = Math.max(0.42, this.autoQuality - 0.02);
      else if (this.frameAvg < 19) this.autoQuality = Math.min(1, this.autoQuality + 0.004);
    }
  }
}
