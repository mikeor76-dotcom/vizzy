// NOW PLAYING service — song identification state shared by the Now Playing
// mode (src/nowplayingmode.js) and the overlay layer (src/npoverlay.js).
//
// It taps the SAME mic source the analysers use (no second getUserMedia),
// keeps a rolling PCM window, and every so often ships an 8s clip to
// /api/identify (serve.mjs on the appliance, the Vite middleware in dev —
// both back onto scripts/recognizer.bundle.mjs). The response carries
// match + artwork + lyrics; matchOffsetSec + the clip's capture time give a
// playback clock, which is what makes karaoke-synced lyrics possible.
//
// Scheduling: identify shortly after activation, then resync every ~25s while
// matched (drift + song changes); exponential backoff while nothing matches
// (25s → 3min) so unrecognizable audio doesn't hammer the endpoint. Active
// only while the mic runs AND something on screen wants the data.

const CLIP_SECONDS = 8;
const TARGET_RATE = 16000;
const RING_SECONDS = 12;
const RESYNC_MS = 25000;
const BACKOFF_MAX_MS = 180000;

class NowPlayingService {
  constructor() {
    this.status = "idle"; // idle | listening | identifying | matched | nomatch | error
    this.match = null; // last TrackMatch (raw-less) from the server
    this.artwork = null; // { url, source } — url rewritten through /api/art
    this.lyrics = null; // { source, synced?[], plain? }
    this.artImage = null; // decoded Image, same-origin via the proxy
    this.clock = null; // { offsetSec, capturedAtMs } — playback position basis
    this.error = null;

    this._listeners = new Set();
    this._ring = null;
    this._ringWrite = 0;
    this._ringFilled = 0;
    this._ringRate = 48000;
    this._tapNode = null;
    this._tapSink = null;
    this._active = false;
    this._timer = null;
    this._inFlight = false;
    this._backoffMs = RESYNC_MS;

    // console QA, same spirit as milkdrop/harmony hooks
    if (typeof window !== "undefined") {
      window.__np = {
        status: () => ({
          status: this.status,
          active: this._active,
          ringSec: this._ringFilled / this._ringRate,
          match: this.match && { title: this.match.title, artist: this.match.artist, offset: this.match.matchOffsetSec },
          lyrics: this.lyrics ? (this.lyrics.synced ? `synced:${this.lyrics.synced.length}` : "plain") : null,
          positionSec: this.positionSec(),
          backoffMs: this._backoffMs,
        }),
        identify: () => this._identify("manual"),
        mock: () => this.loadMock(),
      };
    }
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
  _emit(what) {
    for (const fn of this._listeners) {
      try { fn(what, this); } catch {}
    }
  }

  // ------------------------------------------------------------ audio tap
  // Called from main.js whenever the mic source (re)connects. A zero-gain sink
  // keeps the ScriptProcessor pulled by the graph without any audible output.
  attach(audioCtx, sourceNode) {
    this.detach();
    this._ringRate = audioCtx.sampleRate;
    this._ring = new Float32Array(Math.ceil(this._ringRate * RING_SECONDS));
    this._ringWrite = 0;
    this._ringFilled = 0;
    this._tapNode = audioCtx.createScriptProcessor(4096, 1, 1);
    this._tapSink = audioCtx.createGain();
    this._tapSink.gain.value = 0;
    this._tapNode.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const ring = this._ring;
      let w = this._ringWrite;
      for (let i = 0; i < input.length; i++) {
        ring[w] = input[i];
        w = (w + 1) % ring.length;
      }
      this._ringWrite = w;
      this._ringFilled = Math.min(this._ringFilled + input.length, ring.length);
    };
    sourceNode.connect(this._tapNode);
    this._tapNode.connect(this._tapSink);
    this._tapSink.connect(audioCtx.destination);
    if (this._active && this.status === "idle") this._setStatus("listening");
    this._schedule(2500); // let the ring gather a first clip
  }

  detach() {
    if (this._tapNode) {
      try { this._tapNode.disconnect(); } catch {}
      try { this._tapSink.disconnect(); } catch {}
      this._tapNode = null;
      this._tapSink = null;
    }
    this._ringFilled = 0;
    if (this.status === "listening" || this.status === "identifying") this._setStatus("idle");
  }

  // ------------------------------------------------------- activity control
  // Active = the mic is tapped AND something on screen consumes the data
  // (the Now Playing mode, or an enabled overlay on a mode that shows one).
  setActive(active) {
    if (active === this._active) return;
    this._active = active;
    if (active) {
      this._backoffMs = RESYNC_MS;
      if (this._tapNode && this.status === "idle") this._setStatus("listening");
      this._schedule(this._ringFilled >= this._ringRate * CLIP_SECONDS ? 800 : 2500);
    } else {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _schedule(ms) {
    if (!this._active) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._identify("scheduled"), ms);
  }

  // ------------------------------------------------------------- identify
  _captureClip() {
    const need = Math.min(this._ringFilled, Math.floor(this._ringRate * CLIP_SECONDS));
    if (need < this._ringRate * 3) return null; // <3s of audio is a waste of a request
    const out = new Float32Array(need);
    const start = (this._ringWrite - need + this._ring.length * 2) % this._ring.length;
    for (let i = 0; i < need; i++) out[i] = this._ring[(start + i) % this._ring.length];

    // linear resample to 16k mono s16 — small, dependency-free, browser-side
    const outLen = Math.floor((need * TARGET_RATE) / this._ringRate);
    const pcm = new Int16Array(outLen);
    const ratio = this._ringRate / TARGET_RATE;
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = pos | 0;
      const frac = pos - i0;
      const v = out[i0] * (1 - frac) + out[Math.min(i0 + 1, need - 1)] * frac;
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    }
    return { pcm, capturedAtMs: Date.now() - (need / this._ringRate) * 1000 };
  }

  async _identify(reason) {
    if (!this._active || this._inFlight) return;
    const clip = this._tapNode ? this._captureClip() : null;
    if (!clip) return this._schedule(2000); // ring not warm yet
    this._inFlight = true;
    if (this.status !== "matched") this._setStatus("identifying");
    try {
      const params = new URLSearchParams({
        sampleRate: String(TARGET_RATE),
        capturedAtMs: String(clip.capturedAtMs),
      });
      const res = await fetch(`/api/identify?${params}`, { method: "POST", body: clip.pcm.buffer });
      if (!res.ok) throw new Error(`identify ${res.status}`);
      this._applyResponse(await res.json(), clip.capturedAtMs);
    } catch (err) {
      this.error = String(err);
      this._setStatus(this.match ? "matched" : "error"); // keep showing a good match
      this._schedule(this._bumpBackoff());
    } finally {
      this._inFlight = false;
    }
  }

  _applyResponse(data, capturedAtMs) {
    if (!data.match) {
      // a no-match never erases a current match immediately — the song may
      // just be in a quiet/ambiguous passage; two misses in a row clear it
      if (this.match && !this._missedOnce) {
        this._missedOnce = true;
        this._setStatus("matched");
      } else {
        this._missedOnce = false;
        if (this.match) this._clearTrack();
        this._setStatus("nomatch");
      }
      this._schedule(this._bumpBackoff());
      return;
    }

    this._missedOnce = false;
    this._backoffMs = RESYNC_MS;
    const changed = data.match.providerTrackId !== this.match?.providerTrackId;
    this.match = data.match;
    this.lyrics = data.lyrics ?? (changed ? null : this.lyrics);
    if (data.artwork || changed) {
      this.artwork = data.artwork
        ? { ...data.artwork, url: `/api/art?u=${encodeURIComponent(data.artwork.url)}` }
        : null;
      this._loadArt(changed);
    }
    if (typeof this.match.matchOffsetSec === "number") {
      this.clock = { offsetSec: this.match.matchOffsetSec, capturedAtMs };
    } else if (changed) {
      this.clock = null;
    }
    this._setStatus("matched");
    if (changed) this._emit("track");
    this._schedule(RESYNC_MS);
  }

  _clearTrack() {
    this.match = null;
    this.lyrics = null;
    this.artwork = null;
    this.artImage = null;
    this.clock = null;
  }

  _bumpBackoff() {
    const ms = this._backoffMs;
    this._backoffMs = Math.min(this._backoffMs * 2, BACKOFF_MAX_MS);
    return ms;
  }

  _loadArt(changed) {
    if (changed) this.artImage = null;
    if (!this.artwork?.url) return;
    const img = new Image();
    img.onload = () => {
      this.artImage = img;
      this._emit("update");
    };
    img.src = this.artwork.url;
  }

  _setStatus(s) {
    const was = this.status;
    this.status = s;
    if (was !== s) this._emit("update");
    else this._emit("tick");
  }

  // ------------------------------------------------------------ dev fixture
  async loadMock() {
    const res = await fetch("/api/mock-nowplaying");
    if (!res.ok) throw new Error(`mock ${res.status}`);
    this._applyResponse(await res.json(), Date.now());
    return window.__np.status();
  }

  // --------------------------------------------------------------- queries
  /** Estimated seconds into the identified track right now, or null. */
  positionSec(nowMs = Date.now()) {
    if (!this.clock) return null;
    return this.clock.offsetSec + (nowMs - this.clock.capturedAtMs) / 1000;
  }

  /** Index of the synced lyric line being sung, -1 before the first, or null. */
  currentLineIndex(nowMs = Date.now()) {
    const synced = this.lyrics?.synced;
    const pos = this.positionSec(nowMs);
    if (!synced || pos == null) return null;
    let index = -1;
    for (let i = 0; i < synced.length; i++) {
      if (synced[i].timeSec <= pos) index = i;
      else break;
    }
    return index;
  }
}

export const nowplaying = new NowPlayingService();
