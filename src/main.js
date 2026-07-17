import { Galaxy } from "./galaxy.js";
import { Aurora } from "./aurora.js";
import { Ferrofluid } from "./ferrofluid.js";
import { Flames } from "./flames.js";
import { Murmuration } from "./murmuration.js";
import { Skyline } from "./skyline.js";
import { Lasers } from "./lasers.js";
import { VectorCrt } from "./vectorcrt.js";
import { Harmony } from "./harmony.js";
import { NoteFall } from "./notefall.js";
import { Cymatics } from "./cymatics.js";
import { InkFluid } from "./inkfluid.js";
import { Spectrum } from "./spectrum.js";
import { Wave } from "./wave.js";
import { Classical } from "./classical.js";
import { PixelQuest } from "./pixelquest.js";
import { Synthwave } from "./synthwave.js";
import { Milkdrop } from "./milkdrop.js";
import { BlueMeters } from "./hifi/bluemeters.js";
import { Oscilloscope } from "./hifi/oscilloscope.js";
import { Waterfall } from "./hifi/waterfall.js";
import { StudioMonitor } from "./hifi/studiomonitor.js";
import { CATEGORIES, REGISTRY, byId } from "./registry.js";
import { AutoGain } from "./autogain.js";
import { VisualizerController } from "./controller.js";
import { initKeyboardControls } from "./keyboard.js";
import { createHardwareInput } from "./hardware.js";

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const micBtn = document.getElementById("mic-btn");
const catGroup = document.getElementById("cat-group");
const modeGroup = document.getElementById("mode-group");
const actionGroup = document.getElementById("action-group");
const nowPlaying = document.getElementById("now-playing");
const hint = document.getElementById("hint");
const overlayEl = document.getElementById("overlay");

// microphone is the only audio source
let audioCtx = null;
let analyser = null;
let micSource = null;
let micStream = null;
let micActive = false;

// --- ?hwdebug=1 : on-screen physical-control log ----------------------------
// Shows the encoder's events landing (or NOT landing) on the device's own
// screen. Pairs with deploy/encoder-diagnose.py, which diagnoses the GPIO end.
let hwLogEl = null;
let hwStatus = "starting…";
const hwLines = [];
function hwOverlay() {
  if (hwLogEl) return hwLogEl;
  hwLogEl = document.createElement("div");
  hwLogEl.style.cssText =
    "position:fixed;top:8px;left:8px;z-index:9999;font:12px ui-monospace,Menlo,monospace;" +
    "background:rgba(0,0,0,.75);color:#8ef;padding:8px 10px;border:1px solid #2a6;" +
    "border-radius:6px;max-width:52vw;pointer-events:none;line-height:1.5;white-space:pre";
    document.body.appendChild(hwLogEl);
  return hwLogEl;
}
function hwRender() {
  hwOverlay().textContent = [
    `PHYSICAL CONTROLS  ·  relay: ${hwStatus}`,
    hwLines.length ? `${hwLines.length} event(s), newest first:` : "no events yet — turn the knob",
    ...hwLines.slice(0, 7),
  ].join("\n");
}
// the relay's own state: distinguishes "browser never connected" from
// "connected fine, but the knob is sending nothing" — different bugs entirely
function setHwStatus(s) {
  hwStatus = s;
  if (hwLogEl || s) hwRender();
}
function logHwEvent(action, arg, known) {
  const t = new Date().toTimeString().slice(0, 8);
  hwLines.unshift(`${t}  ${known ? "✓" : "✗ UNKNOWN"} ${action}${arg ? " " + arg : ""}`);
  hwRender();
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    // 0.55 (was 0.82): the old value delayed a beat's energy ~70-130ms before
    // it fully registered in the FFT — and every mode applies its OWN
    // smoothers on top, so the heavy analyser smoothing was pure added
    // latency, not stability
    analyser.smoothingTimeConstant = 0.55;
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

// The hi-res analyser for pitch/harmony (src/chroma.js). The shared analyser
// is fftSize 2048 = 23.4Hz bins, and a semitone at C3 is 7.7Hz wide — you
// cannot tell C from C# down there. 8192 gives 5.9Hz bins. Created lazily and
// only attached for modes that declare `needsChroma`, so the other twenty
// modes never pay for it. smoothing 0.35: harmony needs to track chord
// CHANGES, and 0.55 smears the boundary between them.
let hiResAnalyser = null;
function ensureHiRes() {
  if (!audioCtx) return null;
  if (!hiResAnalyser) {
    hiResAnalyser = audioCtx.createAnalyser();
    hiResAnalyser.fftSize = 8192;
    hiResAnalyser.smoothingTimeConstant = 0.35;
    if (micSource) micSource.connect(hiResAnalyser);
  }
  return hiResAnalyser;
}

function stopMic() {
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (micSource) {
    micSource.disconnect();
    micSource = null;
  }
  micActive = false;
  micBtn.classList.remove("active");
  micBtn.textContent = "Start Mic";
  nowPlaying.textContent = "";
}

let micStarting = false; // guards the auto-start racing ?input=mic
async function startMic() {
  if (micActive || micStarting) return;
  micStarting = true;
  try {
    // MUSIC mic, not a call mic: Chrome's default constraints enable echo
    // cancellation, noise suppression and auto-gain — voice-call DSP that adds
    // ~20-60ms latency, squashes musical dynamics (AGC), and actively removes
    // sustained tones (noise suppression treats music as noise). All off.
    // `latency: 0` is a hint for the shortest capture buffering available.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        // ideal, not exact: a mono USB mic must still work. Stereo matters for
        // the line-in appliance path (vectorscope/goniometer need real L/R).
        channelCount: { ideal: 2 },
        latency: 0,
      },
    });
    ensureAudioContext();
    // mic is analysed only, never routed to the speakers (no feedback)
    micStream = stream;
    micSource = audioCtx.createMediaStreamSource(stream);
    micSource.connect(analyser);
    if (hiResAnalyser) micSource.connect(hiResAnalyser); // if chroma asked first
    micActive = true;
    micBtn.classList.add("active");
    micBtn.textContent = "Stop Mic";
    nowPlaying.textContent = "";
    hint.classList.add("hidden");
  } catch (err) {
    console.error("Mic setup failed:", err);
    nowPlaying.textContent =
      err.name === "NotAllowedError"
        ? "Mic blocked (check browser + macOS system permissions)"
        : `Mic error: ${err.name}`;
  } finally {
    micStarting = false;
  }
}

function toggleMic() {
  if (micActive) stopMic();
  else startMic();
}
micBtn.addEventListener("click", toggleMic);

// --- Renderer instances + registry bindings ---------------------------------
// The registry holds metadata; the render functions and per-mode canvas fade
// styles are attached here, where the instances live.

const galaxy = new Galaxy();
const aurora = new Aurora();
const ferrofluid = new Ferrofluid();
const flames = new Flames();
const murmuration = new Murmuration();
const skyline = new Skyline();
const lasers = new Lasers();
const vectorcrt = new VectorCrt();
const harmony = new Harmony();
const notefall = new NoteFall();
const cymatics = new Cymatics();
const inkfluid = new InkFluid();
const spectrum = new Spectrum();
const wave = new Wave();
const classical = new Classical();
const pixelquest = new PixelQuest();
const synthwave = new Synthwave();
const milkdrop = new Milkdrop();
const blueMeters = new BlueMeters();
const oscilloscope = new Oscilloscope();
const waterfall = new Waterfall();
const studioMonitor = new StudioMonitor();

// the raw-analyser views (plain draw functions below) get tiny cfg holders so
// AutoGain can drive their sensitivity exactly like the class-based modes
const rawBars = { cfg: { sensitivity: 1.25 } };
const rawColorbars = { cfg: { sensitivity: 1.25 } };
const rawRadial = { cfg: { sensitivity: 1.25 } };

// renderers whose cfg the controller state (preset) and AutoGain (sensitivity)
// apply to
const INSTANCES = {
  galaxy,
  aurora,
  ferrofluid,
  flames,
  murmuration,
  skyline,
  lasers,
  vectorcrt,
  harmony,
  notefall,
  cymatics,
  inkfluid,
  pixelquest,
  synthwave,
  milkdrop,
  spectrum,
  wave,
  bars: rawBars,
  colorbars: rawColorbars,
  radial: rawRadial,
  "blue-power-meters": blueMeters,
  oscilloscope,
  waterfall,
  "studio-monitor": studioMonitor,
};

const freqData = new Uint8Array(1024);
const timeData = new Uint8Array(2048);

function drawBars(w, h) {
  analyser.getByteFrequencyData(freqData);
  const sens = rawBars.cfg.sensitivity;
  const barCount = 96;
  const step = Math.floor((freqData.length * 0.7) / barCount);
  const gap = 2;
  const barWidth = w / barCount - gap;

  for (let i = 0; i < barCount; i++) {
    const v = Math.min(1, (freqData[i * step] / 255) * sens);
    const barHeight = Math.max(2, v * h * 0.75);
    const x = i * (barWidth + gap) + gap / 2;
    const hue = 260 - (i / barCount) * 100 - v * 40;
    ctx.fillStyle = `hsl(${hue} 90% ${45 + v * 25}%)`;
    ctx.fillRect(x, h - barHeight, barWidth, barHeight);
  }
}

// bars layout with the radial mode's palette: violet -> magenta -> pink
function drawColorBars(w, h) {
  analyser.getByteFrequencyData(freqData);
  const sens = rawColorbars.cfg.sensitivity;
  const barCount = 96;
  const step = Math.floor((freqData.length * 0.7) / barCount);
  const gap = 2;
  const barWidth = w / barCount - gap;

  for (let i = 0; i < barCount; i++) {
    const v = Math.min(1, (freqData[i * step] / 255) * sens);
    const barHeight = Math.max(2, v * h * 0.75);
    const x = i * (barWidth + gap) + gap / 2;
    const hue = 260 + (i / barCount) * 120 + v * 30;
    ctx.fillStyle = `hsl(${hue} 90% ${50 + v * 20}%)`;
    ctx.fillRect(x, h - barHeight, barWidth, barHeight);
  }
}

function drawRadial(w, h) {
  analyser.getByteFrequencyData(freqData);
  const cx = w / 2;
  const cy = h / 2;
  const spokes = 128;
  const step = Math.floor((freqData.length * 0.7) / spokes);
  const baseRadius = Math.min(w, h) * 0.16;
  const maxLen = Math.min(w, h) * 0.3;

  const t = performance.now() / 8000;
  const sens = rawRadial.cfg.sensitivity;
  for (let i = 0; i < spokes; i++) {
    const v = Math.min(1, (freqData[i * step] / 255) * sens);
    const angle = (i / spokes) * Math.PI * 2 + t;
    const len = baseRadius + v * maxLen;
    const hue = 260 + (i / spokes) * 120 + v * 30;
    ctx.strokeStyle = `hsl(${hue} 90% ${50 + v * 20}%)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * baseRadius, cy + Math.sin(angle) * baseRadius);
    ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, baseRadius - 6, 0, Math.PI * 2);
  ctx.stroke();
}

// bind render + fade onto the registry (fade = per-frame repaint style;
// opaque where trails would smear the art)
const BINDINGS = {
  bars: { render: (c, a, w, h) => drawBars(w, h), fade: "rgba(11, 11, 18, 0.35)" },
  colorbars: { render: (c, a, w, h) => drawColorBars(w, h), fade: "rgba(11, 11, 18, 0.35)" },
  // wave keeps a longer phosphor trail — the triggered line morphs in place
  wave: { render: (c, a, w, h, now) => wave.render(c, a, w, h, now), fade: "rgba(11, 11, 18, 0.22)" },
  radial: { render: (c, a, w, h) => drawRadial(w, h), fade: "rgba(11, 11, 18, 0.35)" },
  spectrum: { render: (c, a, w, h, now) => spectrum.render(c, a, w, h, now), fade: "rgba(4, 4, 9, 0.55)" },
  classical: { render: (c, a, w, h, now) => classical.render(c, a, w, h, now), fade: "rgba(5, 4, 2, 0.4)" },
  synthwave: { render: (c, a, w, h, now) => synthwave.render(c, a, w, h, now), fade: "rgb(10, 5, 20)" },
  galaxy: { render: (c, a, w, h, now) => galaxy.render(c, a, w, h, now), fade: "rgba(5, 9, 20, 0.28)" },
  aurora: { render: (c, a, w, h, now) => aurora.render(c, a, w, h, now), fade: "rgb(1, 3, 12)" },
  ferrofluid: { render: (c, a, w, h, now) => ferrofluid.render(c, a, w, h, now), fade: "rgb(1, 2, 4)" },
  // flames repaints the full field every frame (the automaton IS the trail)
  flames: { render: (c, a, w, h, now) => flames.render(c, a, w, h, now), fade: "rgb(4, 3, 10)" },
  // murmuration owns its sky + trails (it fades toward the dusk gradient,
  // not toward black), so the shared repaint must not touch the canvas
  murmuration: { render: (c, a, w, h, now) => murmuration.render(c, a, w, h, now), fade: "rgba(0, 0, 0, 0)" },
  // skyline repaints fully every frame (opaque cached bg blit)
  skyline: { render: (c, a, w, h, now) => skyline.render(c, a, w, h, now), fade: "rgb(2, 3, 8)" },
  lasers: { render: (c, a, w, h, now) => lasers.render(c, a, w, h, now), fade: "rgb(2, 2, 4)" },
  // vectorcrt owns persistence via its feedback buffer (opaque blit each frame)
  vectorcrt: { render: (c, a, w, h, now) => vectorcrt.render(c, a, w, h, now), fade: "rgb(0, 0, 0)" },
  // harmony paints its own opaque background every frame
  harmony: { render: (c, a, w, h, now) => harmony.render(c, a, w, h, now), fade: "rgb(6, 7, 14)" },
  notefall: { render: (c, a, w, h, now) => notefall.render(c, a, w, h, now), fade: "rgb(5, 6, 12)" },
  cymatics: { render: (c, a, w, h, now) => cymatics.render(c, a, w, h, now), fade: "rgb(7, 7, 10)" },
  inkfluid: { render: (c, a, w, h, now) => inkfluid.render(c, a, w, h, now), fade: "rgb(3, 4, 8)" },
  pixelquest: { render: (c, a, w, h, now) => pixelquest.render(c, a, w, h, now), fade: "rgb(4, 4, 8)" },
  // milkdrop blits an opaque WebGL frame over the whole canvas every frame
  milkdrop: { render: (c, a, w, h, now) => milkdrop.render(c, a, w, h, now), fade: "rgb(0, 0, 0)" },
  // hi-fi meters: scope + soundstage keep translucent fades for phosphor
  // persistence / decay trails; the rest repaint fully each frame
  "blue-power-meters": { render: (c, a, w, h, now) => blueMeters.render(c, a, w, h, now), fade: "rgb(2, 3, 6)" },
  oscilloscope: { render: (c, a, w, h, now) => oscilloscope.render(c, a, w, h, now), fade: "rgba(4, 7, 6, 0.3)" },
  waterfall: { render: (c, a, w, h, now) => waterfall.render(c, a, w, h, now), fade: "rgb(5, 6, 10)" },
  "studio-monitor": { render: (c, a, w, h, now) => studioMonitor.render(c, a, w, h, now), fade: "rgb(6, 7, 9)" },
};
for (const entry of REGISTRY) Object.assign(entry, BINDINGS[entry.id]);

// --- Controller: the single source of control truth -------------------------
// UI buttons, keyboard, and (later) hardware knobs all call controller
// methods; this subscriber applies the resulting state to the app.

const controller = new VisualizerController();
// ?hwdebug=1 puts an on-screen log of every physical-control event in the
// corner — so you can stand at the device, turn the knob, and SEE whether
// anything is arriving without SSHing in. Deliberately built from the dispatch
// hook (not the SSE handler) so it also proves keyboard/programmatic actions.
const hwDebug = new URLSearchParams(location.search).get("hwdebug") === "1";
window.vizzy = {
  controller,
  hardware: createHardwareInput(controller, { toggleMic, onEvent: hwDebug ? logHwEvent : null }),
};
// wired up after autogain is constructed below (QA: vizzy.autogain.status())

// Console-only test hooks for Pixel Quest's Adventure Layer v1 + Biome
// System v1 + Journey/Arrival (Step 3) + Quest/Collectible System v1
// (Step 4) — no UI, just a debugging convenience. Switch to Pixel Quest,
// open devtools, then:
//   pqAdventure.status()                 one-call snapshot of everything
//   pqAdventure.forceMood("peak")        calm | steady | energetic | peak | breakdown
//   pqAdventure.forceOrbVisible(false)   hide/show the orb companion
//   pqAdventure.forceDoor()              fire the locked-door moment (secret_door)
//   pqAdventure.forceBridge()            lay a music-note bridge right now
//   pqAdventure.forceCampfire()          trigger a campfire pause right now
//   pqAdventure.forceDestination("tower") castle | tower | portal | hilltop | arcade
//   pqAdventure.forceBiome("neon-forest") jump straight to a biome
//   pqAdventure.nextBiome() / previousBiome()  crossfade to the adjacent biome
//   pqAdventure.toggleFastBiomeCycling() shrink biome durations to ~10s for QA
//   pqAdventure.listBiomes()             all 5 biome ids in order
//   pqAdventure.forceJourney(0.85)       set journeyProgress directly (0..1)
//   pqAdventure.forceArrivalNow()        play the current biome's arrival now
//   pqAdventure.forceTransitionNow()     skip straight to the next biome crossfade
//   pqAdventure.forceTransitionType("pixel-wipe") preview a transition flourish
//   pqAdventure.forceBiomeArrival("castle-approach") jump to a biome + its arrival
//   pqAdventure.forceSpawnFragments(10)  spawn Sound Fragments right now
//   pqAdventure.setOrbCharge(1)          set orbCharge directly (0..1)
//   pqAdventure.toggleFragmentSpawning() pause/resume fragment spawning
//   pqAdventure.forceCollectAllFragments() instantly collect every active fragment
//   pqAdventure.forceEncounter("moon-owl") shadow-guardian | friendly-giant |
//       arcade-boss | moon-owl | storm-gate | tiny-rival
//   pqAdventure.endEncounter()           wind down the current encounter
//   pqAdventure.toggleEncounterSpawning() pause/resume encounter spawning
//   pqAdventure.setEncounterFrequency(20) raise spawn rate for QA (1 = normal)
//   pqAdventure.setRenderMode("asset_showcase") procedural_fallback | asset_standard | asset_showcase
//   pqAdventure.assetStatus()            external/baked/procedural per asset
//   pqAdventure.reloadAssets()           re-attempt external PNG loads live (hot art reload)
//   pqAdventure.togglePerfDebug()        fps/frame-ms/particle/prop metrics (top-right)
//   pqAdventure.toggleAssetDebug()       asset source panel: green=PNG amber=baked grey=proc (left)
//   pqAdventure.setStoryTextMode("cinematic") off | minimal | cinematic
//   pqAdventure.showStoryCard("Onward")  preview a cinematic text card now
//   pqAdventure.toggleStoryDebug()       on-canvas story-state readout (dev only)
//   pqAdventure.storyStatus()            story engine state snapshot
//   pqAdventure.story.orbCircleExcitedly() / heroLookAtOrb() / … relationship hooks
// Keyboard, while Pixel Quest is active: B / Shift+B = next/previous biome,
// 1-5 = force a specific biome, J = force the current biome's arrival now.
window.pqAdventure = pixelquest.adventure;

// MilkDrop QA: milkdrop.next() hard-cuts to the next preset immediately;
// milkdrop.status() reports real fps, the governor's internal scale, and the
// GL-submit vs blit split (?mdebug=1 puts the same thing on screen — the Pi is
// the machine whose answer matters and it has no console to speak of).
window.milkdrop = {
  next: () => milkdrop.next(),
  debug: (on = true) => { milkdrop.cfg.debug = on; },
  status: () => ({
    failed: milkdrop.failed,
    built: !!milkdrop.viz,
    presets: milkdrop._names.length,
    ...milkdrop.status(),
  }),
};
if (new URLSearchParams(location.search).get("mdebug") === "1") milkdrop.cfg.debug = true;

// Harmony QA: harmony.status() in the console reports what the key detector
// is actually seeing — on the Pi, with real music, in the real room. When
// "it gets the key wrong", these numbers say WHY: gate closed (tonality too
// low)? confidence low (ambiguous)? or a confident wrong answer (report it).
window.harmony = {
  status: () => ({
    key: harmony.chroma.keyLabel() || null,
    relative: harmony.chroma.relativeLabel() || null,
    confidence: +harmony.chroma.keyConfidence.toFixed(2),
    bestCandidate: harmony.chroma._best,
    tonality: +harmony.chroma.tonality.toFixed(1),
    gateOpen: harmony.chroma._open,
    percussive: +harmony.chroma.percussive.toFixed(2),
    tension: +harmony.chroma.tension.toFixed(2),
    chroma: [...harmony.chroma.chroma].map((v) => +v.toFixed(2)),
  }),
};

// Dev controls for the Pixel Quest cinematic opening:
//   pixelQuestOpening.replay()   play it again now (ignores play-mode / seen)
//   pixelQuestOpening.skip()     skip the current run
//   pixelQuestOpening.status()   state snapshot
//   pixelQuestOpening.setEnabled(false)  turn it off for this session
window.pixelQuestOpening = {
  replay: () => pixelquest.opening.replay(),
  skip: () => pixelquest.opening.skip(),
  status: () => pixelquest.opening.status(),
  setEnabled: (on) => pixelquest.opening.setEnabled(on),
};

let overlayTimer;

// --- AutoGain: the hand on the sensitivity dial, automated ------------------
// The slider is gone. AutoGain listens to the music and drives every mode's
// cfg.sensitivity per its registry `auto` profile — instant learned default on
// mode switch, a fast listen window on song changes, glacial drift once locked.
// QA: vizzy.autogain.status() in the console; ?sens=1.6 pins a manual value.
const autogain = new AutoGain();
window.vizzy.autogain = autogain;
let appliedSens = 0;
function applyAutoSens(s) {
  if (Math.abs(s - appliedSens) < 0.005) return;
  appliedSens = s;
  for (const id in INSTANCES) INSTANCES[id].cfg.sensitivity = s;
}

function applyPreset() {
  const inst = INSTANCES[controller.currentModeId];
  if (inst) inst.cfg.preset = controller.currentPreset;
}

function applyOverlay() {
  const d = controller.overlayData;
  if (!d) return;
  overlayEl.innerHTML = "";
  for (const key of ["line1", "line2", "line3", "line4"]) {
    if (!d[key]) continue;
    const div = document.createElement("div");
    div.className = `ov-${key}`;
    div.textContent = d[key];
    overlayEl.appendChild(div);
  }
  overlayEl.classList.add("visible");
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(
    () => overlayEl.classList.remove("visible"),
    Math.max(0, controller.overlayUntil - performance.now())
  );
}

function applyControlsVisible() {
  document.body.classList.toggle("controls-off", !controller.controlsVisible);
}

// --- Debug control panel: rendered from the registry -------------------------

function buildPanel() {
  catGroup.innerHTML = "";
  for (const cat of CATEGORIES) {
    const empty = controller.modesInCategory(cat.id).length === 0;
    const b = document.createElement("button");
    b.className = "cat-btn" + (cat.id === controller.currentCategory ? " active" : "");
    b.textContent = cat.name;
    b.disabled = empty;
    b.title = empty ? "coming soon" : "";
    b.addEventListener("click", () => controller.setCategory(cat.id));
    catGroup.appendChild(b);
  }
  modeGroup.innerHTML = "";
  for (const m of controller.modesInCategory()) {
    const b = document.createElement("button");
    b.className = "mode-btn" + (m.id === controller.currentModeId ? " active" : "");
    b.textContent = m.name + (controller.isFavorite(m.id) ? " ★" : "");
    b.addEventListener("click", () => controller.setMode(m.id));
    modeGroup.appendChild(b);
  }
  actionGroup.innerHTML = "";
  const actions = [
    [controller.isFavorite() ? "★" : "☆", "favorite (F)", () => controller.toggleFavorite()],
    ["P", `preset: ${controller.currentPreset} (P)`, () => controller.cyclePreset()],
    [controller.locked ? "🔒" : "🔓", "lock (L)", () => controller.toggleLock()],
  ];
  for (const [label, title, fn] of actions) {
    const b = document.createElement("button");
    b.className = "mode-btn" + (label === "🔒" ? " active" : "");
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", fn);
    actionGroup.appendChild(b);
  }
}

let prevModeId = controller.currentModeId;
controller.onChange((what) => {
  if (what === "overlay") applyOverlay();
  if (what === "controls") applyControlsVisible();
  if (what === "mode" || what === "preset") applyPreset();
  if (what === "mode") autogain.setMode(controller.currentModeId, controller.currentEntry.auto);
  if (what === "mode") saveLastMode(controller.currentModeId);
  if (what === "mode") {
    // leaving Pixel Quest cancels the intro cleanly; it only STARTS when the mic
    // begins listening on Pixel Quest (handled in PixelQuest.render)
    if (prevModeId === "pixelquest" && controller.currentModeId !== "pixelquest") pixelquest.opening.onExitMode();
    prevModeId = controller.currentModeId;
  }
  if (what === "mode" || what === "favorites" || what === "lock" || what === "preset") buildPanel();
});

// mirror the chosen mode to the server so it survives the browser dropping
// localStorage (see serve.mjs). Best-effort: a no-op in dev / plain file hosting.
function saveLastMode(mode) {
  try { fetch("/api/last-mode", { method: "POST", body: mode, keepalive: true }).catch(() => {}); } catch {}
}

initKeyboardControls(controller, { toggleMic, pixelquest });

// Kiosk support (e.g. Raspberry Pi driving an LED wall):
//   ?mode=galaxy      first-boot default mode; once you switch modes the app
//                     remembers your last choice and that wins over this param
//   ?input=mic        grab the microphone on load (needs pre-granted
//                     permission, e.g. chromium --use-fake-ui-for-media-stream)
//   ?sens=1.6         PIN a manual sensitivity and disable AutoGain (escape
//                     hatch — sensitivity is otherwise fully automatic)
// Kiosk persistence: the SERVER is the source of truth (it's updated on every
// change and injected into the page). Let it WIN over the browser's localStorage
// — a stale/undead value there (Chromium on the Pi can read a value it never
// manages to overwrite) must not pin the visualization. In a normal browser the
// injection is absent, so localStorage still drives it.
const serverMode = typeof window !== "undefined" ? window.__vizzyLastMode : null;
if (serverMode && byId(serverMode)) {
  if (serverMode !== controller.currentModeId) controller.setMode(serverMode);
  controller.hadSavedMode = true; // and keep the ?mode= kiosk default from overriding it
}

const params = new URLSearchParams(location.search);
const modeParam = params.get("mode");
// only honor ?mode= when no mode has been chosen yet — so the remembered last
// visualization is restored on restart instead of being reset by the kiosk URL
if (modeParam && byId(modeParam) && !controller.hadSavedMode) controller.setMode(modeParam);
if (params.get("input") === "mic") startMic();
const sensParam = parseFloat(params.get("sens"));
if (!Number.isNaN(sensParam)) autogain.pin(sensParam);

// PHYSICAL CONTROLS (EC11 encoder → deploy/vizzy-encoder.py → /api/input →
// SSE). Only the appliance server serves that endpoint, and it's also the only
// thing that injects __vizzyLastMode — so use that as the "am I running on the
// device?" signal and skip the subscription in dev, where EventSource would
// retry against a 404 forever. ?hw=1 forces it on for testing.
if (typeof window.__vizzyLastMode === "string" || params.get("hw") === "1" || hwDebug) {
  const es = window.vizzy.hardware.connect();
  if (hwDebug) {
    setHwStatus("connecting…");
    es.addEventListener("open", () => setHwStatus("connected ✓"));
    es.addEventListener("error", () =>
      setHwStatus(es.readyState === 2 ? "FAILED (is the app served by serve.mjs?)" : "reconnecting…")
    );
  }
} else if (hwDebug) {
  setHwStatus("not connected");
}

// AUTO-START the mic whenever permission is already granted — the hardware
// device should light up on boot with no click (kiosk Chromium pre-grants via
// --use-fake-ui-for-media-stream; a desktop browser auto-starts on every visit
// after the first grant). First-run browsers still need the button: a
// no-gesture prompt gets quietly demoted (Chrome) or refused (Safari), so we
// only prompt from a click. Query failures (older Safari) keep the button.
(async () => {
  if (micActive || micStarting) return; // ?input=mic already on it
  try {
    const perm = await navigator.permissions.query({ name: "microphone" });
    if (perm.state === "granted") startMic();
    // if the user grants later via the button, future boots auto-start
    perm.onchange = () => { if (perm.state === "granted") startMic(); };
  } catch {
    /* Permissions API unavailable: the Start Mic button remains the path */
  }
})();

autogain.setMode(controller.currentModeId, controller.currentEntry.auto);
applyAutoSens(autogain.sens);
applyPreset();
applyControlsVisible();
buildPanel();

prevModeId = controller.currentModeId; // the intro starts on mic-listen, not here

// hide the controls + cursor after a few seconds of inactivity
let idleTimer;
function wake() {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add("idle"), 4000);
}
for (const ev of ["pointermove", "pointerdown"]) window.addEventListener(ev, wake);
wake();

// the X hides the panel for good — only H brings it back, mouse movement
// does not
document.getElementById("controls-close").addEventListener("click", () => controller.toggleControlsVisible());

// --- Render loop -------------------------------------------------------------

function draw(now = performance.now()) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const entry = controller.currentEntry;

  ctx.fillStyle = entry.fade;
  ctx.fillRect(0, 0, w, h);

  if (!analyser || !micActive) {
    // some scenes are beautiful before any audio plays — render them idle
    if (entry.idle) entry.render(ctx, null, w, h, now);
    return;
  }
  applyAutoSens(autogain.update(analyser, now)); // the automated sensitivity hand
  // pitch/harmony modes read `analyser.hiRes`; benches inject their own
  if (entry.needsChroma) analyser.hiRes = ensureHiRes();
  entry.render(ctx, analyser, w, h, now);
}

function frame(now) {
  requestAnimationFrame(frame);
  draw(now);
}
requestAnimationFrame(frame);

// Dismiss the loading splash once the first frame has actually painted (with a
// short minimum so it never just flashes). Covers the gap while Chromium loads
// the app on the Pi; harmless in a normal browser.
(() => {
  const splash = document.getElementById("splash");
  if (!splash) return;
  const t0 = performance.now();
  const dismiss = () => {
    setTimeout(() => {
      splash.classList.add("hide");
      setTimeout(() => splash.remove(), 750);
    }, Math.max(0, 550 - (performance.now() - t0)));
  };
  requestAnimationFrame(() => requestAnimationFrame(dismiss)); // after first painted frame
})();
