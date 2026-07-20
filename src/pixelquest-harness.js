// Pixel Quest — real-music pacing harness (debug-only).
//
// The problem this solves: every Pixel Quest pacing system (biomes, arrivals,
// encounters, fragments, cameos) is individually cap-safe, but their COMBINED
// cadence over a full real song has only ever been checked against synthetic
// oscillator tones + forced debug triggers — never by ear against genuine
// music. Events are sparse (encounters every ~50-150s), so eyeballing it live
// is unreliable. This turns "felt cluttered around 2:00" into an objective
// per-5s-bucket density record.
//
// Two halves:
//   1. FEED — decode an audio file (or a song-bank buffer) and route it into
//      the SAME shared AnalyserNode the mic uses, so the whole game reacts to
//      real song dynamics. No fake getUserMedia needed: the analyser doesn't
//      care whether its source is a mic or a buffer.
//   2. OBSERVE — each frame, diff the game's moment-bearing state and timestamp
//      every notable moment (biome change, arrival, encounter, note-bridge,
//      campfire, fragment absorb, cameo, chapter) with the gap since the last.
//
// Usage (in the app console, on the pixelquest mode):
//   await pqLab.feed('/test/audio/mysong.mp3')   // real MP3 (gitignored dir)
//   await pqLab.feedSong('medley')               // song-bank, self-contained
//   pqLab.report()                               // per-5s density + gaps
//   pqLab.stop()
//
// The final "does it feel magical for a whole song" call is the user's — this
// just makes the tuning fast and measurable. Tuning target: mostly 0-1
// concurrent MAJOR moments per 5s bucket, occasionally 2, never 3+; no dead
// stretch (gap between majors) over ~30s.

const MAJOR = new Set(["biome", "arrival", "encounter", "note-bridge", "campfire", "chapter"]);

export function installPqLab(hooks) {
  const { beginHarnessAudio, endHarnessAudio, controller, pixelquest } = hooks;

  const lab = {
    running: false,
    t0: 0,
    dur: 0,
    log: [],
    src: null,
    gain: null,
    _prev: null,
    _lastMajorT: 0,

    // ---- feed real audio -------------------------------------------------
    async feed(url, opts = {}) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
      const { audioCtx } = beginHarnessAudio();
      const audio = await audioCtx.decodeAudioData(await res.arrayBuffer());
      return this._play(audio, url.split("/").pop(), opts);
    },

    // song-bank song rendered to a buffer — self-contained (no external file).
    // `loops` repeats it so a ~30s song can stand in for a full track's length.
    async feedSong(name = "medley", opts = {}) {
      const V = Date.now();
      const bank = await import(`/test/harness/songbank.js?v=${V}`);
      const { audioCtx } = beginHarnessAudio();
      let pcm, sr;
      if (name === "medley") { const m = bank.medley(); pcm = m.pcm; sr = bank.SR; }
      else { const s = bank.renderSong(name); pcm = s.pcm; sr = s.sampleRate || bank.SR; }
      const loops = Math.max(1, opts.loops || 1);
      const buf = audioCtx.createBuffer(1, pcm.length * loops, sr);
      const ch = buf.getChannelData(0);
      for (let k = 0; k < loops; k++) ch.set(pcm, k * pcm.length);
      return this._play(buf, `${name}${loops > 1 ? `×${loops}` : ""}`, opts);
    },

    _play(audioBuffer, label, opts) {
      this.stop(true); // clear any previous run without printing
      const { audioCtx, analyser } = beginHarnessAudio();
      if (controller.currentModeId !== "pixelquest") controller.setMode("pixelquest");

      const src = audioCtx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(analyser); // drive the visualizer
      if (!opts.mute) { // and hear it, for the by-ear pass
        const g = audioCtx.createGain();
        g.gain.value = opts.volume ?? 0.9;
        src.connect(g); g.connect(audioCtx.destination);
        this.gain = g;
      }
      this.src = src;
      this.label = label;
      this.dur = audioBuffer.duration;
      this.log = [];
      this._prev = null;
      this._lastMajorT = 0;
      this._t0 = null; // captured on the first tick, off the game clock
      this.running = true;
      src.onended = () => { if (this.running) this.stop(); };
      src.start();
      const speed = opts.rate ? ` at ${opts.rate}x` : "";
      console.log(`%cpqLab ▶ ${label} — ${this.dur.toFixed(1)}s${speed}. Call pqLab.report() when it ends.`,
        "color:#7cf");
      return `feeding "${label}" (${this.dur.toFixed(1)}s) into pixelquest`;
    },

    // ---- observe (called from the draw loop each frame with the game `now`) --
    // Timestamps track the GAME clock (the `now` fed to render), not wall time,
    // so a manually-stepped verification run and a real-time playback run
    // measure moments on the same axis.
    tick(now = performance.now()) {
      if (!this.running) return;
      if (this._t0 == null) this._t0 = now;
      const t = (now - this._t0) / 1000;
      const pq = pixelquest;
      const adv = pq.adventure || {};
      const cur = {
        biome: pq.biomeIdx,
        arriving: adv.arrival?.phase === "arriving",
        bridge: !!adv.noteBridge,
        campfire: !!adv.campfirePause,
        encounter: adv.encounters?.active ? adv.encounters.active.def.id : null,
        encounterMajor: !!adv.encounters?.active?.def?.major,
        chapter: pq.events?.chapter ? pq.events.chapter.def.id : null,
        cameoIds: pq.events?.active ? pq.events.active.map((s) => s.def.id) : [],
        // orb charge lives on the OrbCompanion, and a fragment absorb spikes
        // its absorbFlash — a clean discrete signal (charge also drifts down
        // via decay, so a raw charge-delta would miss slow-decay frames)
        absorb: adv.orb?.absorbFlash || 0,
        charge: adv.orb?.charge || 0,
      };
      const prev = this._prev;
      if (prev) {
        if (cur.biome !== prev.biome) this._emit(t, "biome", pq.currentBiome?.().name || `#${cur.biome}`);
        if (cur.arriving && !prev.arriving) this._emit(t, "arrival", pq.currentBiome?.().name || "");
        if (cur.bridge && !prev.bridge) this._emit(t, "note-bridge", "");
        if (cur.campfire && !prev.campfire) this._emit(t, "campfire", "");
        if (cur.encounter && cur.encounter !== prev.encounter)
          this._emit(t, "encounter", cur.encounter + (cur.encounterMajor ? " (major)" : ""), cur.encounterMajor);
        if (cur.chapter && cur.chapter !== prev.chapter) this._emit(t, "chapter", cur.chapter);
        for (const id of cur.cameoIds) if (!prev.cameoIds.includes(id)) this._emit(t, "cameo", id);
        // a fragment absorb spikes absorbFlash (rising edge = one collect)
        if (cur.absorb > 0.5 && prev.absorb <= 0.5) this._emit(t, "fragment", `charge ${cur.charge.toFixed(2)}`);
      }
      this._prev = cur;
    },

    _emit(t, kind, detail, major) {
      const isMajor = MAJOR.has(kind) || major;
      const gap = this.log.length ? t - this.log[this.log.length - 1].t : t;
      const majorGap = isMajor ? t - this._lastMajorT : null;
      if (isMajor) this._lastMajorT = t;
      this.log.push({ t: +t.toFixed(2), kind, detail, major: isMajor, gap: +gap.toFixed(2) });
      // fragments are ambient texture, not pacing beats — they'd flood the live
      // console (hundreds a song) and bury the meaningful moments. Keep them in
      // the log (report() shows their per-bucket density) but don't print each.
      if (kind === "fragment") return;
      const tag = isMajor ? "%c●" : "%c·";
      const color = isMajor ? "color:#ffd15c;font-weight:bold" : "color:#8bd";
      console.log(`${tag} %c${fmt(t)}  ${kind.padEnd(11)} ${detail}${majorGap != null ? `   (+${majorGap.toFixed(1)}s)` : ""}`,
        color, "color:#aab");
    },

    // ---- report ----------------------------------------------------------
    report() {
      const buckets = new Map();
      let maxMajorGap = 0, prevMajorT = 0;
      for (const m of this.log) {
        const b = Math.floor(m.t / 5);
        if (!buckets.has(b)) buckets.set(b, { major: 0, minor: 0, kinds: [] });
        const e = buckets.get(b);
        if (m.major) { e.major++; maxMajorGap = Math.max(maxMajorGap, m.t - prevMajorT); prevMajorT = m.t; }
        else e.minor++;
        e.kinds.push(m.kind[0].toUpperCase());
      }
      maxMajorGap = Math.max(maxMajorGap, this.dur - prevMajorT); // trailing dead stretch
      const nBuckets = Math.ceil((this.dur || (this.log.at(-1)?.t ?? 0)) / 5);
      const rows = [];
      let overcrowded = 0, dead = 0;
      for (let b = 0; b < nBuckets; b++) {
        const e = buckets.get(b) || { major: 0, minor: 0, kinds: [] };
        const bar = "█".repeat(e.major) + "▁".repeat(e.minor);
        if (e.major >= 3) overcrowded++;
        rows.push(`${String(b * 5).padStart(4)}s │ ${bar.padEnd(10)} ${e.major}maj ${e.minor}min  ${e.kinds.join("")}`);
      }
      const counts = {};
      for (const m of this.log) counts[m.kind] = (counts[m.kind] || 0) + 1;
      console.log(`\n%cPIXEL QUEST PACING — "${this.label}"  (${this.dur.toFixed(0)}s, ${this.log.length} moments)`,
        "color:#ffd15c;font-weight:bold");
      console.log(rows.join("\n"));
      console.log(`\ntotals: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
      console.log(`longest gap between MAJOR moments: ${maxMajorGap.toFixed(1)}s ${maxMajorGap > 30 ? "⚠ DEAD STRETCH" : "✓"}`);
      console.log(`buckets with 3+ major moments: ${overcrowded} ${overcrowded ? "⚠ OVERCROWDED" : "✓"}`);
      return {
        moments: this.log.length, durationS: +this.dur.toFixed(1),
        maxMajorGapS: +maxMajorGap.toFixed(1), overcrowdedBuckets: overcrowded,
        counts,
      };
    },

    stop(quiet) {
      if (this.src) { try { this.src.stop(); } catch {} this.src = null; }
      const wasRunning = this.running;
      this.running = false;
      endHarnessAudio?.();
      if (wasRunning && !quiet) return this.report();
    },
  };

  const fmt = (t) => `${String((t / 60) | 0).padStart(2, "0")}:${(t % 60).toFixed(1).padStart(4, "0")}`;
  lab.pixelquest = pixelquest; // debug/verification access to the live instance
  window.pqLab = lab;
  return lab;
}
