// Pixel Quest — Special Events / Cameo Moments.
//
// A reusable event system that occasionally drops small retro homage moments
// into the side-scroller: silhouettes crossing the moon, props rising by the
// road, hero showpieces, weather moods. Everything is a suggestive pixel-art
// homage — silhouettes, gestures, colors — never names, logos, or exact
// character designs.
//
// Architecture:
//   EVENT_TUNING            — all frequency/cooldown dials in one place
//   PixelQuestEventManager  — lifecycle, cooldowns, rarity, overlap rules
//   PIXEL_EVENTS            — the polished starter pack (enabled)
//   FUTURE_EVENTS           — a parked catalog for later (enabled: false)
//
// Event shape (vanilla-JS version of the suggested types):
// {
//   id, name,
//   category: "sky"|"hero"|"ground"|"background"|"prop"|"weather"|"transition",
//   rarity: "common"|"uncommon"|"rare"|"legendary",
//   trigger: "beat"|"bass"|"treble"|"loudness"|"quiet"|"random",
//   duration: [minSeconds, maxSeconds],
//   minCooldown: seconds before THIS event may fire again,
//   energyRequired?: 0..1 (driveFx floor),
//   allowedBiomes?: [biome names],
//   isMajor?: true,          // only one major at a time, extra cooldown
//   layer: "sky"|"background"|"ground"|"front"|null, // draw hook (null = via hero/egg)
//   when?(pq, audio, mgr)    // extra predicate
//   onStart?(st, pq, mgr)    update?(st, pq, audio, dt, mgr)
//   draw?(o, st, pq, pal)    onEnd?(st, pq, mgr)
// }
// Runtime state per active event: { def, t, dur, p (0..1), fade (0..1),
// seed, data: {} } — use st.p for motion, st.fade for opacity in/out.

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ------------------------------------------------------------ tuning dials
export const EVENT_TUNING = {
  eventGlobalFrequency: 1, // master multiplier: 2 = twice as often
  heroShowpieces: false, // hero-costume cameos (moonwalk/spin/boombox…) use the OLD
  //                        procedural hero, so they briefly swap the image hero for
  //                        crude graphics. Off by default; set true to bring them back.
  anyEventCooldownSeconds: 12, // nothing fires within 12s of anything else
  majorEventCooldownSeconds: 45,
  maxActive: 2, // at most two events on screen (one if major)
  categoryCooldowns: {
    hero: 40,
    sky: 30,
    weather: 90,
    transition: 150,
    prop: 25,
    ground: 40,
    background: 30,
  },
  // expected seconds between firings while a trigger condition holds
  rarityIntervals: { common: 30, uncommon: 70, rare: 160, legendary: 420 },
  rareEventMultiplier: 1,
  legendaryEventMultiplier: 1,
  audioTriggerSensitivity: 1,
  // batch 3 dials (weather/transition cooldowns live in categoryCooldowns)
  batch3EventWeight: 1, // trigger-chance multiplier for batch-3 events only
  legendaryEventCooldownSeconds: 300, // floor on any legendary's re-fire time
  musicPowerUpCooldownSeconds: 420, // the magic microphone stays special
  foregroundEventCooldownSeconds: 45, // ground-category spacing (see below)
  // final batch dials
  finalBatchEventWeight: 1, // trigger-chance multiplier for final-batch events
  backgroundEasterEggCooldownSeconds: 40, // background-category spacing
  heroPoseCooldownSeconds: 40, // hero-category spacing
  // batch 4 dials
  batch4EventWeight: 1, // trigger-chance multiplier for batch-4 events only
  heroPowerUpCooldownSeconds: 420, // star_power_burst stays special, like the mic
  // chapter events (foreground set pieces): rare mini story moments where
  // the hero actually interacts with the world — kept VERY conservative
  chapterEventsEnabled: true,
  chapterEventGlobalCooldownSeconds: 180,
  chapterEventStartupDelaySeconds: 45,
  chapterEventChanceMultiplier: 0.25,
  chapterEventMinEnergy: 0.55,
  battleEventCooldownSeconds: 240,
  landmarkEventCooldownSeconds: 360,
  obstacleEventCooldownSeconds: 240,
  chapterEventSuppressMinorCameos: true, // no new cameos during a set piece
  chapterEventSuppressWeather: true, // (implied by the above; kept as a dial)
  debug: true, // console log every trigger with its reason
};
EVENT_TUNING.categoryCooldowns.ground = EVENT_TUNING.foregroundEventCooldownSeconds;
EVENT_TUNING.categoryCooldowns.background = EVENT_TUNING.backgroundEasterEggCooldownSeconds;
EVENT_TUNING.categoryCooldowns.hero = EVENT_TUNING.heroPoseCooldownSeconds;

// ------------------------------------------------------------ the manager
export class PixelQuestEventManager {
  constructor(pq, defs = PIXEL_EVENTS) {
    this.pq = pq;
    this.defs = defs.filter((d) => d.enabled !== false);
    this.active = [];
    this.clock = 0;
    this.lastAny = -99;
    this.lastMajor = -99;
    this.catLast = {};
    this.cooldownUntil = {};
    this.prevKick = 0;
    this.prevSnare = 0;
    this.driveHist = [];
    this.histT = 0;
    // chapter tier: foreground set pieces — at most one, ever
    this.chapterDefs = CHAPTER_EVENTS.filter((d) => d.enabled !== false);
    this.chapter = null;
    this.chapterCooldownUntil = {};
    this.lastChapterEnd = -999;
  }

  activeIds() {
    return this.active.map((s) => s.def.id);
  }

  audioSnapshot(dt) {
    const pq = this.pq;
    // explicit one-frame hit flags from the drum detectors (the pulse
    // envelopes decay within the very frame they fire, so thresholds miss)
    const kickEdge = !!pq.kickHit;
    const snareEdge = !!pq.snareHit;
    pq.kickHit = false;
    pq.snareHit = false;
    this.histT += dt;
    if (this.histT > 0.25) {
      this.histT = 0;
      this.driveHist.push(pq.driveFx || 0);
      if (this.driveHist.length > 10) this.driveHist.shift();
    }
    return {
      bass: pq.bass.value,
      mids: pq.mids.value,
      treble: pq.treble.value,
      loud: pq.loud.value,
      drive: pq.driveFx || 0,
      gate: pq.gate || 0,
      kickEdge,
      snareEdge,
      kickPulse: pq.kickPulse,
      snarePulse: pq.snarePulse,
      driveWas: this.driveHist[0] ?? 1, // ~2.5s ago (1 until history fills)
    };
  }

  conditionMet(def, a) {
    switch (def.trigger) {
      case "beat":
        return a.kickEdge;
      case "bass":
        return a.kickEdge && a.bass > 0.5;
      case "treble":
        return a.treble > 0.55;
      case "loudness":
        return a.drive > 0.55;
      case "quiet":
        return a.gate > 0.4 && a.drive < 0.3;
      default:
        return true; // "random" — still music-gated below
    }
  }

  interval(def) {
    const T = EVENT_TUNING;
    const base = T.rarityIntervals[def.rarity] || 60;
    const mul =
      def.rarity === "rare" ? T.rareEventMultiplier : def.rarity === "legendary" ? T.legendaryEventMultiplier : 1;
    return (base * mul) / Math.max(0.05, T.eventGlobalFrequency);
  }

  update(dt) {
    const pq = this.pq;
    const T = EVENT_TUNING;
    this.clock += dt;
    const a = this.audioSnapshot(dt);

    // lifecycle: advance, update, retire
    for (const st of this.active) {
      st.t += dt;
      st.p = clamp01(st.t / st.dur);
      const f = st.def.fadeSeconds || 0.8;
      st.fade = Math.max(0, Math.min(1, st.t / f, (st.dur - st.t) / f));
      st.def.update?.(st, pq, a, dt, this);
    }
    for (const st of this.active) {
      if (st.t >= st.dur) {
        st.def.onEnd?.(st, pq, this);
        const floor = st.def.rarity === "legendary" ? T.legendaryEventCooldownSeconds : 0;
        this.cooldownUntil[st.def.id] = this.clock + Math.max(st.def.minCooldown, floor);
      }
    }
    this.active = this.active.filter((st) => st.t < st.dur);

    // chapter tier runs its own lifecycle and suppresses new cameos
    this.updateChapter(dt, a);
    if (this.chapter && T.chapterEventSuppressMinorCameos) return;
    // Journey/Arrival (Step 3): the arrival owns the viewer's attention too
    // — no new cameos while it's playing (ambient particles/fireflies are
    // untouched, they're not part of this event system)
    if (this.pq.adventure?.arrival?.phase === "arriving") return;
    // Encounter Moments v1: a major encounter likewise owns the moment
    if (this.pq.adventure?.encounters?.suppressCameos()) return;
    // Story Engine: the director can quiet minor cameos (e.g. to protect a
    // quiet emotional moment). Additive — existing gating still applies.
    if (this.pq.adventure?.story?.minorSuppressed()) return;

    // trigger evaluation — conservative by design
    if (a.gate < 0.4) return; // no music, no magic
    if (this.clock - this.lastAny < T.anyEventCooldownSeconds) return;
    if (this.active.length >= T.maxActive) return;
    const majorActive = this.active.some((s) => s.def.isMajor);
    if (majorActive) return; // majors own the stage

    const candidates = [];
    for (const def of this.defs) {
      // hero-costume showpieces (moonwalk/spin/boombox…) render the OLD
      // procedural hero; keep them off so the imported image hero stays on screen
      if (def.category === "hero" && !T.heroShowpieces) continue;
      if (this.active.some((s) => s.def.category === def.category)) continue; // one per category
      if ((this.cooldownUntil[def.id] || -99) > this.clock) continue;
      if (def.isMajor && this.clock - this.lastMajor < T.majorEventCooldownSeconds) continue;
      if (this.clock - (this.catLast[def.category] ?? -999) < (T.categoryCooldowns[def.category] || 0)) continue;
      if (def.energyRequired && a.drive < def.energyRequired) continue;
      if (def.allowedBiomes && !def.allowedBiomes.includes(pq.palRef?.biome)) continue;
      if (def.when && !def.when(pq, a, this)) continue;
      if (!this.conditionMet(def, a)) continue;
      // probability: expected spacing = interval while the condition holds.
      // Edge triggers roll once per kick (~2/s); continuous triggers per frame.
      const iv = this.interval(def);
      // Biome System v1: a SOFT nudge (unlike allowedBiomes' hard filter) —
      // an event tagged with preferredBiomes still fires everywhere, just
      // more often when the current biome matches
      const biomeBoost = def.preferredBiomes && def.preferredBiomes.includes(pq.palRef?.biome) ? 1.8 : 1;
      const p =
        (def.trigger === "beat" || def.trigger === "bass" ? 0.5 / iv : dt / iv) *
        (def.batch3 ? T.batch3EventWeight : 1) *
        (def.finalBatch ? T.finalBatchEventWeight : 1) *
        (def.batch4 ? T.batch4EventWeight : 1) *
        biomeBoost;
      if (Math.random() < p * T.audioTriggerSensitivity) candidates.push(def);
    }
    if (!candidates.length) return;
    const rank = { legendary: 0, rare: 1, uncommon: 2, common: 3 };
    candidates.sort((x, y) => rank[x.rarity] - rank[y.rarity]); // rarest wins
    this.start(candidates[0]);
  }

  start(def) {
    const dur = def.duration[0] + Math.random() * (def.duration[1] - def.duration[0]);
    const st = { def, t: 0, dur, p: 0, fade: 0, seed: (Math.random() * 1e9) | 0, data: {} };
    def.onStart?.(st, this.pq, this);
    this.active.push(st);
    this.lastAny = this.clock;
    if (def.isMajor) this.lastMajor = this.clock;
    this.catLast[def.category] = this.clock;
    this.cooldownUntil[def.id] = this.clock + def.minCooldown;
    // adventure-layer hook: any sky cameo earns a brief look-up, any
    // door/portal/prop object earns a lean-forward — generic, so it covers
    // the whole catalog (this event and any future one) without each
    // definition needing to know the reaction system exists
    if (def.category === "sky") this.pq.triggerReaction?.("lookup", 0.75);
    else if (def.category === "prop" || def.category === "transition" || def.category === "ground")
      this.pq.triggerReaction?.("lean", 0.65);
    // Story Engine: observe the cameo. Tags come from the event's own
    // `storyTags` if set (e.g. secret_door = Locked Door), else inferred from
    // its category so the whole catalog participates without per-event work.
    this.pq.adventure?.story?.markBeatTriggered(def.id, def.storyTags || CATEGORY_STORY_TAGS[def.category] || ["ambient"]);
    if (EVENT_TUNING.debug)
      console.log(
        `[pixelquest-events] ${def.id} (${def.category}/${def.rarity}) via ${def.trigger} — ${Math.round(dur * 10) / 10}s`
      );
  }

  // debug/test helper: force a specific cameo to fire right now, bypassing
  // cooldowns and gating (used by Adventure Layer debug hooks and manual QA)
  forceStart(id) {
    const def = this.defs.find((d) => d.id === id);
    if (!def) {
      console.warn(`[pixelquest-events] forceStart: unknown id "${id}"`);
      return;
    }
    this.active = this.active.filter((s) => s.def.category !== def.category);
    this.start(def);
  }

  draw(o, pal, layer) {
    for (const st of this.active) {
      if (st.def.layer !== layer) continue;
      if (this._drawEventSprite(o, st, pal)) continue; // imported art when ready
      st.def.draw?.(o, st, this.pq, pal); // procedural fallback
    }
    if (this.chapter) {
      // chapters draw behind the hero on "ground" and over him on "front"
      if (layer === "ground") this.chapter.def.draw?.(o, this.chapter, this.pq, pal);
      if (layer === "front") this.chapter.def.drawFront?.(o, this.chapter, this.pq, pal);
    }
  }

  // Shared art path: if an event declares an `asset` (imported sprite) and a
  // `spriteAt(st,pq,pal)` returning its {x,y[,scale,anchor,alpha]}, draw that
  // sprite (faded by st.fade) instead of the procedural body. `drawExtra` may add
  // live bits (trails, glow) on top. Returns true when it rendered.
  _drawEventSprite(o, st, pal) {
    const def = st.def, pq = this.pq;
    if (!def.asset || !def.spriteAt || !pq.assets?.ready?.(def.asset)) return false;
    const p = def.spriteAt(st, pq, pal);
    if (!p) return false;
    pq.assets.drawSprite(o, def.asset, def.assetAnim || "idle", 0, Math.round(p.x), Math.round(p.y), {
      anchor: p.anchor || def.assetAnchor,
      scale: p.scale ?? def.assetScale ?? 1,
      alpha: p.alpha ?? st.fade,
    });
    def.drawExtra?.(o, st, pq, pal);
    return true;
  }

  // ------------------------------------------------ chapter tier lifecycle
  updateChapter(dt, a) {
    const T = EVENT_TUNING;
    const pq = this.pq;
    if (this.chapter) {
      const st = this.chapter;
      st.t += dt;
      st.p = clamp01(st.t / st.dur);
      st.def.update(st, pq, a, dt, this);
      if (st.t >= st.dur || st.data.done) {
        st.def.onEnd?.(st, pq, this);
        pq.heroCtl = null; // ALWAYS hand the hero back
        this.chapterCooldownUntil[st.def.id] = this.clock + st.def.minCooldown;
        this.lastChapterEnd = this.clock;
        if (T.debug) console.log(`[pixelquest-chapter] ${st.def.id} complete`);
        this.chapter = null;
      }
      return;
    }
    if (!T.chapterEventsEnabled) return;
    if (this.clock < T.chapterEventStartupDelaySeconds) return;
    if (this.clock - this.lastChapterEnd < T.chapterEventGlobalCooldownSeconds) return;
    if (this.clock - this.lastMajor < 20) return; // let big cameos breathe first
    if (this.active.some((s) => s.def.isMajor)) return;
    if (a.gate < 0.5 || a.drive < T.chapterEventMinEnergy) return;
    if (pq.egg || pq.heroJumpY !== 0) return; // hero must be free and grounded
    if (pq.adventure?.arrival?.phase === "arriving") return; // arrival owns the moment
    if (pq.adventure?.encounters?.suppressCameos()) return; // an encounter owns the moment
    for (const def of this.chapterDefs) {
      if ((this.chapterCooldownUntil[def.id] || -99) > this.clock) continue;
      if (def.allowedBiomes && !def.allowedBiomes.includes(pq.palRef?.biome)) continue;
      if (def.when && !def.when(pq, a, this)) continue;
      const cond =
        def.trigger === "quietToLoud"
          ? a.drive > 0.5 && (this.driveHist[0] ?? 1) < 0.3
          : this.conditionMet(def, a);
      if (!cond) continue;
      const iv = this.interval(def) / Math.max(0.05, T.chapterEventChanceMultiplier);
      const p = def.trigger === "beat" || def.trigger === "bass" ? 0.5 / iv : dt / iv;
      if (Math.random() < p * T.audioTriggerSensitivity) {
        this.startChapter(def);
        return;
      }
    }
  }

  startChapter(def) {
    const dur = def.duration[0] + Math.random() * (def.duration[1] - def.duration[0]);
    const st = { def, t: 0, dur, p: 0, seed: (Math.random() * 1e9) | 0, data: {} };
    def.onStart?.(st, this.pq, this);
    this.chapter = st;
    if (EVENT_TUNING.debug)
      console.log(
        `[pixelquest-chapter] ${def.id} (${def.category}/${def.rarity}) via ${def.trigger} — ${Math.round(dur * 10) / 10}s, cameos suppressed`
      );
  }
}

// helper: phase transitions with a debug breadcrumb
function setPhase(st, name) {
  st.data.phase = name;
  if (EVENT_TUNING.debug) console.log(`[pixelquest-chapter] ${st.def.id} → ${name}`);
}

// ------------------------------------------------------------ draw helpers
const SIL = "rgba(12,9,18,0.96)"; // shared silhouette ink

// Story Engine Scaffolding v1: default story tags inferred from a cameo's
// category, so the whole event catalog participates in the story state
// without tagging every one by hand. Individual events can override with
// their own `storyTags` (e.g. secret_door = the Locked Door moment).
const CATEGORY_STORY_TAGS = {
  sky: ["discovery", "mystery", "ambient"],
  hero: ["comedy", "music_energy"],
  ground: ["discovery", "ambient"],
  prop: ["discovery", "ambient"],
  background: ["ambient", "discovery"],
  weather: ["ambient", "music_energy"],
  transition: ["transition", "mystery"],
};

function moonPos(pq, pal) {
  return { mx: Math.round(pq.pw * 0.78), my: Math.round(16 * pq.S) };
}

// Locked Door Moment (Biome System v1): same door mechanic everywhere,
// recolored per biome. RGB triplets as strings so callers can drop them
// straight into an rgba(...) template.
const DOOR_SKINS = {
  "meadow-road": { frame: "58,40,30", rim: "255,190,110", interior: "150,210,255", panel: "84,58,42", handle: "214,178,94" },
  "neon-forest": { frame: "48,60,42", rim: "150,255,220", interior: "170,110,255", panel: "60,74,50", handle: "150,255,220" },
  "moonlit-town": { frame: "40,42,52", rim: "255,214,150", interior: "200,210,255", panel: "50,52,64", handle: "220,225,240" },
  "arcade-ruins": { frame: "40,20,48", rim: "255,90,200", interior: "80,230,255", panel: "54,26,64", handle: "255,220,90" },
  "castle-approach": { frame: "46,42,50", rim: "255,180,90", interior: "255,210,140", panel: "58,52,62", handle: "214,178,94" },
};

function trailSparkle(pq, x, y) {
  if (pq.particles.length < 90 && Math.random() < 0.3) {
    pq.particles.push({ kind: "sparkle", x, y, vx: 0, vy: -2, age: 0, life: 0.3 + Math.random() * 0.2 });
  }
}

// world-anchored roadside spot ahead of the hero, in prop-parallax space
function roadsideSpawn(pq) {
  return pq.scrollX * 0.7 + pq.pw * 0.72;
}
function roadsideX(pq, wx) {
  return Math.round(wx - pq.scrollX * 0.7);
}

// ------------------------------------------------------------ starter pack
export const PIXEL_EVENTS = [
  // 1 ------------------------------------------------ hero: fedora moonwalk
  {
    id: "fedora_moonwalk",
    name: "Fedora Moonwalk",
    category: "hero",
    rarity: "rare",
    trigger: "beat",
    energyRequired: 0.25,
    duration: [3.5, 5],
    minCooldown: 120,
    layer: null, // rendered by the hero/egg system (hat, flip, glide, streaks)
    when: (pq) => !pq.egg && pq.heroJumpY === 0,
    onStart(st, pq) {
      pq.egg = { type: "moonwalk", t: 0, dur: st.dur };
      pq.spawnSparkles();
    },
    update(st, pq, a) {
      if (a.kickEdge) pq.spawnSparkles(); // glove sparkle on the hits
    },
  },

  // ---------------------------------------------------- hero: quick spin
  {
    id: "spin",
    name: "Pirouette",
    category: "hero",
    rarity: "uncommon",
    trigger: "beat",
    energyRequired: 0.25,
    duration: [1.0, 1.1],
    minCooldown: 70,
    layer: null,
    when: (pq) => !pq.egg && pq.heroJumpY === 0,
    onStart(st, pq) {
      pq.egg = { type: "spin", t: 0, dur: st.dur };
      pq.spawnSparkles();
    },
  },

  // 2 ---------------------------------------------- sky: bicycle across moon
  {
    id: "bicycle_moon",
    name: "Bicycle Across the Moon",
    category: "sky",
    preferredBiomes: ["moonlit-town"],
    rarity: "rare",
    trigger: "quiet",
    duration: [6, 8],
    minCooldown: 180,
    isMajor: true,
    layer: "sky",
    draw(o, st, pq, pal) {
      const { mx, my } = moonPos(pq, pal);
      const x = Math.round(mx - 44 + st.p * 88);
      const y = Math.round(my + 5 - Math.sin(st.p * Math.PI) * 9);
      o.fillStyle = SIL;
      for (const wx of [0, 9]) {
        o.fillRect(x + wx - 1, y, 3, 3); // wheels
        o.fillRect(x + wx, y - 1, 1, 5);
      }
      o.fillRect(x, y, 10, 1); // frame
      o.fillRect(x + 3, y - 3, 1, 3); // seat post
      o.fillRect(x + 8, y - 3, 1, 3); // bar post
      o.fillRect(x + 2, y - 4, 3, 1); // seat
      o.fillRect(x + 7, y - 4, 3, 1); // handlebars
      o.fillRect(x + 3, y - 7, 3, 3); // hunched rider
      o.fillRect(x + 5, y - 8, 2, 2); // head
      // the small glowing passenger up front
      o.fillStyle = "rgba(255,240,210,0.95)";
      o.fillRect(x + 10, y - 3, 2, 2);
      trailSparkle(pq, x - 2, y + 1);
    },
  },

  // 3 -------------------------------------------------- sky: witch moon flyby
  {
    id: "witch_moon",
    name: "Witch Moon Flyby",
    category: "sky",
    preferredBiomes: ["moonlit-town"],
    rarity: "uncommon",
    trigger: "treble",
    duration: [4.5, 6],
    minCooldown: 120,
    layer: "sky",
    draw(o, st, pq, pal) {
      const y0 = 12 + (st.seed % 18);
      const x = Math.round(pq.pw + 14 - st.p * (pq.pw + 30));
      const y = Math.round(y0 + Math.sin(st.t * 2.2) * 2);
      o.fillStyle = SIL;
      o.fillRect(x, y + 2, 9, 1); // broom
      o.fillRect(x - 3, y + 1, 3, 3); // bristles
      o.fillRect(x + 4, y - 1, 2, 3); // body
      o.fillRect(x + 3, y + 3, 1, 1); // trailing foot
      o.fillRect(x + 3, y - 2, 4, 1); // hat brim
      o.fillRect(x + 4, y - 4, 2, 2); // hat cone
      o.fillRect(x + 5, y - 5, 1, 1); // hat tip
      trailSparkle(pq, x + 10, y + 1);
    },
  },

  // 4 ------------------------------------------------------ prop: jukebox
  {
    id: "jukebox",
    name: "Jukebox Pulse",
    category: "prop",
    preferredBiomes: ["meadow-road", "neon-forest"],
    rarity: "uncommon",
    trigger: "loudness",
    duration: [7, 10],
    minCooldown: 130,
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = roadsideSpawn(pq);
    },
    update(st, pq, a) {
      if (a.kickEdge && pq.particles.length < 90) {
        const sx = roadsideX(pq, st.data.wx);
        pq.particles.push({
          kind: "sparkle",
          x: sx + 5,
          y: pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) - 16,
          vx: (Math.random() - 0.5) * 4,
          vy: -6,
          age: 0,
          life: 0.5,
        });
      }
    },
    draw(o, st, pq, pal) {
      const sx = roadsideX(pq, st.data.wx);
      if (sx < -14 || sx > pq.pw + 14) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) + 1;
      // rises from the ground, sinks away at the end
      const rise = Math.round((1 - Math.min(1, st.t / 0.9, (st.dur - st.t) / 0.9)) * 15);
      const y = gy - 14 + rise;
      o.save();
      o.beginPath();
      o.rect(sx - 2, gy - 15, 15, 15); // clip so the rise looks like emerging
      o.clip();
      o.fillStyle = "rgb(92,48,66)"; // cabinet
      o.fillRect(sx, y + 2, 11, 12);
      o.fillRect(sx + 1, y + 1, 9, 1); // arched top
      o.fillRect(sx + 2, y, 7, 1);
      const hot = pq.kickPulse;
      o.fillStyle = `rgba(255,${150 + Math.round(hot * 80)},90,${0.8 + hot * 0.2})`; // glowing strip
      o.fillRect(sx + 5, y + 1, 1, 10);
      o.fillStyle = `rgba(120,230,255,${0.45 + hot * 0.5})`; // side lights
      o.fillRect(sx + 2, y + 2, 1, 8);
      o.fillRect(sx + 8, y + 2, 1, 8);
      o.fillStyle = "rgb(34,20,30)"; // speakers
      o.fillRect(sx + 2, y + 11, 2, 2);
      o.fillRect(sx + 7, y + 11, 2, 2);
      o.fillStyle = `rgba(255,220,150,${0.12 + hot * 0.2})`; // pulse halo
      o.fillRect(sx - 2, y - 1, 15, 15);
      o.restore();
    },
  },

  // 5 ------------------------------------------------- prop: arcade cabinet
  {
    id: "arcade_cabinet",
    name: "Arcade Cabinet",
    category: "prop",
    preferredBiomes: ["arcade-ruins"],
    rarity: "uncommon",
    trigger: "loudness",
    duration: [8, 12],
    minCooldown: 150,
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = roadsideSpawn(pq);
    },
    draw(o, st, pq, pal) {
      const sx = roadsideX(pq, st.data.wx);
      if (sx < -12 || sx > pq.pw + 12) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) + 1;
      const a = st.fade;
      const y = gy - 14;
      o.fillStyle = `rgba(38,42,66,${a})`; // cab body
      o.fillRect(sx, y, 9, 14);
      o.fillRect(sx + 1, y - 1, 7, 1); // marquee cap
      const flick = 0.55 + pq.treble.value * 0.35 + (Math.random() < 0.06 ? 0.25 : 0); // screen flicker
      o.fillStyle = `rgba(120,235,210,${flick * a})`;
      o.fillRect(sx + 2, y + 2, 5, 4); // screen
      o.fillStyle = `rgba(30,60,54,${a})`;
      o.fillRect(sx + 3, y + 4, 2, 1); // little sprite on screen
      o.fillStyle = `rgba(255,90,110,${(0.7 + pq.kickPulse * 0.3) * a})`;
      o.fillRect(sx + 3, y + 8, 1, 1); // joystick + button
      o.fillRect(sx + 6, y + 8, 1, 1);
      o.fillStyle = `rgba(120,235,210,${(0.08 + pq.kickPulse * 0.12) * a})`; // glow
      o.fillRect(sx - 2, y - 2, 13, 17);
    },
  },

  // 6 ------------------------------------------------- weather: purple rain
  {
    id: "purple_rain",
    name: "Purple Rain",
    category: "weather",
    rarity: "rare",
    trigger: "loudness",
    energyRequired: 0.5,
    duration: [10, 15],
    minCooldown: 240,
    isMajor: true,
    fadeSeconds: 2,
    layer: "front",
    onStart(st) {
      st.data.drops = Array.from({ length: 46 }, () => ({
        x: Math.random(),
        y: Math.random(),
        v: 0.55 + Math.random() * 0.45,
      }));
    },
    update(st, pq, a, dt) {
      for (const d of st.data.drops) {
        d.y += d.v * dt * (0.9 + pq.treble.value * 0.5);
        if (d.y > 1) {
          d.y -= 1;
          d.x = Math.random();
        }
      }
    },
    draw(o, st, pq) {
      const f = st.fade;
      o.fillStyle = `rgba(110,55,180,${0.1 * f})`; // the whole scene leans purple
      o.fillRect(0, 0, pq.pw, pq.ph);
      const n = Math.round(st.data.drops.length * (0.55 + pq.loud.value * 0.45));
      for (let i = 0; i < n; i++) {
        const d = st.data.drops[i];
        o.fillStyle = `rgba(190,120,255,${(0.4 + (i % 3) * 0.15) * f})`;
        o.fillRect(Math.round(d.x * pq.pw), Math.round(d.y * pq.ph), 1, 3);
      }
    },
  },

  // 7 ------------------------------------------------- ground: boulder chase
  {
    id: "boulder_chase",
    name: "Boulder Chase",
    category: "ground",
    rarity: "rare",
    trigger: "bass",
    energyRequired: 0.4,
    duration: [4.5, 7],
    minCooldown: 200,
    isMajor: true,
    layer: "ground",
    onStart(st) {
      st.data.x = -26;
    },
    update(st, pq, a, dt) {
      const target = pq.pw * pq.heroAnchor - 27; // menacing, never catching
      if (st.p < 0.72) st.data.x += (target - st.data.x) * Math.min(1, dt * 1.5);
      else st.data.x -= 60 * dt; // gives up, rolls away behind
    },
    draw(o, st, pq) {
      const r = 7;
      const cx = Math.round(st.data.x);
      if (cx < -12) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, cx))) + 1;
      const bounce = Math.round(Math.abs(Math.sin(st.t * 9)) * (1 + pq.kickPulse * 3));
      const cy = gy - r - bounce;
      o.fillStyle = "rgba(0,0,0,0.3)";
      o.fillRect(cx - r + 2, gy - 1, r * 2 - 4, 1); // shadow
      o.fillStyle = "rgb(96,84,72)";
      pq.pixelDisc(o, cx, cy, r);
      o.fillStyle = "rgb(72,62,52)"; // shaded underside
      o.fillRect(cx - r + 2, cy + 3, r * 2 - 4, 3);
      const ang = st.t * 7; // rolling chip highlight
      o.fillStyle = "rgb(134,120,102)";
      o.fillRect(cx + Math.round(Math.cos(ang) * (r - 3)), cy + Math.round(Math.sin(ang) * (r - 3)), 2, 2);
    },
  },

  // 8 -------------------------------------------- background: castle lightning
  {
    id: "castle_lightning",
    name: "Castle Lightning",
    category: "background",
    preferredBiomes: ["castle-approach"],
    rarity: "uncommon",
    trigger: "bass",
    duration: [5, 8],
    minCooldown: 140,
    layer: "background",
    onStart(st, pq) {
      st.data.sx = Math.round(pq.pw * (0.5 + ((st.seed % 100) / 100) * 0.35));
      st.data.bolt = 0;
      st.data.next = 0.3;
    },
    update(st, pq, a, dt) {
      st.data.bolt -= dt;
      if (a.kickEdge && st.t > st.data.next) {
        st.data.bolt = 0.14;
        st.data.next = st.t + 0.7;
        st.data.bseed = (Math.random() * 1e9) | 0;
      }
    },
    draw(o, st, pq, pal) {
      const sx = st.data.sx;
      const base = pq.groundBase();
      const h = Math.round(20 * pq.S);
      const a = st.fade;
      o.fillStyle = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.35), a); // distant keep
      o.fillRect(sx, base - h, 8, h);
      o.fillRect(sx + 9, base - Math.round(h * 0.6), 5, Math.round(h * 0.6));
      for (let i = 0; i < 4; i++) o.fillRect(sx + i * 2, base - h - 2, 1, 2); // crenellation
      if (st.data.bolt > 0) {
        o.fillStyle = `rgba(205,215,255,${0.09 * a})`; // sky flash
        o.fillRect(0, 0, pq.pw, base - 4);
        o.fillStyle = "rgba(235,242,255,0.95)"; // jagged bolt above the keep
        let bx = sx + 4;
        let by = base - h - 2;
        let s = st.data.bseed;
        for (let k = 0; k < 6; k++) {
          s = (s * 1664525 + 1013904223) >>> 0;
          bx += (s % 5) - 2;
          by -= 3;
          o.fillRect(bx, by, 1, 3);
        }
        o.fillStyle = `rgba(255,230,150,${0.6 * a})`; // a window catches the light
        o.fillRect(sx + 3, base - Math.round(h * 0.5), 1, 2);
      }
    },
  },

  // 9 ------------------------------------------------ hero: boombox pose
  {
    id: "boombox_pose",
    name: "Boombox Overhead",
    category: "hero",
    preferredBiomes: ["arcade-ruins"],
    rarity: "rare",
    trigger: "beat",
    duration: [3.5, 5],
    minCooldown: 160,
    layer: null, // drawn by drawHero's boombox overlay
    // the classic gesture wants a quiet-to-loud swell
    when: (pq, a, mgr) => !pq.egg && pq.heroJumpY === 0 && a.drive > 0.45 && (mgr.driveHist[0] ?? 1) < 0.3,
    onStart(st, pq) {
      pq.egg = { type: "boombox", t: 0, dur: st.dur };
    },
  },

  // 10 ------------------------------------------- transition: glowing portal
  {
    id: "portal_transition",
    name: "Portal Transition",
    category: "transition",
    preferredBiomes: ["neon-forest"],
    rarity: "rare",
    trigger: "loudness",
    energyRequired: 0.6,
    duration: [5.5, 8],
    minCooldown: 300,
    isMajor: true,
    fadeSeconds: 1.2,
    layer: "front",
    update(st, pq) {
      // halfway through, the world beyond the portal becomes somewhere else
      if (!st.data.warped && st.p > 0.5 && pq.biomeT >= 1) {
        st.data.warped = true;
        pq.biomeNext = (pq.biomeIdx + 1 + ((Math.random() * (pq.biomeCount - 1)) | 0)) % pq.biomeCount;
        pq.biomeT = 0;
      }
    },
    draw(o, st, pq) {
      const cx = Math.round(pq.pw * 0.55);
      const gy = pq.groundY(cx);
      const cy = gy - 11;
      const open = Math.min(1, st.t / 0.8, (st.dur - st.t) / 0.8);
      const rx = (5 + pq.kickPulse * 1.5) * open;
      const ry = 11 * open;
      if (open <= 0.02) return;
      o.fillStyle = `rgba(150,80,255,${0.08 * st.fade})`; // inner shimmer
      pq.pixelDisc(o, cx, cy, Math.round(Math.min(rx, ry) * 0.8));
      const spin = Math.floor(st.t * 10);
      for (let k = 0; k < 26; k++) {
        const ang = (k / 26) * TAU;
        const px = cx + Math.round(Math.cos(ang) * rx);
        const py = cy + Math.round(Math.sin(ang) * ry);
        o.fillStyle = (k + spin) % 2 ? `rgba(160,90,255,${0.9 * st.fade})` : `rgba(120,235,255,${0.9 * st.fade})`;
        o.fillRect(px, py, 1, 1);
      }
      trailSparkle(pq, cx + (Math.random() - 0.5) * 10, cy + (Math.random() - 0.5) * 14);
    },
  },

  // ==================================================== BATCH 2 ============

  // 1 ---------------------------------------------- hero: glowing red shoes
  {
    id: "red_shoes_sprint",
    name: "Glowing Red Shoes",
    category: "hero",
    rarity: "rare",
    trigger: "beat",
    energyRequired: 0.35,
    duration: [4, 6],
    minCooldown: 150,
    layer: null, // costume rendered by drawHero (boots recolor + ember glow)
    when: (pq) => !pq.egg && pq.heroJumpY === 0,
    onStart(st, pq) {
      pq.egg = { type: "redshoes", t: 0, dur: st.dur };
    },
    update(st, pq, a) {
      if (a.kickEdge && pq.particles.length < 90) {
        pq.particles.push({
          kind: "ember",
          x: pq.pw * pq.heroAnchor - 4 + Math.random() * 8,
          y: pq.groundY(Math.round(pq.pw * pq.heroAnchor)) - 1,
          vx: -(12 + Math.random() * 8),
          vy: -(2 + Math.random() * 4),
          age: 0,
          life: 0.4,
        });
      }
    },
  },

  // 2 ------------------------------------------- ground: yellow glowing road
  {
    id: "yellow_glowing_road",
    name: "Yellow Glowing Road",
    category: "ground",
    rarity: "rare",
    trigger: "beat",
    energyRequired: 0.3,
    duration: [8, 12],
    minCooldown: 200,
    fadeSeconds: 1.5,
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = pq.scrollX + pq.pw * 0.3; // laid on the ground ahead
    },
    draw(o, st, pq) {
      const x0 = Math.round(st.data.wx - pq.scrollX);
      const len = 90;
      if (x0 + len < 0 || x0 > pq.pw) return;
      const warm = pq.bass.value;
      for (let x = Math.max(0, x0); x < Math.min(pq.pw, x0 + len); x++) {
        const gy = pq.groundY(x);
        const edge = Math.min(1, (x - x0) / 10, (x0 + len - x) / 10); // soft ends
        o.fillStyle = `rgba(255,${200 + Math.round(warm * 40)},70,${(0.55 + warm * 0.3) * st.fade * edge}`;
        o.fillRect(x, gy, 1, 2);
        if ((x + (pq.scrollX | 0)) % 7 === 0) {
          o.fillStyle = `rgba(255,235,150,${0.8 * st.fade * edge})`;
          o.fillRect(x, gy, 1, 1); // brighter paving stones
        }
      }
      if (pq.treble.value > 0.45 && Math.random() < 0.3) {
        trailSparkle(pq, x0 + Math.random() * len, pq.groundY(Math.round(pq.pw / 2)) - 2);
      }
    },
  },

  // 3 --------------------------------------------- ground: red balloon grate
  {
    id: "red_balloon_grate",
    name: "Red Balloon From Grate",
    category: "ground",
    preferredBiomes: ["meadow-road", "neon-forest"],
    rarity: "rare",
    trigger: "quiet",
    duration: [7, 10],
    minCooldown: 220,
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = pq.scrollX + pq.pw * 0.58;
    },
    draw(o, st, pq) {
      const sx = Math.round(st.data.wx - pq.scrollX);
      if (sx < -10 || sx > pq.pw + 10) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) + 1;
      // the grate: dark slats set into the ground
      o.fillStyle = `rgba(14,11,18,${st.fade})`;
      o.fillRect(sx - 3, gy - 1, 8, 2);
      o.fillStyle = `rgba(52,46,58,${st.fade})`;
      for (let k = 0; k < 4; k++) o.fillRect(sx - 2 + k * 2, gy - 1, 1, 1);
      // the balloon, rising slowly, swaying gently
      const rise = st.p * 46;
      const bx = sx + Math.round(Math.sin(st.t * 1.1) * 2);
      const by = Math.round(gy - 6 - rise);
      o.fillStyle = `rgba(200,40,44,${0.95 * st.fade})`;
      o.fillRect(bx - 1, by - 2, 4, 4);
      o.fillRect(bx, by - 3, 2, 6);
      o.fillStyle = `rgba(255,${120 + Math.round(pq.treble.value * 80)},120,${0.8 * st.fade})`;
      o.fillRect(bx, by - 2, 1, 1); // shine, shimmering with treble
      o.fillStyle = `rgba(180,170,180,${0.5 * st.fade})`;
      o.fillRect(bx + 1, by + 3, 1, Math.min(5, Math.round(gy - by - 3))); // string
    },
  },

  // 4 ---------------------------------------------- ground: black cat crossing
  {
    id: "black_cat_crossing",
    name: "Black Cat Crossing",
    category: "ground",
    preferredBiomes: ["meadow-road", "neon-forest"],
    rarity: "uncommon",
    trigger: "treble",
    duration: [3.5, 5],
    minCooldown: 110,
    layer: "ground",
    draw(o, st, pq) {
      // pads across the road, right to left
      const x = Math.round(pq.pw * 0.75 - st.p * pq.pw * 0.55);
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, x))) + 1;
      const step = Math.floor(st.t * 6) % 2;
      o.fillStyle = "rgb(10,8,14)";
      o.fillRect(x, gy - 4, 7, 2); // body
      o.fillRect(x - 1, gy - 5, 3, 2); // head
      o.fillRect(x - 1, gy - 6, 1, 1); // ears
      o.fillRect(x + 1, gy - 6, 1, 1);
      // tail: one flick mid-crossing
      const tailUp = st.p > 0.45 && st.p < 0.6;
      o.fillRect(x + 7, gy - (tailUp ? 7 : 5), 1, tailUp ? 3 : 2);
      // legs alternate
      o.fillRect(x + (step ? 1 : 2), gy - 2, 1, 2);
      o.fillRect(x + (step ? 5 : 4), gy - 2, 1, 2);
      if (pq.treble.value > 0.5) {
        o.fillStyle = "rgba(140,255,140,0.9)"; // eye glint
        o.fillRect(x, gy - 5, 1, 1);
      }
    },
  },

  // 5 -------------------------------------------- ground: cassette tumbleweed
  {
    id: "cassette_tumbleweed",
    name: "Cassette Tumbleweed",
    category: "ground",
    preferredBiomes: ["arcade-ruins"],
    rarity: "uncommon",
    trigger: "random",
    energyRequired: 0.25,
    duration: [5, 7],
    minCooldown: 120,
    layer: "ground",
    draw(o, st, pq) {
      const x = Math.round(pq.pw + 10 - st.p * (pq.pw + 30));
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, x))) + 1;
      const hop = Math.round(Math.abs(Math.sin(st.t * 6)) * (2 + pq.kickPulse * 3));
      const y = gy - 5 - hop;
      const frame = Math.floor(st.t * 8) % 4; // tumbling
      o.save();
      if (frame % 2 === 1) {
        // "rotated": draw tall
        o.fillStyle = "rgb(30,28,36)";
        o.fillRect(x + 1, y - 1, 5, 7);
        o.fillStyle = "rgb(200,190,170)";
        o.fillRect(x + 2, y + 1, 3, 3);
      } else {
        o.fillStyle = "rgb(30,28,36)";
        o.fillRect(x, y, 7, 5);
        o.fillStyle = "rgb(200,190,170)"; // label
        o.fillRect(x + 1, y + 1, 5, 2);
        o.fillStyle = "rgb(60,56,68)"; // spools
        o.fillRect(x + 1, y + 3, 1, 1);
        o.fillRect(x + 5, y + 3, 1, 1);
      }
      o.restore();
    },
  },

  // 6 ---------------------------------------------- weather: VHS tracking
  {
    id: "vhs_tracking",
    name: "VHS Tracking Moment",
    category: "weather",
    preferredBiomes: ["arcade-ruins"],
    rarity: "rare",
    trigger: "loudness",
    energyRequired: 0.55,
    duration: [4, 7],
    minCooldown: 260,
    isMajor: true,
    fadeSeconds: 1,
    layer: "front",
    update(st, pq, a) {
      if (a.kickEdge) st.data.jit = 0.1; // brief tear on strong beats
      st.data.jit = Math.max(0, (st.data.jit || 0) - 0.016);
    },
    draw(o, st, pq) {
      const f = st.fade;
      // a tracking band drifting down the screen
      const bandY = Math.round(((st.t * 22) % (pq.ph + 20)) - 10);
      o.fillStyle = `rgba(220,220,220,${0.1 * f})`;
      o.fillRect(0, bandY, pq.pw, 2);
      o.fillStyle = `rgba(255,120,255,${0.08 * f})`; // chroma fringe
      o.fillRect(0, bandY - 1, pq.pw, 1);
      o.fillStyle = `rgba(120,255,160,${0.08 * f})`;
      o.fillRect(0, bandY + 2, pq.pw, 1);
      // faint scanlines
      o.fillStyle = `rgba(0,0,0,${0.05 * f})`;
      for (let y = (st.seed % 3); y < pq.ph; y += 3) o.fillRect(0, y, pq.pw, 1);
      // the tear: self-copy a band, shifted sideways
      if ((st.data.jit || 0) > 0) {
        const ty = Math.max(0, Math.min(pq.ph - 8, bandY + 6));
        o.drawImage(pq.off, 0, ty, pq.pw, 6, 3, ty, pq.pw, 6);
      }
    },
  },

  // 7 ------------------------------------------ background: robot duo horizon
  {
    id: "robot_duo",
    name: "Robot Duo on the Horizon",
    category: "background",
    rarity: "rare",
    trigger: "quiet",
    duration: [9, 12],
    minCooldown: 220,
    layer: "background",
    draw(o, st, pq, pal) {
      const base = pq.groundBase() - Math.round(10 * pq.S);
      const x = Math.round(pq.pw * 0.15 + st.p * pq.pw * 0.5);
      const bob = Math.floor(st.t * 3) % 2;
      const c = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.3), st.fade);
      o.fillStyle = c;
      // the tall one
      o.fillRect(x, base - 8 - bob, 3, 8); // body
      o.fillRect(x, base - 10 - bob, 3, 2); // head
      o.fillRect(x - 1, base - 9 - bob, 1, 3); // arm
      // the short round one, rolling beside
      o.fillRect(x + 6, base - 4, 4, 4);
      o.fillRect(x + 7, base - 5, 2, 1); // dome
      if (pq.treble.value > 0.5) {
        o.fillStyle = `rgba(255,200,120,${0.9 * st.fade})`; // eyes blink
        o.fillRect(x + 1, base - 10 - bob, 1, 1);
        o.fillStyle = `rgba(120,180,255,${0.9 * st.fade})`;
        o.fillRect(x + 7, base - 4, 1, 1);
      }
    },
  },

  // 8 --------------------------------------- background: crane kick silhouette
  {
    id: "crane_kick",
    name: "Crane Kick Silhouette",
    category: "background",
    rarity: "rare",
    trigger: "bass",
    duration: [3.5, 5],
    minCooldown: 240,
    layer: "background",
    update(st, pq, a) {
      if (a.kickEdge) st.data.pose = 0.5; // strike the pose on the hit
      st.data.pose = Math.max(0, (st.data.pose || 0) - 0.016);
    },
    draw(o, st, pq, pal) {
      const base = pq.groundBase();
      const x = Math.round(pq.pw * 0.68);
      const f = st.fade;
      // the mound he stands on, moonlit from behind
      o.fillStyle = `rgba(255,220,160,${0.1 * f})`;
      pq.pixelDisc(o, x + 3, base - 12, 8);
      o.fillStyle = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.4), f);
      for (let i = 0; i < 5; i++) o.fillRect(x - 6 + i, base - 5 + Math.abs(i - 2) - 4, 13 - i * 2 + (i % 2), 5);
      const posed = (st.data.pose || 0) > 0;
      // the figure
      o.fillRect(x + 2, base - 16, 2, 4); // torso
      o.fillRect(x + 2, base - 18, 2, 2); // head
      if (posed) {
        o.fillRect(x - 1, base - 16, 3, 1); // arms out
        o.fillRect(x + 4, base - 16, 3, 1);
        o.fillRect(x + 2, base - 12, 1, 3); // standing leg
        o.fillRect(x + 4, base - 13, 2, 1); // raised knee
      } else {
        o.fillRect(x + 1, base - 15, 1, 2); // arms down
        o.fillRect(x + 4, base - 15, 1, 2);
        o.fillRect(x + 2, base - 12, 1, 3);
        o.fillRect(x + 3, base - 12, 1, 3);
      }
    },
  },

  // 9 ------------------------------------------- hero: levitating board glide
  {
    id: "hover_board",
    name: "Levitating Board Glide",
    category: "hero",
    rarity: "rare",
    trigger: "loudness",
    energyRequired: 0.55,
    duration: [4, 6],
    minCooldown: 200,
    layer: null, // board + lift rendered by drawHero
    when: (pq) => !pq.egg && pq.heroJumpY === 0,
    onStart(st, pq) {
      pq.egg = { type: "hoverboard", t: 0, dur: st.dur };
    },
    update(st, pq, a) {
      if (pq.particles.length < 90 && (a.kickEdge || Math.random() < 0.15)) {
        pq.particles.push({
          kind: "sparkle",
          x: pq.pw * pq.heroAnchor - 6,
          y: pq.groundY(Math.round(pq.pw * pq.heroAnchor)) - 6 - Math.random() * 4,
          vx: -(16 + Math.random() * 10),
          vy: (Math.random() - 0.5) * 3,
          age: 0,
          life: 0.4,
        });
      }
    },
  },

  // 10 ------------------------------------------------ prop: sword from stone
  {
    id: "sword_in_stone",
    name: "Sword From Stone",
    category: "prop",
    preferredBiomes: ["neon-forest"],
    rarity: "rare",
    trigger: "bass",
    duration: [7, 10],
    minCooldown: 240,
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = roadsideSpawn(pq);
    },
    draw(o, st, pq) {
      const sx = roadsideX(pq, st.data.wx);
      if (sx < -10 || sx > pq.pw + 10) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) + 1;
      const f = st.fade;
      // the stone
      o.fillStyle = `rgba(96,96,108,${f})`;
      o.fillRect(sx - 4, gy - 4, 9, 4);
      o.fillRect(sx - 3, gy - 5, 7, 1);
      o.fillStyle = `rgba(70,70,82,${f})`;
      o.fillRect(sx - 4, gy - 2, 9, 2);
      // the sword, risen slightly — glow pulses on the bass
      const rise = Math.round(Math.min(1, st.t / 1.5) * 4);
      const tipY = gy - 12 - rise;
      const glow = 0.15 + pq.bass.value * 0.25 + pq.kickPulse * 0.2;
      o.fillStyle = `rgba(200,230,255,${glow * f})`;
      o.fillRect(sx - 2, tipY - 1, 5, 12 + rise); // halo
      o.fillStyle = `rgba(225,235,250,${0.95 * f})`;
      o.fillRect(sx, tipY, 1, 8 + rise); // blade
      o.fillStyle = `rgba(214,178,94,${f})`;
      o.fillRect(sx - 2, gy - 7 - rise, 5, 1); // crossguard
      o.fillRect(sx, gy - 9 - rise, 1, 2); // grip
      if (pq.treble.value > 0.5) trailSparkle(pq, sx + (Math.random() - 0.5) * 4, tipY);
    },
  },

  // 11 --------------------------------------- sky: winged vigilante moon shadow
  {
    id: "winged_moon_shadow",
    name: "Winged Moon Shadow",
    category: "sky",
    preferredBiomes: ["moonlit-town"],
    rarity: "rare",
    trigger: "treble",
    duration: [4, 6],
    minCooldown: 220,
    layer: "sky",
    draw(o, st, pq, pal) {
      const { mx, my } = moonPos(pq, pal);
      // the moon glows a touch brighter while the shadow passes
      o.fillStyle = pq.col(pal.moon, 0.1 * st.fade);
      pq.pixelDisc(o, mx, my, Math.round(8 * pq.S * 0.28) + 4);
      const x = Math.round(mx - 30 + st.p * 60);
      const y = Math.round(my - 2 + Math.sin(st.p * Math.PI) * -4);
      const up = Math.floor(st.t * 5) % 2 === 0;
      o.fillStyle = "rgba(10,8,16,0.95)";
      o.fillRect(x, y, 3, 2); // body
      o.fillRect(x, y - 1, 1, 1); // horns/ears
      o.fillRect(x + 2, y - 1, 1, 1);
      const wy = up ? -1 : 0;
      o.fillRect(x - 4, y + wy, 4, 1); // scalloped wings
      o.fillRect(x - 3, y + wy + 1, 2, 1);
      o.fillRect(x + 3, y + wy, 4, 1);
      o.fillRect(x + 4, y + wy + 1, 2, 1);
    },
  },

  // 12 ------------------------------------- background: rainy detective corner
  {
    id: "rainy_detective",
    name: "Rainy Detective",
    category: "background",
    rarity: "rare",
    trigger: "quiet",
    duration: [9, 12],
    minCooldown: 260,
    fadeSeconds: 1.5,
    layer: "background",
    onStart(st) {
      st.data.drops = Array.from({ length: 14 }, () => ({ x: Math.random(), y: Math.random() }));
    },
    update(st, pq, a, dt) {
      for (const d of st.data.drops) {
        d.y += dt * 0.9;
        if (d.y > 1) {
          d.y -= 1;
          d.x = Math.random();
        }
      }
    },
    draw(o, st, pq, pal) {
      const f = st.fade;
      const x = Math.round(pq.pw * 0.82);
      const base = pq.groundBase() - Math.round(6 * pq.S);
      // streetlamp, breathing with the music
      o.fillStyle = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.3), f);
      o.fillRect(x + 10, base - 18, 1, 18);
      o.fillRect(x + 8, base - 19, 5, 2);
      const lampA = (0.3 + pq.loud.value * 0.3 + pq.kickPulse * 0.15) * f;
      o.fillStyle = `rgba(255,220,150,${lampA})`;
      o.fillRect(x + 9, base - 17, 3, 2); // lamp head
      o.fillStyle = `rgba(255,220,150,${lampA * 0.25})`;
      o.fillRect(x + 5, base - 16, 11, 16); // light cone
      // trench-coat silhouette under the lamp, walking slowly
      const wx = Math.round(x + 2 + st.p * 7);
      const step = Math.floor(st.t * 3) % 2;
      o.fillStyle = `rgba(14,11,18,${0.95 * f})`;
      o.fillRect(wx, base - 8, 3, 5); // coat
      o.fillRect(wx - 1, base - 4, 5, 1); // coat flare
      o.fillRect(wx, base - 3, 1 + step, 3); // legs
      o.fillRect(wx + 2 - step, base - 3, 1, 3);
      o.fillRect(wx, base - 10, 3, 2); // head
      o.fillRect(wx - 1, base - 9, 5, 1); // hat brim
      // a small column of local rain
      o.fillStyle = `rgba(160,180,220,${0.35 * f})`;
      for (const d of st.data.drops) {
        o.fillRect(Math.round(x - 2 + d.x * 22), Math.round(base - 20 + d.y * 20), 1, 2);
      }
    },
  },

  // 13 ------------------------------------------------- sky: dragon shadow
  {
    id: "dragon_shadow",
    name: "Dragon Shadow",
    category: "sky",
    preferredBiomes: ["moonlit-town"],
    rarity: "rare",
    trigger: "loudness",
    energyRequired: 0.5,
    duration: [6, 8],
    minCooldown: 280,
    isMajor: true,
    layer: "sky",
    draw(o, st, pq) {
      const x = Math.round(pq.pw + 20 - st.p * (pq.pw + 50));
      const y = Math.round(10 + (st.seed % 10) + Math.sin(st.t * 1.1) * 3);
      const flap = Math.sin(st.t * 2.4); // slow wingbeats
      o.fillStyle = "rgba(10,8,16,0.9)";
      o.fillRect(x, y, 14, 2); // long body
      o.fillRect(x + 14, y - 1, 3, 2); // neck
      o.fillRect(x + 17, y - 2, 3, 2); // head
      o.fillRect(x + 20, y - 1, 1, 1); // snout
      o.fillRect(x - 4, y + 1, 4, 1); // tail
      o.fillRect(x - 6, y + 2, 2, 1); // tail tip
      const wy = Math.round(flap * 3);
      o.fillRect(x + 4, y - 1 + Math.min(0, wy), 2, Math.abs(wy) + 1); // near wing
      o.fillRect(x + 3, y + wy - 1, 5, 1); // wing membrane
      o.fillRect(x + 8, y - 1 + Math.min(0, Math.round(wy * 0.7)), 2, Math.abs(Math.round(wy * 0.7)) + 1); // far wing
      // faint warm presence in the sky on the kicks
      if (pq.kickPulse > 0.4) {
        o.fillStyle = `rgba(255,160,90,${0.05 * pq.kickPulse})`;
        o.fillRect(0, 0, pq.pw, Math.round(pq.ph * 0.4));
      }
    },
  },

  // 14 --------------------------------------------------- sky: disco moon
  {
    id: "disco_moon",
    name: "Disco Moon",
    category: "sky",
    preferredBiomes: ["moonlit-town"],
    rarity: "rare",
    trigger: "treble",
    energyRequired: 0.4,
    duration: [8, 12],
    minCooldown: 280,
    fadeSeconds: 1.5,
    layer: "sky",
    update(st, pq, a) {
      if (a.kickEdge && pq.particles.length < 88) {
        const { mx, my } = moonPos(pq, pq.palRef);
        for (let k = 0; k < 3; k++) {
          const ang = Math.random() * TAU;
          pq.particles.push({
            kind: "sparkle",
            x: mx + Math.cos(ang) * 12,
            y: my + Math.sin(ang) * 12,
            vx: Math.cos(ang) * 14,
            vy: Math.sin(ang) * 14,
            age: 0,
            life: 0.4,
          });
        }
      }
    },
    draw(o, st, pq, pal) {
      const { mx, my } = moonPos(pq, pal);
      const r = Math.round((pal.biome === "sunset_plains" ? 7 : 5) * pq.S);
      const f = st.fade;
      // mirrored facets over the moon face: a checker of light and shadow
      o.save();
      o.globalAlpha = f;
      o.fillStyle = pq.col(pal.moon);
      pq.pixelDisc(o, mx, my, r);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const cell = ((dx >> 1) + (dy >> 1)) & 1;
          const twinkle = ((dx * 7 + dy * 13 + Math.floor(st.t * 6)) % 11) === 0;
          o.fillStyle = twinkle ? "rgba(255,255,255,0.95)" : cell ? "rgba(120,140,200,0.5)" : "rgba(235,240,255,0.35)";
          o.fillRect(mx + dx, my + dy, 1, 1);
        }
      }
      o.restore();
    },
  },

  // 15 -------------------------------------------------- sky: record moon
  {
    id: "record_moon",
    name: "Record Moon",
    category: "sky",
    preferredBiomes: ["moonlit-town"],
    rarity: "rare",
    trigger: "random",
    energyRequired: 0.3,
    duration: [8, 12],
    minCooldown: 280,
    fadeSeconds: 1.5,
    layer: "sky",
    draw(o, st, pq, pal) {
      const { mx, my } = moonPos(pq, pal);
      const r = Math.round((pal.biome === "sunset_plains" ? 7 : 5) * pq.S) + 1;
      const f = st.fade;
      o.save();
      o.globalAlpha = f;
      o.fillStyle = "rgb(16,14,20)"; // vinyl
      pq.pixelDisc(o, mx, my, r);
      // grooves: two thin rings
      for (const gr of [r - 2, r - 5]) {
        for (let k = 0; k < 24; k++) {
          const ang = (k / 24) * TAU;
          o.fillStyle = "rgba(70,66,84,0.7)";
          o.fillRect(mx + Math.round(Math.cos(ang) * gr), my + Math.round(Math.sin(ang) * gr), 1, 1);
        }
      }
      o.fillStyle = "rgb(214,120,88)"; // label
      pq.pixelDisc(o, mx, my, 3);
      o.fillStyle = "rgb(10,8,14)";
      o.fillRect(mx, my, 1, 1); // spindle hole
      // the rotation you can see: one dot riding the groove
      const ang = st.t * 2.2;
      o.fillStyle = "rgba(230,235,255,0.9)";
      o.fillRect(mx + Math.round(Math.cos(ang) * (r - 3)), my + Math.round(Math.sin(ang) * (r - 3)), 1, 1);
      o.restore();
      if (pq.treble.value > 0.5) trailSparkle(pq, mx + (Math.random() - 0.5) * r * 2, my - r);
    },
  },

  // ==================================================== BATCH 3 ============

  // 1 ----------------------------------------- ground: time-trail sports car
  {
    id: "time_trail_car",
    name: "Time-Trail Sports Car",
    category: "ground",
    preferredBiomes: ["arcade-ruins"],
    rarity: "legendary",
    trigger: "bass",
    energyRequired: 0.5,
    duration: [4.5, 6.5],
    minCooldown: 300,
    isMajor: true,
    batch3: true,
    layer: "ground",
    draw(o, st, pq) {
      // the car blasts through in the first 1.4s; its fire trails linger
      const cross = clamp01(st.t / 1.4);
      const carX = Math.round(-20 + cross * (pq.pw + 44));
      const x0 = Math.max(0, Math.round(-20 + 4));
      const trailEnd = Math.min(carX - 10, pq.pw);
      const trailA = st.fade * (0.35 + pq.bass.value * 0.35 + pq.kickPulse * 0.3);
      for (let x = x0; x < trailEnd; x += 2) {
        const gy2 = pq.groundY(Math.max(0, Math.min(pq.pw - 1, x))) - 1;
        o.fillStyle = `rgba(255,${140 + Math.round(pq.kickPulse * 70)},60,${trailA})`;
        o.fillRect(x, gy2, 2, 1); // twin fire lines
        o.fillStyle = `rgba(255,225,130,${trailA * 0.7})`;
        o.fillRect(x + 1, gy2 - 1, 1, 1);
      }
      if (cross < 1) {
        const cy2 = pq.groundY(Math.max(0, Math.min(pq.pw - 1, carX))) - 1;
        o.fillStyle = "rgb(16,13,22)"; // generic wedge silhouette
        o.fillRect(carX - 6, cy2 - 2, 12, 2);
        o.fillRect(carX - 3, cy2 - 3, 6, 1);
        o.fillStyle = "rgba(150,220,255,0.85)";
        o.fillRect(carX - 1, cy2 - 3, 2, 1); // windshield glint
        o.fillStyle = "rgb(10,8,14)";
        o.fillRect(carX - 5, cy2, 2, 1); // wheels
        o.fillRect(carX + 3, cy2, 2, 1);
      }
    },
  },

  // 2 ------------------------------------------------- hero: whip swing
  {
    id: "whip_swing",
    name: "Whip Swing",
    category: "hero",
    preferredBiomes: ["castle-approach"],
    rarity: "rare",
    trigger: "beat",
    energyRequired: 0.35,
    duration: [2.6, 3.4],
    minCooldown: 170,
    batch3: true,
    layer: null, // arc + whip line rendered by drawHero
    when: (pq) => !pq.egg && pq.heroJumpY === 0,
    onStart(st, pq) {
      pq.egg = { type: "whipswing", t: 0, dur: st.dur };
    },
    update(st, pq, a) {
      if (a.kickEdge) pq.spawnSparkles();
    },
  },

  // 3 --------------------------------------------- ground: shark fin pond
  {
    id: "shark_fin_pond",
    name: "Shark Fin Pond",
    category: "ground",
    rarity: "uncommon",
    trigger: "quiet",
    duration: [6, 8],
    minCooldown: 140,
    batch3: true,
    fadeSeconds: 1,
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = pq.scrollX + pq.pw * 0.55;
    },
    draw(o, st, pq) {
      const sx = Math.round(st.data.wx - pq.scrollX);
      const W = 26;
      if (sx + W < -4 || sx > pq.pw + 4) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx + (W >> 1)))) + 1;
      const f = st.fade;
      o.fillStyle = `rgba(26,42,74,${0.95 * f})`; // the pond
      o.fillRect(sx, gy - 1, W, 3);
      o.fillRect(sx + 2, gy - 2, W - 4, 1);
      // ripples stirred by the mids
      o.fillStyle = `rgba(90,130,190,${(0.3 + pq.mids.value * 0.4) * f})`;
      const rp = Math.floor(st.t * 3) % 3;
      o.fillRect(sx + 4 + rp * 6, gy - 1, 3, 1);
      o.fillRect(sx + 14 - rp * 3, gy, 4, 1);
      // the fin, cruising across
      const fx = Math.round(sx + 3 + st.p * (W - 8));
      o.fillStyle = `rgba(14,11,18,${f})`;
      o.fillRect(fx, gy - 3, 1, 2);
      o.fillRect(fx + 1, gy - 4, 1, 3);
      o.fillRect(fx + 2, gy - 3, 1, 2);
      if (pq.treble.value > 0.5) {
        o.fillStyle = `rgba(200,230,255,${0.8 * f})`; // fin glint
        o.fillRect(fx + 1, gy - 4, 1, 1);
      }
    },
  },

  // 4 ------------------------------------------------ prop: ghost trap moment
  {
    id: "ghost_trap",
    name: "Ghost Trap Moment",
    category: "prop",
    preferredBiomes: ["neon-forest"],
    rarity: "rare",
    trigger: "treble",
    duration: [6, 8],
    minCooldown: 220,
    batch3: true,
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = roadsideSpawn(pq);
      st.data.phase = "float";
      st.data.suckT = 0;
    },
    update(st, pq, a, dt) {
      if (st.data.phase === "float" && st.p > 0.35 && a.kickEdge) st.data.phase = "suck";
      if (st.data.phase === "suck") {
        st.data.suckT += dt;
        if (st.data.suckT > 0.7) st.data.phase = "closed";
      }
      if (st.p > 0.85 && st.data.phase !== "closed") st.data.phase = "suck"; // never leave it hanging
    },
    draw(o, st, pq) {
      const sx = roadsideX(pq, st.data.wx);
      if (sx < -10 || sx > pq.pw + 10) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) + 1;
      const f = st.fade;
      const d = st.data;
      // the trap box
      o.fillStyle = `rgba(24,22,30,${f})`;
      o.fillRect(sx - 3, gy - 2, 7, 2);
      const blink = d.phase === "closed" ? (Math.floor(st.t * 6) % 2 ? 0.9 : 0.2) : 0.4 + pq.kickPulse * 0.5;
      o.fillStyle = `rgba(255,120,90,${blink * f})`;
      o.fillRect(sx, gy - 3, 1, 1); // indicator light
      if (d.phase !== "closed") {
        // the ghost: pale blob, wavy hem, two dark eyes
        const suck = d.phase === "suck" ? clamp01(d.suckT / 0.7) : 0;
        const bob = Math.round(Math.sin(st.t * 2.5) * 2 * (1 - suck));
        const gyG = Math.round(gy - 18 + suck * 14 + bob);
        const squish = Math.round(suck * 2);
        o.fillStyle = `rgba(210,225,240,${0.85 * f * (1 - suck * 0.4)})`;
        o.fillRect(sx - 2 + squish, gyG, 5 - squish * 2, 5);
        o.fillRect(sx - 1, gyG + 5, 1, 1); // wavy hem
        o.fillRect(sx + 1, gyG + 5, 1, 1);
        o.fillStyle = `rgba(20,18,28,${f})`;
        o.fillRect(sx - 1, gyG + 1, 1, 1); // eyes
        o.fillRect(sx + 1, gyG + 1, 1, 1);
        if (d.phase === "suck") {
          o.fillStyle = `rgba(255,240,200,${0.7 * f})`; // suction sparkle columns
          for (const ox of [-2, 0, 2]) {
            o.fillRect(sx + ox, gyG + 6 + ((Math.floor(st.t * 20) + ox) % 3), 1, 2);
          }
        }
      }
    },
  },

  // 5 ------------------------------------------------ ground: alien hand glow
  {
    id: "alien_hand_glow",
    name: "Alien Hand Glow",
    category: "ground",
    rarity: "rare",
    trigger: "quiet",
    duration: [5.5, 8],
    minCooldown: 240,
    batch3: true,
    fadeSeconds: 1.2,
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = pq.scrollX + pq.pw * 0.62;
    },
    draw(o, st, pq, pal) {
      const sx = Math.round(st.data.wx - pq.scrollX);
      if (sx < -10 || sx > pq.pw + 10) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) + 1;
      const f = st.fade;
      // the bush it hides behind
      o.fillStyle = pq.col(pal.propDark, f);
      o.fillRect(sx - 4, gy - 4, 9, 4);
      o.fillRect(sx - 3, gy - 5, 7, 1);
      // the little hand peeks up, then withdraws
      const peek = Math.round(Math.sin(clamp01(st.p) * Math.PI) * 4);
      if (peek > 0) {
        const hy3 = gy - 4 - peek;
        o.fillStyle = `rgba(150,170,140,${f})`;
        o.fillRect(sx, hy3 + 1, 3, 3); // palm
        o.fillRect(sx, hy3, 1, 1); // three slender fingers
        o.fillRect(sx + 1, hy3 - 1, 1, 2);
        o.fillRect(sx + 2, hy3, 1, 1);
        const glow = 0.5 + pq.treble.value * 0.5;
        o.fillStyle = `rgba(255,200,140,${glow * f})`; // the glowing fingertip
        o.fillRect(sx + 1, hy3 - 1, 1, 1);
        o.fillStyle = `rgba(255,220,170,${glow * 0.3 * f})`;
        o.fillRect(sx, hy3 - 2, 3, 3);
        if (pq.treble.value > 0.5) trailSparkle(pq, sx + 1, hy3 - 3);
      }
    },
  },

  // 6 -------------------------------------- weather: pixel rain + umbrella
  {
    id: "pixel_rain_umbrella",
    name: "Pixel Rain + Umbrella",
    category: "weather",
    rarity: "uncommon",
    trigger: "random",
    duration: [9, 14],
    minCooldown: 200,
    batch3: true,
    fadeSeconds: 2,
    layer: "front",
    onStart(st) {
      st.data.drops = Array.from({ length: 36 }, () => ({
        x: Math.random(),
        y: Math.random(),
        v: 0.6 + Math.random() * 0.4,
      }));
      st.data.rips = [];
    },
    update(st, pq, a, dt) {
      for (const d of st.data.drops) {
        d.y += d.v * dt * (0.9 + pq.treble.value * 0.4);
        if (d.y > 1) {
          d.y -= 1;
          d.x = Math.random();
        }
      }
      if (a.kickEdge && st.data.rips.length < 4) {
        st.data.rips.push({ x: pq.pw * (0.1 + Math.random() * 0.8), t: 0 });
      }
      for (const r of st.data.rips) r.t += dt;
      st.data.rips = st.data.rips.filter((r) => r.t < 0.45);
    },
    draw(o, st, pq) {
      const f = st.fade;
      const n = Math.round(st.data.drops.length * (0.5 + pq.loud.value * 0.5));
      for (let i = 0; i < n; i++) {
        const d = st.data.drops[i];
        o.fillStyle = `rgba(150,175,215,${(0.35 + (i % 3) * 0.12) * f})`;
        o.fillRect(Math.round(d.x * pq.pw), Math.round(d.y * pq.ph), 1, 3);
      }
      // bass puddle ripples along the ground
      for (const r of st.data.rips) {
        const w2 = Math.round(2 + (r.t / 0.45) * 7);
        const rx = Math.round(r.x);
        const gy2 = pq.groundY(Math.max(0, Math.min(pq.pw - 1, rx)));
        o.fillStyle = `rgba(170,195,235,${(1 - r.t / 0.45) * 0.5 * f})`;
        o.fillRect(rx - (w2 >> 1), gy2, w2, 1);
      }
      // the hero's umbrella, held over his walk
      const hxc = Math.round(pq.pw * pq.heroAnchor);
      const hy0 = pq.groundY(hxc) - 24 + Math.round(pq.heroJumpY || 0);
      const uy = hy0 - 5;
      o.fillStyle = `rgba(178,58,66,${f})`; // red canopy
      o.fillRect(hxc - 5, uy, 11, 1);
      o.fillRect(hxc - 4, uy - 1, 9, 1);
      o.fillRect(hxc - 2, uy - 2, 5, 1);
      o.fillStyle = `rgba(235,215,195,${f})`;
      o.fillRect(hxc, uy - 3, 1, 1); // tip
      o.fillStyle = `rgba(96,74,52,${f})`;
      o.fillRect(hxc, uy + 1, 1, 7); // pole down to his hand
    },
  },

  // 7 ------------------------------------ background: giant friendly creature
  {
    id: "forest_giant",
    name: "Giant Friendly Forest Creature",
    category: "background",
    preferredBiomes: ["meadow-road", "neon-forest"],
    rarity: "legendary",
    trigger: "quiet",
    duration: [12, 18],
    minCooldown: 360,
    isMajor: true,
    batch3: true,
    fadeSeconds: 2.5,
    layer: "background",
    draw(o, st, pq, pal) {
      const f = st.fade;
      const base = pq.groundBase();
      const x = Math.round(pq.pw * 0.7);
      const H = Math.round(26 * pq.S);
      const sway = Math.round(Math.sin(st.t * 0.4) * 1);
      o.fillStyle = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.45), f);
      // a gentle rounded hulk, shoulders and small round ears
      o.fillRect(x - 10 + sway, base - H + 8, 22, H - 8); // body
      o.fillRect(x - 7 + sway, base - H + 3, 16, 6); // head
      o.fillRect(x - 8 + sway, base - H + 1, 4, 3); // ears
      o.fillRect(x + 6 + sway, base - H + 1, 4, 3);
      // one slow, subtle paw raise midway through
      const paw = clamp01((st.p - 0.4) * 6) * clamp01((0.65 - st.p) * 6);
      if (paw > 0) o.fillRect(x - 15 + sway, base - H + 12 - Math.round(paw * 4), 5, 3);
      // soft glowing eyes that blink slowly and breathe with the music
      const blink = Math.sin(st.t * 0.7) > -0.92;
      if (blink) {
        const glow = (0.55 + pq.loud.value * 0.35) * f;
        o.fillStyle = `rgba(255,214,140,${glow})`;
        o.fillRect(x - 3 + sway, base - H + 5, 2, 2);
        o.fillRect(x + 3 + sway, base - H + 5, 2, 2);
      }
    },
  },

  // 8 ------------------------------------------ background: glam-rock guitarist
  {
    id: "glam_guitarist",
    name: "Glam-Rock Guitarist",
    category: "background",
    preferredBiomes: ["arcade-ruins"],
    rarity: "rare",
    trigger: "beat",
    energyRequired: 0.45,
    duration: [6, 10],
    minCooldown: 220,
    batch3: true,
    layer: "background",
    update(st, pq, a) {
      if (a.kickEdge) st.data.strum = 0.2;
      st.data.strum = Math.max(0, (st.data.strum || 0) - 0.016);
      if (pq.treble.value > 0.55) {
        const x = Math.round(pq.pw * 0.32);
        trailSparkle(pq, x + (Math.random() - 0.5) * 10, pq.groundBase() - Math.round(16 * pq.S));
      }
    },
    draw(o, st, pq, pal) {
      const f = st.fade;
      const base = pq.groundBase();
      const x = Math.round(pq.pw * 0.32);
      // a little stage rock
      o.fillStyle = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.3), f);
      o.fillRect(x - 6, base - 4, 13, 4);
      const strum = (st.data.strum || 0) > 0;
      o.fillStyle = `rgba(14,11,18,${f})`;
      o.fillRect(x, base - 12, 3, 6); // body, legs planted wide
      o.fillRect(x - 1, base - 6, 2, 2);
      o.fillRect(x + 2, base - 6, 2, 2);
      o.fillRect(x, base - 15, 3, 3); // head with big hair
      o.fillRect(x - 1, base - 16, 5, 2);
      // the guitar: neck angled up on the strum
      o.fillRect(x - 3, base - 10, 4, 2);
      if (strum) {
        o.fillRect(x - 6, base - 13, 3, 1); // neck up!
        o.fillRect(x + 3, base - 13, 2, 1); // arm thrown high
      } else {
        o.fillRect(x - 7, base - 11, 4, 1);
      }
    },
  },

  // 9 ------------------------------------------ prop: phone booth lightning
  {
    id: "phone_booth_lightning",
    name: "Phone Booth Lightning",
    category: "prop",
    rarity: "rare",
    trigger: "bass",
    duration: [5.5, 8],
    minCooldown: 240,
    batch3: true,
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = roadsideSpawn(pq);
      st.data.bolt = 0;
    },
    update(st, pq, a, dt) {
      st.data.bolt = Math.max(0, st.data.bolt - dt);
      if (a.kickEdge && st.t > 0.6) {
        st.data.bolt = 0.15;
        st.data.bseed = (Math.random() * 1e9) | 0;
      }
    },
    draw(o, st, pq) {
      const sx = roadsideX(pq, st.data.wx);
      if (sx < -12 || sx > pq.pw + 12) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) + 1;
      const f = st.fade;
      const H = 15;
      // the booth: tall box, warm glowing panes
      o.fillStyle = `rgba(40,36,52,${f})`;
      o.fillRect(sx, gy - H, 8, H);
      o.fillRect(sx + 1, gy - H - 1, 6, 1); // cap
      const glowA = (0.4 + pq.kickPulse * 0.4 + (st.data.bolt > 0 ? 0.3 : 0)) * f;
      o.fillStyle = `rgba(255,214,130,${glowA})`;
      for (let ry = 0; ry < 3; ry++)
        for (let rx2 = 0; rx2 < 2; rx2++) o.fillRect(sx + 1 + rx2 * 3, gy - H + 2 + ry * 4, 3, 3);
      if (st.data.bolt > 0) {
        // lightning cracks down behind it
        o.fillStyle = `rgba(210,220,255,${0.12 * f})`;
        o.fillRect(0, 0, pq.pw, gy - 4);
        o.fillStyle = "rgba(235,242,255,0.95)";
        let bx = sx + 4;
        let by = gy - H - 3;
        let s = st.data.bseed;
        for (let k = 0; k < 7; k++) {
          s = (s * 1664525 + 1013904223) >>> 0;
          bx += (s % 5) - 2;
          by -= 3;
          o.fillRect(bx, by, 1, 3);
        }
      }
    },
  },

  // 10 ------------------------------------------ background: dinosaur horizon
  {
    id: "dinosaur_horizon",
    name: "Dinosaur Horizon",
    category: "background",
    rarity: "rare",
    trigger: "loudness",
    energyRequired: 0.4,
    duration: [8, 12],
    minCooldown: 260,
    isMajor: true,
    batch3: true,
    layer: "background",
    update(st, pq, a) {
      if (a.kickEdge) pq.bump = Math.max(pq.bump, 0.5); // distant footfalls
    },
    draw(o, st, pq, pal) {
      const f = st.fade;
      const base = pq.groundBase() - Math.round(4 * pq.S);
      const x = Math.round(pq.pw + 30 - st.p * (pq.pw + 90));
      const step = Math.floor(st.t * 2) % 2;
      o.fillStyle = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.4), f);
      o.fillRect(x, base - 10, 20, 6); // long body
      // the neck, reaching up and forward
      o.fillRect(x - 3, base - 14, 4, 5);
      o.fillRect(x - 5, base - 17, 4, 4);
      o.fillRect(x - 7, base - 18, 4, 2); // head
      o.fillRect(x + 19, base - 8, 6, 2); // tail
      o.fillRect(x + 24, base - 7, 4, 1); // tail tip
      // slow legs, alternating
      o.fillRect(x + 2 + (step ? 1 : 0), base - 4, 3, 4);
      o.fillRect(x + 13 - (step ? 1 : 0), base - 4, 3, 4);
    },
  },

  // 11 -------------------------------------------------- sky: meteor cassette
  {
    id: "meteor_cassette",
    name: "Meteor Cassette",
    category: "sky",
    preferredBiomes: ["arcade-ruins"],
    rarity: "rare",
    trigger: "treble",
    energyRequired: 0.35,
    duration: [4.5, 6.5],
    minCooldown: 240,
    batch3: true,
    layer: "sky",
    update(st, pq) {
      if (!st.data.popped && st.p > 0.95) {
        st.data.popped = true;
        for (let k = 0; k < 4 && pq.particles.length < 90; k++) {
          pq.particles.push({
            kind: "sparkle",
            x: st.data.lx || pq.pw * 0.45,
            y: st.data.ly || 30,
            vx: (Math.random() - 0.5) * 16,
            vy: (Math.random() - 0.5) * 16,
            age: 0,
            life: 0.5,
          });
        }
      }
    },
    draw(o, st, pq) {
      const f = st.fade;
      const metP = clamp01(st.p / 0.45);
      const x = Math.round(pq.pw * 0.9 - metP * pq.pw * 0.45);
      const y = Math.round(-4 + metP * 34);
      st.data.lx = x;
      st.data.ly = y;
      if (st.p < 0.45) {
        // the meteor: white-hot head, tapered warm trail
        const trailA = 0.35 + pq.loud.value * 0.4;
        for (let k = 1; k <= 6; k++) {
          o.fillStyle = `rgba(255,${200 - k * 18},${120 - k * 12},${(trailA * (1 - k / 7)) * f})`;
          o.fillRect(x + k * 2, y - k, 2, 2);
        }
        o.fillStyle = `rgba(255,250,235,${f})`;
        o.fillRect(x, y, 2, 2);
        if (pq.treble.value > 0.45) trailSparkle(pq, x + 4 + Math.random() * 8, y - 2 - Math.random() * 4);
      } else {
        // ...it was a cassette all along, tumbling gently
        const frame = Math.floor(st.t * 6) % 2;
        const drift = Math.round((st.p - 0.45) * 12);
        const cy2 = y + drift;
        o.fillStyle = `rgba(255,220,150,${0.2 * f})`; // soft glow
        o.fillRect(x - 2, cy2 - 2, 11, 9);
        if (frame) {
          o.fillStyle = `rgba(30,28,36,${f})`;
          o.fillRect(x + 1, cy2 - 1, 5, 7);
          o.fillStyle = `rgba(200,190,170,${f})`;
          o.fillRect(x + 2, cy2 + 1, 3, 3);
        } else {
          o.fillStyle = `rgba(30,28,36,${f})`;
          o.fillRect(x, cy2, 7, 5);
          o.fillStyle = `rgba(200,190,170,${f})`;
          o.fillRect(x + 1, cy2 + 1, 5, 2);
          o.fillStyle = `rgba(60,56,68,${f})`;
          o.fillRect(x + 1, cy2 + 3, 1, 1);
          o.fillRect(x + 5, cy2 + 3, 1, 1);
        }
      }
    },
  },

  // 12 ------------------------------------------------ prop: magic microphone
  {
    id: "magic_microphone",
    name: "Magic Microphone",
    category: "prop",
    preferredBiomes: ["neon-forest"],
    rarity: "legendary",
    trigger: "loudness",
    energyRequired: 0.6,
    duration: [9, 14],
    minCooldown: EVENT_TUNING.musicPowerUpCooldownSeconds,
    isMajor: true,
    batch3: true,
    fadeSeconds: 1.5,
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = roadsideSpawn(pq);
    },
    update(st, pq) {
      // the music power-up: terrain sings louder while the mic stands
      pq.groundBoost = st.fade;
      if (pq.treble.value > 0.5) {
        const sx = roadsideX(pq, st.data.wx);
        trailSparkle(pq, sx + (Math.random() - 0.5) * 8, pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) - 12);
      }
    },
    onEnd(st, pq) {
      pq.groundBoost = 0;
    },
    draw(o, st, pq) {
      const sx = roadsideX(pq, st.data.wx);
      if (sx < -10 || sx > pq.pw + 10) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) + 1;
      const f = st.fade;
      const rise = Math.round(Math.min(1, st.t / 1.2) * 6);
      // pedestal
      o.fillStyle = `rgba(88,88,102,${f})`;
      o.fillRect(sx - 3, gy - 2, 8, 2);
      o.fillRect(sx - 2, gy - 3, 6, 1);
      // stand + mic head
      const my2 = gy - 4 - rise;
      o.fillStyle = `rgba(60,58,70,${f})`;
      o.fillRect(sx + 1, my2, 1, 4 + rise);
      const glow = 0.25 + pq.bass.value * 0.35 + pq.kickPulse * 0.3;
      o.fillStyle = `rgba(255,214,140,${glow * f})`; // halo ring
      pq.pixelDisc(o, sx + 1, my2 - 2, 4);
      o.fillStyle = `rgba(225,230,245,${f})`;
      o.fillRect(sx, my2 - 3, 3, 3); // the mic
      o.fillStyle = `rgba(120,120,140,${f})`;
      o.fillRect(sx, my2 - 2, 3, 1); // grill line
    },
  },

  // ================================================= FINAL BATCH ===========

  // 1 --------------------------------------- hero: red jacket spooky dance
  {
    id: "red_jacket_dance",
    name: "Red Jacket Spooky Dance",
    category: "hero",
    rarity: "rare",
    trigger: "beat",
    energyRequired: 0.4,
    duration: [5, 7.5],
    minCooldown: 200,
    finalBatch: true,
    layer: null, // jacket + zombie arms rendered by drawHero
    when: (pq) => !pq.egg && pq.heroJumpY === 0,
    onStart(st, pq) {
      pq.egg = { type: "spookydance", t: 0, dur: st.dur, danceFrame: 0 };
    },
    update(st, pq, a) {
      if (a.kickEdge && pq.egg && pq.egg.type === "spookydance") {
        pq.egg.danceFrame = 1 - (pq.egg.danceFrame || 0); // step on the beat
        pq.spawnSparkles(); // floor sparkle
      }
    },
  },

  // 2 ------------------------------------ background: masked shadow behind tree
  {
    id: "masked_shadow",
    name: "Masked Shadow Behind Tree",
    category: "background",
    rarity: "rare",
    trigger: "quiet",
    duration: [4.5, 7],
    minCooldown: 220,
    finalBatch: true,
    fadeSeconds: 1,
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = roadsideSpawn(pq);
    },
    draw(o, st, pq, pal) {
      const sx = roadsideX(pq, st.data.wx);
      if (sx < -12 || sx > pq.pw + 12) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) + 1;
      const f = st.fade;
      // its tree
      o.fillStyle = pq.col(pal.propDark, f);
      const hgt = 15;
      for (let i = 0; i < hgt - 3; i++) {
        const half = Math.max(1, Math.round(((hgt - 3 - i) / (hgt - 3)) * 4));
        o.fillRect(sx - half, gy - 3 - i, half * 2 + 1, 1);
      }
      // the figure leans out, then withdraws — easy to miss
      const peek = Math.round(Math.sin(clamp01(st.p) * Math.PI) * 4);
      if (peek > 0) {
        o.fillStyle = `rgba(12,9,18,${0.95 * f})`;
        o.fillRect(sx + 2 + peek, gy - 10, 3, 8); // slim body
        o.fillRect(sx + 2 + peek, gy - 12, 3, 2); // head
        o.fillStyle = `rgba(220,224,230,${0.8 * f})`;
        o.fillRect(sx + 3 + peek, gy - 12, 2, 2); // the pale mask
        if (pq.treble.value > 0.5) {
          o.fillStyle = "rgba(20,24,34,0.95)"; // eye glints through
          o.fillRect(sx + 3 + peek, gy - 12, 1, 1);
        }
      }
    },
  },

  // 3 ------------------------------------ background: half-buried adventure statue
  {
    id: "adventure_statue",
    name: "Half-Buried Adventure Statue",
    category: "background",
    rarity: "uncommon",
    trigger: "random",
    duration: [10, 16],
    minCooldown: 200,
    finalBatch: true,
    allowedBiomes: ["castle-approach", "meadow-road"], // remapped for Biome System v1
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = roadsideSpawn(pq);
    },
    update(st, pq, a) {
      if (a.kickEdge && pq.particles.length < 90) {
        const sx = roadsideX(pq, st.data.wx);
        pq.particles.push({
          kind: "dust",
          x: sx + (Math.random() - 0.5) * 8,
          y: pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) - 6,
          vx: (Math.random() - 0.5) * 6,
          vy: -3,
          age: 0,
          life: 0.5,
        });
      }
    },
    draw(o, st, pq) {
      const sx = roadsideX(pq, st.data.wx);
      if (sx < -14 || sx > pq.pw + 14) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) + 1;
      const f = st.fade;
      // an old stone head, sunk to the chin, leaning
      o.fillStyle = `rgba(126,116,98,${f})`;
      o.fillRect(sx - 4, gy - 6, 9, 6); // face block
      o.fillRect(sx - 3, gy - 7, 8, 1);
      o.fillStyle = `rgba(96,88,74,${f})`;
      o.fillRect(sx - 5, gy - 9, 12, 2); // stone hat brim
      o.fillRect(sx - 2, gy - 11, 7, 2); // crown
      o.fillRect(sx - 2, gy - 4, 2, 1); // weathered eye hollows
      o.fillRect(sx + 2, gy - 4, 2, 1);
      o.fillRect(sx - 4, gy - 1, 9, 1); // buried edge shading
      if (pq.treble.value > 0.55) {
        o.fillStyle = `rgba(255,230,170,${0.7 * f})`; // relic glint
        o.fillRect(sx + 4, gy - 9, 1, 1);
      }
    },
  },

  // 4 ------------------------------------------- hero: sunglasses leather pose
  {
    id: "sunglasses_pose",
    name: "Sunglasses Leather Pose",
    category: "hero",
    rarity: "rare",
    trigger: "beat",
    energyRequired: 0.45,
    duration: [3.5, 5],
    minCooldown: 190,
    finalBatch: true,
    layer: null, // glasses + slow strut rendered by drawHero
    when: (pq) => !pq.egg && pq.heroJumpY === 0,
    onStart(st, pq) {
      pq.egg = { type: "coolpose", t: 0, dur: st.dur, glint: 0 };
    },
    update(st, pq, a, dt) {
      if (pq.egg && pq.egg.type === "coolpose") {
        if (a.kickEdge) pq.egg.glint = 0.18; // lens shine on the beat
        pq.egg.glint = Math.max(0, (pq.egg.glint || 0) - dt);
      }
    },
  },

  // 5 ------------------------------------------- ground: submarine periscope
  {
    id: "submarine_periscope",
    name: "Submarine Periscope",
    category: "ground",
    rarity: "uncommon",
    trigger: "quiet",
    duration: [5.5, 8],
    minCooldown: 150,
    finalBatch: true,
    fadeSeconds: 1,
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = pq.scrollX + pq.pw * 0.5;
    },
    draw(o, st, pq) {
      const sx = Math.round(st.data.wx - pq.scrollX);
      const W = 22;
      if (sx + W < -4 || sx > pq.pw + 4) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx + (W >> 1)))) + 1;
      const f = st.fade;
      o.fillStyle = `rgba(26,42,74,${0.95 * f})`; // the water patch
      o.fillRect(sx, gy - 1, W, 3);
      o.fillRect(sx + 2, gy - 2, W - 4, 1);
      o.fillStyle = `rgba(90,130,190,${(0.3 + pq.mids.value * 0.4) * f})`; // ripples
      o.fillRect(sx + 3 + (Math.floor(st.t * 3) % 3) * 5, gy - 1, 3, 1);
      // the periscope: up in the middle, sweeping left/right
      const up = Math.round(Math.min(1, st.t / 1, (st.dur - st.t) / 1) * 5);
      if (up > 0) {
        const px = sx + (W >> 1);
        const facing = Math.floor(st.t * 1.5) % 2 === 0 ? -1 : 1;
        o.fillStyle = `rgba(60,66,80,${f})`;
        o.fillRect(px, gy - 1 - up, 2, up + 1); // tube
        o.fillRect(px + (facing < 0 ? -2 : 1), gy - 2 - up, 3, 2); // head
        if (pq.treble.value > 0.5) {
          o.fillStyle = "rgba(200,240,255,0.95)"; // lens glint
          o.fillRect(px + (facing < 0 ? -2 : 3), gy - 2 - up, 1, 1);
        }
      }
    },
  },

  // 6 --------------------------------------------------- sky: pirate ship cloud
  {
    id: "pirate_ship_cloud",
    name: "Pirate Ship Cloud",
    category: "sky",
    rarity: "rare",
    trigger: "random",
    duration: [9, 14],
    minCooldown: 240,
    finalBatch: true,
    fadeSeconds: 1.5,
    layer: "sky",
    draw(o, st, pq) {
      const f = st.fade;
      const x = Math.round(pq.pw + 16 - st.p * (pq.pw + 46));
      const y = Math.round(13 + (st.seed % 8) + Math.sin(st.t * 0.8) * 1 + pq.bass.value * 1.5);
      o.fillStyle = `rgba(12,9,18,${0.9 * f})`;
      // hull: a shallow crescent
      o.fillRect(x, y + 3, 12, 2);
      o.fillRect(x + 1, y + 5, 10, 1);
      o.fillRect(x - 1, y + 2, 2, 1); // stern rise
      o.fillRect(x + 11, y + 2, 2, 1); // bow rise
      o.fillRect(x + 3, y - 3, 1, 6); // masts
      o.fillRect(x + 8, y - 4, 1, 7);
      // moonlit sails
      o.fillStyle = `rgba(190,200,220,${0.55 * f})`;
      o.fillRect(x + 1, y - 2, 3, 3);
      o.fillRect(x + 6, y - 3, 3, 4);
      if (pq.treble.value > 0.5) trailSparkle(pq, x + 4 + Math.random() * 6, y - 4);
      // a wisp of cloud it sails on
      o.fillStyle = `rgba(120,130,160,${0.25 * f})`;
      o.fillRect(x - 3, y + 6, 18, 1);
    },
  },

  // 7 ------------------------------------------ background: wizard train bridge
  {
    id: "wizard_train",
    name: "Wizard Train Bridge",
    category: "background",
    preferredBiomes: ["castle-approach"],
    rarity: "legendary",
    trigger: "quiet",
    duration: [12, 18],
    minCooldown: 360,
    isMajor: true,
    finalBatch: true,
    fadeSeconds: 2,
    layer: "background",
    onStart(st) {
      st.data.smoke = [];
    },
    update(st, pq, a, dt) {
      if (a.kickEdge && st.data.ex != null && st.data.smoke.length < 8) {
        st.data.smoke.push({ x: st.data.ex, y: st.data.ey - 3, t: 0 });
      }
      for (const s of st.data.smoke) {
        s.t += dt;
        s.y -= 4 * dt;
        s.x += 2 * dt;
      }
      st.data.smoke = st.data.smoke.filter((s) => s.t < 1.4);
    },
    draw(o, st, pq, pal) {
      const f = st.fade;
      const base = pq.groundBase();
      const by = base - Math.round(20 * pq.S); // the bridge deck
      const bx0 = Math.round(pq.pw * 0.3);
      const bw = Math.round(pq.pw * 0.34);
      const dark = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.35), f);
      o.fillStyle = dark;
      o.fillRect(bx0, by, bw, 2); // deck
      for (let px = bx0 + 6; px < bx0 + bw - 4; px += 16) o.fillRect(px, by + 2, 3, 9); // piers
      // the little train, crossing slowly
      const tx = Math.round(bx0 - 24 + st.p * (bw + 40));
      st.data.ex = tx + 20;
      st.data.ey = by - 4;
      for (let c = 0; c < 4; c++) {
        const cx2 = tx + c * 7;
        if (cx2 + 6 < bx0 - 2 || cx2 > bx0 + bw + 2) continue;
        o.fillStyle = dark;
        o.fillRect(cx2, by - 4, 6, 4);
        if (c === 3) o.fillRect(cx2 + 4, by - 6, 2, 2); // engine stack
        const winA = (0.5 + pq.loud.value * 0.3 + (pq.treble.value > 0.55 ? 0.2 : 0)) * f;
        o.fillStyle = `rgba(255,214,130,${winA})`; // cozy windows
        o.fillRect(cx2 + 1, by - 3, 1, 1);
        o.fillRect(cx2 + 4 - (c === 3 ? 1 : 0), by - 3, 1, 1);
      }
      // smoke puffs on the beat
      for (const s of st.data.smoke) {
        o.fillStyle = `rgba(200,200,214,${(1 - s.t / 1.4) * 0.4 * f})`;
        o.fillRect(Math.round(s.x), Math.round(s.y), 2, 2);
      }
    },
  },

  // 8 ---------------------------------------------- sky: giant moon face wink
  {
    id: "moon_face_wink",
    name: "Giant Moon Face Wink",
    category: "sky",
    preferredBiomes: ["moonlit-town"],
    rarity: "rare",
    trigger: "treble",
    duration: [4.5, 7],
    minCooldown: 240,
    finalBatch: true,
    fadeSeconds: 1,
    layer: "sky",
    update(st, pq, a) {
      if (!st.data.winked && st.p > 0.3 && (a.kickEdge || a.treble > 0.6)) {
        st.data.winked = true;
        st.data.winkT = 0.55;
        const { mx, my } = moonPos(pq, pq.palRef);
        for (let k = 0; k < 3 && pq.particles.length < 90; k++) {
          pq.particles.push({
            kind: "sparkle",
            x: mx + (Math.random() - 0.5) * 20,
            y: my + (Math.random() - 0.5) * 16,
            vx: 0,
            vy: -3,
            age: 0,
            life: 0.5,
          });
        }
      }
      if (st.data.winkT) st.data.winkT = Math.max(0, st.data.winkT - 0.016);
    },
    draw(o, st, pq, pal) {
      const { mx, my } = moonPos(pq, pal);
      const f = st.fade;
      const ink = `rgba(52,62,100,${0.6 * f})`;
      o.fillStyle = ink;
      // left eye
      o.fillRect(mx - 4, my - 2, 2, 2);
      // right eye — a soft line while winking
      if ((st.data.winkT || 0) > 0) o.fillRect(mx + 2, my - 1, 3, 1);
      else o.fillRect(mx + 2, my - 2, 2, 2);
      // a small, kind smile
      o.fillRect(mx - 2, my + 3, 5, 1);
      o.fillRect(mx - 3, my + 2, 1, 1);
      o.fillRect(mx + 3, my + 2, 1, 1);
    },
  },

  // 9 --------------------------------------- background: tiny drummer on cliff
  {
    id: "tiny_drummer",
    name: "Tiny Drummer on the Cliff",
    category: "background",
    preferredBiomes: ["arcade-ruins"],
    rarity: "uncommon",
    trigger: "beat",
    energyRequired: 0.45,
    duration: [6, 10],
    minCooldown: 160,
    finalBatch: true,
    layer: "background",
    update(st, pq, a) {
      if (a.kickEdge) st.data.hit = 0.18;
      st.data.hit = Math.max(0, (st.data.hit || 0) - 0.016);
    },
    draw(o, st, pq, pal) {
      const f = st.fade;
      const base = pq.groundBase();
      const x = Math.round(pq.pw * 0.86);
      // the cliff ledge
      o.fillStyle = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.3), f);
      o.fillRect(x - 5, base - 10, 14, 10);
      o.fillRect(x - 3, base - 12, 10, 2);
      const hit = (st.data.hit || 0) > 0;
      // the drummer, arms up/down with the hits
      o.fillStyle = `rgba(14,11,18,${f})`;
      o.fillRect(x, base - 18, 3, 4); // torso
      o.fillRect(x, base - 20, 3, 2); // head
      o.fillRect(x - 2, base - (hit ? 19 : 16), 2, 1); // arms
      o.fillRect(x + 3, base - (hit ? 16 : 19), 2, 1);
      // drums, bouncing a hair on the bass
      const db = pq.bass.value > 0.5 ? 1 : 0;
      o.fillStyle = `rgba(120,60,66,${f})`;
      o.fillRect(x - 3, base - 14 - db, 3, 2 + db);
      o.fillRect(x + 3, base - 14 - db, 3, 2 + db);
      // cymbal flash on the kick
      o.fillStyle = hit ? `rgba(255,230,150,${0.95 * f})` : `rgba(150,140,110,${0.6 * f})`;
      o.fillRect(x + 5, base - 17, 3, 1);
      if (hit && pq.treble.value > 0.4) trailSparkle(pq, x + 6, base - 18);
    },
  },

  // 10 ---------------------------------------------- background: neon diner sign
  {
    id: "neon_diner",
    name: "Neon Diner Sign",
    category: "background",
    rarity: "uncommon",
    trigger: "loudness",
    energyRequired: 0.35,
    duration: [10, 16],
    minCooldown: 180,
    finalBatch: true,
    layer: "background",
    onStart(st, pq) {
      st.data.wx = pq.scrollX * 0.3 + pq.pw * 0.9; // drifts by on the mid layer
    },
    draw(o, st, pq, pal) {
      const sx = Math.round(st.data.wx - pq.scrollX * 0.3);
      if (sx < -24 || sx > pq.pw + 24) return;
      const base = pq.groundBase();
      const f = st.fade;
      // low flat-roof building
      o.fillStyle = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.35), f);
      o.fillRect(sx, base - 9, 20, 9);
      o.fillRect(sx - 1, base - 10, 22, 1);
      // warm window strip
      o.fillStyle = `rgba(255,200,130,${0.35 * f})`;
      o.fillRect(sx + 2, base - 6, 16, 2);
      // the neon sign: abstract glowing blocks, never letters
      const pulse = 0.5 + pq.mids.value * 0.3 + pq.loud.value * 0.2;
      const flick = pq.treble.value > 0.55 && Math.floor(st.t * 9) % 5 === 0;
      const blocks = [
        [0, 0, 3, 1, "255,80,140"],
        [4, 0, 2, 1, "120,230,255"],
        [7, 0, 3, 1, "255,80,140"],
        [11, 0, 2, 1, "120,230,255"],
      ];
      for (let bIx = 0; bIx < blocks.length; bIx++) {
        const [ox, oy, w2, h2, col2] = blocks[bIx];
        const off = flick && bIx === 1; // one tube stutters
        o.fillStyle = `rgba(${col2},${(off ? 0.15 : pulse) * f})`;
        o.fillRect(sx + 3 + ox, base - 14 + oy, w2, h2 + 1);
      }
      // sign post glow
      o.fillStyle = `rgba(255,120,180,${0.1 * pulse * f})`;
      o.fillRect(sx + 1, base - 16, 18, 5);
    },
  },

  // 11 ------------------------------------------------- sky: spy rope drop
  {
    id: "spy_rope_drop",
    name: "Spy Rope Drop",
    category: "sky",
    rarity: "rare",
    trigger: "beat",
    energyRequired: 0.3,
    duration: [4.5, 7],
    minCooldown: 220,
    finalBatch: true,
    layer: "sky",
    draw(o, st, pq) {
      const f = st.fade;
      const x = Math.round(pq.pw * (0.3 + ((st.seed % 100) / 100) * 0.3));
      // descend, hang, zip back up
      const p = st.p;
      const hang = Math.round(pq.ph * 0.34);
      let y;
      if (p < 0.35) y = Math.round((p / 0.35) * hang);
      else if (p < 0.7) y = hang + Math.round(Math.sin(st.t * 2) * 1);
      else y = Math.round(hang * (1 - (p - 0.7) / 0.3));
      o.fillStyle = `rgba(200,200,210,${0.4 * f})`;
      o.fillRect(x + 2, 0, 1, y); // the rope
      o.fillStyle = `rgba(12,9,18,${0.95 * f})`;
      o.fillRect(x + 1, y, 3, 2); // head-down silhouette
      o.fillRect(x, y + 2, 5, 3); // body
      o.fillRect(x + 1, y + 5, 1, 2); // dangling arms
      o.fillRect(x + 3, y + 5, 1, 2);
      if (pq.treble.value > 0.5 || pq.kickPulse > 0.5) {
        o.fillStyle = "rgba(220,240,255,0.9)"; // a glint off the visor
        o.fillRect(x + 2, y + 3, 1, 1);
      }
    },
  },

  // 12 ------------------------------------- background: castle window ballroom
  {
    id: "castle_ballroom",
    name: "Castle Window Ballroom",
    category: "background",
    preferredBiomes: ["castle-approach"],
    rarity: "rare",
    trigger: "quiet",
    duration: [12, 18],
    minCooldown: 260,
    finalBatch: true,
    fadeSeconds: 2,
    layer: "background",
    onStart(st, pq) {
      st.data.wx = pq.scrollX * 0.3 + pq.pw * 0.85;
    },
    update(st, pq, a) {
      if (a.kickEdge) st.data.pose = 1 - (st.data.pose || 0);
    },
    draw(o, st, pq, pal) {
      const sx = Math.round(st.data.wx - pq.scrollX * 0.3);
      if (sx < -20 || sx > pq.pw + 20) return;
      const base = pq.groundBase();
      const f = st.fade;
      // the manor: dark mass with one tall lit window
      o.fillStyle = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.4), f);
      o.fillRect(sx, base - 16, 16, 16);
      o.fillRect(sx + 2, base - 19, 4, 3); // tower
      o.fillRect(sx + 1, base - 20, 6, 1);
      o.fillStyle = `rgba(255,214,140,${(0.55 + pq.mids.value * 0.25) * f})`;
      o.fillRect(sx + 8, base - 13, 6, 7); // the ballroom window
      // two tiny dancers, swaying together
      const sway = Math.round(Math.sin(st.t * (1 + pq.mids.value * 1.5)) * 1);
      const pose = st.data.pose || 0;
      o.fillStyle = `rgba(30,22,34,${f})`;
      o.fillRect(sx + 9 + sway, base - 10 - pose, 2, 4 + pose); // one taller
      o.fillRect(sx + 12 + sway, base - 9, 2, 3); // one smaller
      o.fillRect(sx + 10 + sway, base - 11 - pose, 1, 1); // heads
      o.fillRect(sx + 12 + sway, base - 10, 1, 1);
    },
  },

  // 13 ------------------------------------------------ prop: blue time booth
  {
    id: "blue_time_booth",
    name: "Blue Time Booth",
    category: "prop",
    preferredBiomes: ["neon-forest"],
    rarity: "legendary",
    trigger: "loudness",
    energyRequired: 0.5,
    duration: [6.5, 10],
    minCooldown: 320,
    isMajor: true,
    finalBatch: true,
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = roadsideSpawn(pq);
    },
    update(st, pq) {
      if (pq.treble.value > 0.5 && pq.particles.length < 90) {
        const sx = roadsideX(pq, st.data.wx);
        if (Math.random() < 0.2)
          pq.particles.push({
            kind: "sparkle",
            x: sx + (Math.random() - 0.5) * 12,
            y: pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) - 4 - Math.random() * 12,
            vx: 0,
            vy: -2,
            age: 0,
            life: 0.4,
          });
      }
    },
    draw(o, st, pq) {
      const sx = roadsideX(pq, st.data.wx);
      if (sx < -12 || sx > pq.pw + 12) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) + 1;
      // it phases in and out of existence at both ends
      const solid = Math.min(1, st.t / 1.6, (st.dur - st.t) / 1.6);
      const phase = solid < 1 ? 0.45 + 0.55 * Math.abs(Math.sin(st.t * 14)) : 1;
      const a = st.fade * phase;
      const H = 16;
      o.fillStyle = `rgba(38,64,132,${a})`; // deep blue box
      o.fillRect(sx, gy - H, 9, H);
      o.fillRect(sx + 1, gy - H - 1, 7, 1); // stepped roof
      o.fillRect(sx + 3, gy - H - 2, 3, 1);
      o.fillStyle = `rgba(20,36,84,${a})`; // panel lines
      o.fillRect(sx + 4, gy - H + 2, 1, H - 3);
      o.fillRect(sx + 1, gy - Math.round(H / 2), 7, 1);
      o.fillStyle = `rgba(255,240,200,${(0.6 + pq.kickPulse * 0.4) * a})`; // the lamp
      o.fillRect(sx + 4, gy - H - 3, 1, 1);
      o.fillStyle = `rgba(180,210,255,${(0.4 + pq.kickPulse * 0.3) * a})`; // lit panes
      o.fillRect(sx + 1, gy - H + 2, 3, 2);
      o.fillRect(sx + 5, gy - H + 2, 3, 2);
      // soft bass glow around it
      o.fillStyle = `rgba(120,170,255,${(0.06 + pq.bass.value * 0.08) * a})`;
      o.fillRect(sx - 3, gy - H - 4, 15, H + 5);
    },
  },

  // ==================================================== BATCH 4 ============
  // Chosen after an inventory audit to avoid duplicating the catalog above:
  // a new instrument performer (guitar/drums were taken), a hero spark
  // effect, a genuinely different sky treatment (lightning was taken
  // twice), a literal door (portal/booth were taken), a falling-collectible
  // weather moment, a solo darting insect (fireflies are ambient, not a
  // cameo), a walking procession (distinct from the solo boombox_pose), a
  // cape flourish (jacket recolors were taken), and a legendary hero
  // ability buff (distinct from magic_microphone's terrain boost).

  // 1 -------------------------------------------- background: keyboard hero
  {
    id: "keyboard_hero",
    name: "Keyboard Hero",
    category: "background",
    preferredBiomes: ["arcade-ruins"],
    rarity: "rare",
    trigger: "beat",
    energyRequired: 0.45,
    duration: [6, 10],
    minCooldown: 220,
    batch4: true,
    layer: "background",
    update(st, pq, a) {
      if (a.kickEdge) st.data.press = 0.2;
      st.data.press = Math.max(0, (st.data.press || 0) - 0.016);
      if (pq.treble.value > 0.55) {
        const x = Math.round(pq.pw * 0.62);
        trailSparkle(pq, x + (Math.random() - 0.5) * 10, pq.groundBase() - Math.round(14 * pq.S));
      }
    },
    draw(o, st, pq, pal) {
      const f = st.fade;
      const base = pq.groundBase();
      const x = Math.round(pq.pw * 0.62);
      const press = (st.data.press || 0) > 0;
      // a waist-high keyboard stand, silhouette player behind it
      o.fillStyle = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.3), f);
      o.fillRect(x - 7, base - 5, 15, 2); // keys deck
      o.fillRect(x - 5, base - 3, 11, 3); // stand legs
      o.fillStyle = `rgba(14,11,18,${f})`;
      o.fillRect(x - 2, base - 13, 4, 8); // body
      o.fillRect(x - 2, base - 16, 4, 3); // head
      // hands alternate raised/pressed on the beat
      o.fillRect(x - 6, base - (press ? 6 : 9), 3, 1);
      o.fillRect(x + 3, base - (press ? 9 : 6), 3, 1);
      o.fillStyle = `rgba(150,225,255,${(0.35 + pq.kickPulse * 0.45) * f})`; // keys glow
      o.fillRect(x - 6, base - 5, 13, 1);
    },
  },

  // 2 -------------------------------------------------- hero: power glove spark
  {
    id: "power_glove_spark",
    name: "Power Glove Spark",
    category: "hero",
    preferredBiomes: ["arcade-ruins"],
    rarity: "rare",
    trigger: "beat",
    energyRequired: 0.35,
    duration: [4, 6],
    minCooldown: 150,
    batch4: true,
    layer: null, // gauntlet + spark overlay rendered by drawHero
    when: (pq) => !pq.egg && pq.heroJumpY === 0,
    onStart(st, pq) {
      pq.egg = { type: "powerglove", t: 0, dur: st.dur, glow: 0 };
    },
    update(st, pq, a) {
      if (!pq.egg || pq.egg.type !== "powerglove") return;
      if (a.kickEdge) {
        pq.egg.glow = 1;
        if (pq.particles.length < 90) {
          pq.particles.push({
            kind: "ember",
            x: pq.pw * pq.heroAnchor + 13,
            y: pq.groundY(Math.round(pq.pw * pq.heroAnchor)) - 20,
            vx: 10 + Math.random() * 10,
            vy: -(6 + Math.random() * 6),
            age: 0,
            life: 0.35,
          });
        }
      }
      pq.egg.glow = Math.max(0, pq.egg.glow - 0.05);
    },
  },

  // 3 ------------------------------------------------- sky: laser grid sunrise
  {
    id: "laser_grid_sunrise",
    name: "Laser Grid Sunrise",
    category: "sky",
    rarity: "rare",
    trigger: "loudness",
    energyRequired: 0.45,
    duration: [6, 9],
    minCooldown: 260,
    isMajor: true,
    batch4: true,
    fadeSeconds: 1.4,
    layer: "sky",
    onStart(st) {
      st.data.beams = Array.from({ length: 9 }, (_, i) => ({ t: i / 8, hue: i / 8 }));
    },
    draw(o, st, pq) {
      const f = st.fade;
      const base = pq.groundBase();
      // a warm horizon wash, sunrise-style
      o.fillStyle = `rgba(255,150,90,${0.05 * f})`;
      o.fillRect(0, Math.round(base - pq.ph * 0.3), pq.pw, Math.round(pq.ph * 0.3));
      const reach = pq.ph * (0.3 + pq.bass.value * 0.15 + pq.kickPulse * 0.12);
      for (const b of st.data.beams) {
        const x = Math.round(b.t * pq.pw);
        const hue = 20 + b.hue * 200; // warm amber -> cool cyan across the grid
        const glow = 0.16 + pq.kickPulse * 0.25 + Math.sin(st.t * 2 + b.hue * 6) * 0.05;
        o.fillStyle = `hsla(${hue},95%,65%,${Math.max(0, glow) * f})`;
        o.fillRect(x, Math.round(base - reach), 1, Math.round(reach));
      }
    },
  },

  // 4 --------------------------------------------------------- ground: secret door
  {
    id: "secret_door",
    name: "Secret Door",
    // this doubles as the Adventure Layer's "Locked Door Moment": it
    // already appears roadside, glows, opens with light, and disappears —
    // rather than duplicate it, the adventure layer just reuses it and
    // reacts to it (see PixelQuestEventManager.start's reaction hook, and
    // the bass-driven rim glow added below).
    category: "ground",
    rarity: "rare",
    trigger: "quiet",
    storyTags: ["obstacle", "mystery", "destination_reveal"], // the Locked Door moment
    duration: [6, 9],
    minCooldown: 170, // trimmed slightly from 200 — still special, a bit more present
    batch4: true,
    layer: "ground",
    onStart(st, pq) {
      st.data.wx = roadsideSpawn(pq);
    },
    update(st, pq) {
      const openT = Math.min(1, st.t / 1.4, (st.dur - st.t) / 1.4);
      const swing = Math.sin(openT * Math.PI * 0.5);
      // a small "arrival" cue the moment it swings fully open, once
      if (swing > 0.9 && !st.data.celebrated) {
        st.data.celebrated = true;
        pq.triggerReaction?.("celebrate", 0.8);
      }
    },
    draw(o, st, pq, pal) {
      const sx = roadsideX(pq, st.data.wx);
      if (sx < -12 || sx > pq.pw + 12) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) + 1;
      const H = 13;
      // opens over the first 1.4s, holds, closes over the last 1.4s
      const openT = Math.min(1, st.t / 1.4, (st.dur - st.t) / 1.4);
      const swing = Math.sin(openT * Math.PI * 0.5); // eases open then shut
      // Biome System v1: same door, same mechanic — just what it's built
      // from changes with the world around it (a hillside door, a glowing
      // tree door, a house door, an arcade cabinet portal, a castle gate)
      const skin =
        DOOR_SKINS[pal?.biome] || DOOR_SKINS["meadow-road"];
      // locked-door tell: the frame glows with bass hits even while shut.
      // Quest System v1: a charged-up orb makes it glow noticeably brighter
      // and open a touch wider — "opens more dramatically" per spec.
      const charge = pq.adventure?.orb?.charge || 0;
      const bassGlow = 0.12 + pq.bass.value * 0.22 + pq.kickPulse * 0.3 + charge * 0.25;
      o.fillStyle = `rgba(${skin.frame},${st.fade})`; // frame
      o.fillRect(sx, gy - H, 9, H);
      o.fillRect(sx + 1, gy - H - 1, 7, 1);
      o.fillStyle = `rgba(${skin.rim},${bassGlow * st.fade * (1 - swing * 0.5)})`;
      o.fillRect(sx - 1, gy - H - 1, 11, H + 1); // rim glow, under the frame
      // the interior glow, revealed as the door swings (panel narrows)
      const gap = Math.max(1, Math.round((6 + charge * 1.5) * swing));
      o.fillStyle = `rgba(${skin.interior},${Math.min(1, (0.5 + charge * 0.3) * swing * st.fade)})`;
      o.fillRect(sx + 1, gy - H + 1, gap, H - 2);
      // a soft indistinct shape glimpsed within — never a specific figure
      if (swing > 0.55) {
        o.fillStyle = `rgba(255,235,200,${(swing - 0.55) * 1.4 * st.fade})`;
        o.fillRect(sx + 1 + Math.round(gap * 0.4), gy - 6, 1, 3);
      }
      // door panel, swinging shut over the gap
      o.fillStyle = `rgba(${skin.panel},${st.fade})`;
      o.fillRect(sx + 1 + gap, gy - H + 1, Math.max(0, 7 - gap), H - 2);
      o.fillStyle = `rgba(${skin.handle},${0.8 * st.fade})`; // handle
      o.fillRect(sx + 1 + gap, gy - H + Math.round(H / 2), 1, 1);
      if (pq.treble.value > 0.5) trailSparkle(pq, sx + 4, gy - 8);
    },
  },

  // 5 --------------------------------------------- weather: arcade token rain
  {
    id: "arcade_token_rain",
    name: "Arcade Token Rain",
    category: "weather",
    rarity: "uncommon",
    trigger: "loudness",
    duration: [7, 10],
    minCooldown: 180,
    batch4: true,
    fadeSeconds: 1,
    layer: "front",
    onStart(st) {
      st.data.tokens = Array.from({ length: 22 }, () => ({
        x: Math.random(),
        y: Math.random(),
        v: 0.5 + Math.random() * 0.4,
        spin: Math.random() * TAU,
      }));
    },
    update(st, pq, a, dt) {
      for (const c of st.data.tokens) {
        c.y += c.v * dt * (0.8 + pq.bass.value * 0.4);
        c.spin += dt * 6;
        if (c.y > 1) {
          c.y -= 1;
          c.x = Math.random();
        }
      }
    },
    draw(o, st, pq) {
      const f = st.fade;
      const n = Math.round(st.data.tokens.length * (0.6 + pq.loud.value * 0.4));
      for (let i = 0; i < n; i++) {
        const c = st.data.tokens[i];
        const x = Math.round(c.x * pq.pw);
        const y = Math.round(c.y * pq.ph);
        const wide = Math.abs(Math.sin(c.spin)) > 0.3; // tumbling coin
        o.fillStyle = `rgba(255,214,100,${0.85 * f})`;
        o.fillRect(x - (wide ? 1 : 0), y, wide ? 3 : 1, 2);
        o.fillStyle = `rgba(255,245,200,${0.9 * f})`;
        o.fillRect(x, y, 1, 1); // glint
      }
      if (pq.kickPulse > 0.6) {
        o.fillStyle = `rgba(255,220,140,${0.05 * f})`; // a bright chime low in frame
        o.fillRect(0, pq.ph - Math.round(pq.ph * 0.18), pq.pw, Math.round(pq.ph * 0.18));
      }
    },
  },

  // 6 --------------------------------------------------------- front: neon dragonfly
  {
    id: "neon_dragonfly",
    name: "Neon Dragonfly",
    category: "sky",
    preferredBiomes: ["neon-forest"],
    rarity: "uncommon",
    trigger: "treble",
    duration: [5, 7],
    minCooldown: 150,
    batch4: true,
    layer: "front",
    onStart(st, pq) {
      st.data.y0 = pq.ph * (0.4 + Math.random() * 0.22);
    },
    draw(o, st, pq) {
      const f = st.fade;
      const x = Math.round(pq.pw * 0.12 + st.p * pq.pw * 0.72 + Math.sin(st.t * 5.5) * 5);
      const y = Math.round(st.data.y0 + Math.sin(st.t * 3.1) * 9 + Math.sin(st.t * 12) * 2);
      const wingUp = Math.floor(st.t * 18) % 2 === 0;
      o.fillStyle = `rgba(20,235,220,${0.9 * f})`; // body
      o.fillRect(x, y, 3, 1);
      o.fillStyle = `rgba(255,60,200,${0.55 * f})`; // wings, alternating
      o.fillRect(x, y + (wingUp ? -1 : 1), 2, 1);
      o.fillRect(x + 2, y + (wingUp ? -1 : 1), 2, 1);
      o.fillStyle = `rgba(120,255,235,${0.35 * f})`; // trailing glow
      o.fillRect(x - 2, y, 1, 1);
      if (Math.random() < 0.25) {
        o.fillStyle = `rgba(255,120,220,${0.3 * f})`;
        o.fillRect(x - 3 - ((Math.random() * 2) | 0), y + ((Math.random() * 2) | 0) - 1, 1, 1);
      }
    },
  },

  // 7 ---------------------------------------------------- background: boombox parade
  {
    id: "boombox_parade",
    name: "Boombox Parade",
    category: "background",
    rarity: "rare",
    trigger: "beat",
    energyRequired: 0.4,
    duration: [7, 10],
    minCooldown: 200,
    batch4: true,
    layer: "background",
    draw(o, st, pq, pal) {
      const f = st.fade;
      const base = pq.groundBase();
      const x0 = Math.round(pq.pw + 20 - st.p * (pq.pw + 60));
      for (let i = 0; i < 3; i++) {
        const x = x0 + i * 11;
        if (x < -8 || x > pq.pw + 8) continue;
        const step = Math.floor(st.t * 3 + i) % 2;
        o.fillStyle = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.32), f);
        o.fillRect(x + (step ? 1 : 0), base - 4, 2, 4); // legs
        o.fillRect(x - (step ? 0 : 1), base - 4, 2, 4);
        o.fillRect(x - 1, base - 9, 4, 5); // body
        o.fillRect(x, base - 11, 2, 2); // head
        o.fillRect(x - 2, base - 12, 1, 4); // one raised arm
        const hot = i === 1 ? pq.kickPulse : 0.3; // the middle one carries the beat
        o.fillStyle = `rgba(255,${170 + Math.round(hot * 70)},110,${(0.6 + hot * 0.4) * f})`;
        o.fillRect(x - 4, base - 14, 5, 3); // boombox aloft
      }
      if (pq.treble.value > 0.5) trailSparkle(pq, x0 + 5, base - 15);
    },
  },

  // 8 --------------------------------------------------------- hero: cape moment
  {
    id: "hero_cape_moment",
    name: "Hero Cape Moment",
    category: "hero",
    preferredBiomes: ["castle-approach"],
    rarity: "uncommon",
    trigger: "beat",
    duration: [2.6, 3.6],
    minCooldown: 130,
    batch4: true,
    layer: null, // billowing cape overlay rendered by drawHero
    when: (pq) => !pq.egg && pq.heroJumpY === 0,
    onStart(st, pq) {
      pq.egg = { type: "cape", t: 0, dur: st.dur };
      pq.spawnSparkles();
    },
  },

  // 9 ------------------------------------------------- hero: star power burst
  {
    id: "star_power_burst",
    name: "Star Power Burst",
    category: "hero",
    preferredBiomes: ["castle-approach"],
    rarity: "legendary",
    trigger: "loudness",
    energyRequired: 0.6,
    duration: [8, 12],
    minCooldown: EVENT_TUNING.heroPowerUpCooldownSeconds,
    isMajor: true,
    batch4: true,
    layer: null, // aura rendered by drawHero; ability boost lives in
    // drawHero's eggPace speed multiplier and onKick's jump velocity
    when: (pq) => !pq.egg && pq.heroJumpY === 0,
    onStart(st, pq) {
      pq.egg = { type: "starpower", t: 0, dur: st.dur };
      pq.spawnSparkles();
    },
    update(st, pq, a) {
      if (a.kickEdge) pq.spawnSparkles();
    },
  },
];

// ------------------------------------------------------------ chapter events
// Foreground set pieces: rare, music-driven mini story moments where the
// hero actually interacts with the world. One at a time, long cooldowns,
// cameos suppressed while running, hero control always restored at the end.
// The hero is steered through pq.heroCtl: { scrollMul (0 = world pauses),
// pose ("ready"|"attack"|"celebrate"|null), attackT (drives lunge + slash) }.
export const CHAPTER_EVENTS = [
  // -------------------------------------------------------- slime battle
  {
    id: "slime_battle",
    name: "Slime Battle",
    tier: "chapter",
    category: "battle",
    rarity: "rare",
    trigger: "beat",
    duration: [10, 14],
    minCooldown: EVENT_TUNING.battleEventCooldownSeconds,
    isMajor: true,
    locksHeroControl: true,
    onStart(st, pq) {
      st.data.phase = "intro";
      st.data.hits = 0;
      st.data.flash = 0;
      st.data.sx = pq.pw * pq.heroAnchor + 62;
      pq.heroCtl = { scrollMul: 0.4, pose: null, attackT: 0 };
    },
    update(st, pq, a, dt) {
      const d = st.data;
      const ctl = pq.heroCtl;
      if (!ctl) return;
      d.flash = Math.max(0, d.flash - dt);
      ctl.attackT = Math.max(0, ctl.attackT - dt);
      const targetX = pq.pw * pq.heroAnchor + 28;
      if (d.phase === "intro") {
        // the slime hops in; the hero slows to a stop and draws his sword
        ctl.scrollMul = Math.max(0, 0.4 - st.t * 0.35);
        d.sx += (targetX - d.sx) * Math.min(1, dt * 2.2);
        if (st.t > 1.3) {
          ctl.pose = "ready";
          setPhase(st, "battle");
        }
      } else if (d.phase === "battle") {
        ctl.scrollMul = 0;
        if (a.kickEdge) {
          ctl.attackT = 0.22; // strike ON the kick
          d.hits++;
          d.flash = 0.16;
          for (let k = 0; k < 3 && pq.particles.length < 90; k++) {
            pq.particles.push({
              kind: "sparkle",
              x: d.sx + (Math.random() - 0.5) * 8,
              y: pq.groundY(Math.round(d.sx)) - 5 - Math.random() * 4,
              vx: (Math.random() - 0.5) * 14,
              vy: -(4 + Math.random() * 8),
              age: 0,
              life: 0.4,
            });
          }
          if (d.hits >= 4) {
            setPhase(st, "defeat");
            d.defeatT = 0;
            for (let k = 0; k < 8 && pq.particles.length < 90; k++) {
              pq.particles.push({
                kind: "sparkle",
                x: d.sx + (Math.random() - 0.5) * 10,
                y: pq.groundY(Math.round(d.sx)) - 4 - Math.random() * 5,
                vx: (Math.random() - 0.5) * 22,
                vy: -(6 + Math.random() * 10),
                age: 0,
                life: 0.6,
              });
            }
          }
        }
        if (st.p > 0.85) {
          setPhase(st, "defeat"); // the song wins the fight either way
          d.defeatT = 0;
        }
      } else if (d.phase === "defeat") {
        d.defeatT = (d.defeatT || 0) + dt;
        if (d.defeatT > 0.7) {
          ctl.pose = "celebrate";
          setPhase(st, "outro");
          d.outroT = 0;
        }
      } else if (d.phase === "outro") {
        d.outroT += dt;
        if (d.outroT > 1.1) st.data.done = true;
      }
    },
    draw(o, st, pq) {
      const d = st.data;
      if (d.phase === "outro" || d.phase === "defeat" && (d.defeatT || 0) > 0.45) return;
      const sx = Math.round(d.sx);
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx))) + 1;
      const dying = d.phase === "defeat";
      const fade = dying ? 1 - (d.defeatT || 0) / 0.45 : 1;
      // the slime: squashes with bass, hops, flashes when struck, shrinks
      const size = Math.max(5, 10 - d.hits);
      const squash = 1 - pq.bass.value * 0.25;
      const h2 = Math.max(3, Math.round((size * 0.7) * squash));
      const w2 = size + Math.round(pq.bass.value * 2);
      const hop = d.phase === "intro" ? Math.abs(Math.sin(st.t * 6)) * 3 : Math.abs(Math.sin(st.t * 4)) * (1 + pq.bass.value * 2);
      const y = Math.round(gy - h2 - hop);
      const hit = d.flash > 0;
      o.fillStyle = hit ? `rgba(255,255,255,${fade})` : `rgba(112,192,122,${0.95 * fade})`;
      o.fillRect(sx - (w2 >> 1), y, w2, h2);
      o.fillRect(sx - (w2 >> 1) + 1, y - 1, w2 - 2, 1); // rounded top
      o.fillStyle = hit ? `rgba(255,255,255,${fade})` : `rgba(74,138,88,${0.95 * fade})`;
      o.fillRect(sx - (w2 >> 1), y + h2 - 1, w2, 1); // belly shade
      // cute eyes, watching the hero
      o.fillStyle = `rgba(20,26,22,${fade})`;
      o.fillRect(sx - 2, y + 1, 1, 2);
      o.fillRect(sx + 1, y + 1, 1, 2);
      o.fillStyle = `rgba(255,255,255,${0.9 * fade})`;
      o.fillRect(sx - 2, y + 1, 1, 1);
      o.fillRect(sx + 1, y + 1, 1, 1);
    },
  },

  // ---------------------------------------------------- castle gate arrival
  {
    id: "castle_gate",
    name: "Castle Gate Arrival",
    tier: "chapter",
    category: "landmark",
    rarity: "legendary",
    trigger: "quietToLoud",
    duration: [14, 19],
    minCooldown: EVENT_TUNING.landmarkEventCooldownSeconds,
    isMajor: true,
    locksHeroControl: true,
    canTriggerBiomeTransition: true,
    onStart(st, pq) {
      st.data.phase = "approach";
      st.data.wx = pq.scrollX + pq.pw + 34; // enters from the right, on the road
      st.data.open = 0;
      pq.heroCtl = { scrollMul: 1, pose: null, attackT: 0 };
    },
    update(st, pq, a, dt) {
      const d = st.data;
      const ctl = pq.heroCtl;
      if (!ctl) return;
      const sx = d.wx - pq.scrollX; // gate's left edge on screen
      const heroX = pq.pw * pq.heroAnchor;
      if (d.phase === "approach") {
        ctl.scrollMul = 1;
        if (sx < pq.pw * 0.5) {
          ctl.scrollMul = 0;
          d.pauseT = 0;
          setPhase(st, "pause");
        }
      } else if (d.phase === "pause") {
        d.pauseT += dt;
        if (d.pauseT > 1.2) setPhase(st, "opening");
      } else if (d.phase === "opening") {
        if (a.kickEdge && d.open < 6) {
          d.open++; // the portcullis rises one step per kick
          d.shake = 0.12;
        }
        if (d.open >= 6) {
          setPhase(st, "enter");
          ctl.scrollMul = 0.75;
          // half the time, the road beyond leads to castle country
          const castleIdx = pq.findBiomeIndex("castle-approach");
          if (Math.random() < 0.5 && pq.biomeT >= 1 && pq.biomeIdx !== castleIdx) {
            pq.biomeNext = castleIdx;
            pq.biomeT = 0;
          }
        }
        if (st.p > 0.8 && d.open < 6) d.open = 6; // the song always gets him in
      } else if (d.phase === "enter") {
        ctl.scrollMul = 0.75;
        if (sx + 48 < heroX - 8) {
          st.data.done = true; // through and beyond
        }
      }
      d.shake = Math.max(0, (d.shake || 0) - dt);
    },
    // arch, doorway glow and portcullis draw BEHIND the hero...
    draw(o, st, pq, pal) {
      const d = st.data;
      const sx = Math.round(d.wx - pq.scrollX) + (d.shake > 0 || pq.bass.value > 0.65 ? Math.round((Math.random() - 0.5) * 2) : 0);
      if (sx > pq.pw + 50 || sx + 60 < 0) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx + 23))) + 1;
      const H = 40;
      const stone = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.25));
      // the arch spanning the doorway
      o.fillStyle = stone;
      o.fillRect(sx + 6, gy - H, 34, 6);
      o.fillRect(sx + 8, gy - H + 6, 30, 2);
      // doorway glow builds as it opens
      const glow = 0.1 + d.open * 0.08 + pq.loud.value * 0.15;
      o.fillStyle = `rgba(255,200,120,${glow})`;
      o.fillRect(sx + 12, gy - H + 8, 22, H - 8);
      // the portcullis: bars rise one beat at a time
      o.fillStyle = "rgb(30,26,36)";
      for (let k = 0; k < 6 - d.open; k++) {
        o.fillRect(sx + 12, gy - H + 9 + k * 5, 22, 2);
      }
      if (pq.treble.value > 0.55) {
        o.fillStyle = "rgba(230,240,255,0.8)"; // glints on the stonework
        o.fillRect(sx + 8 + ((st.seed + Math.floor(st.t * 4)) % 28), gy - H + 2, 1, 1);
      }
    },
    // ...and the towers draw IN FRONT, so the hero passes between them
    drawFront(o, st, pq, pal) {
      const d = st.data;
      const sx = Math.round(d.wx - pq.scrollX);
      if (sx > pq.pw + 50 || sx + 60 < 0) return;
      const gy = pq.groundY(Math.max(0, Math.min(pq.pw - 1, sx + 23))) + 1;
      const H = 40;
      const stone = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.25));
      const dark = pq.col(pq.mix(pal.mtMid, [0, 0, 0], 0.5));
      for (const tx of [sx, sx + 36]) {
        o.fillStyle = stone;
        o.fillRect(tx, gy - H - 4, 12, H + 4);
        o.fillStyle = dark;
        for (let k = 0; k < 3; k++) o.fillRect(tx + 1 + k * 4, gy - H - 6, 3, 2); // crenellation
        o.fillRect(tx + 2, gy - H + 10, 2, 3); // arrow slit
        // tower torches, flickering with the mids and kicks
        const fl = 0.55 + pq.mids.value * 0.25 + pq.kickPulse * 0.3 + 0.1 * Math.sin(st.t * 9 + tx);
        o.fillStyle = `rgba(255,180,80,${fl})`;
        o.fillRect(tx + 5, gy - H + 4, 2, 3);
        o.fillStyle = `rgba(255,220,150,${fl * 0.3})`;
        o.fillRect(tx + 3, gy - H + 2, 6, 6);
      }
    },
  },

  // ---------------------------------------------------- moon bridge crossing
  {
    id: "moon_bridge",
    name: "Moon Bridge Crossing",
    tier: "chapter",
    category: "obstacle",
    rarity: "rare",
    trigger: "beat",
    duration: [12, 16],
    minCooldown: EVENT_TUNING.obstacleEventCooldownSeconds,
    isMajor: true,
    locksHeroControl: true,
    onStart(st, pq) {
      st.data.phase = "reveal";
      st.data.wx = pq.scrollX + pq.pw * pq.heroAnchor + 36; // the gap, just ahead
      st.data.gapW = 64;
      st.data.tiles = 0;
      pq.heroCtl = { scrollMul: 0.6, pose: null, attackT: 0 };
    },
    update(st, pq, a, dt) {
      const d = st.data;
      const ctl = pq.heroCtl;
      if (!ctl) return;
      const heroX = pq.pw * pq.heroAnchor;
      if (d.phase === "reveal") {
        ctl.scrollMul = Math.max(0, 0.6 - st.t * 0.5); // ease to a halt at the edge
        if (st.t > 1.4) setPhase(st, "form");
      } else if (d.phase === "form") {
        ctl.scrollMul = 0;
        if (a.kickEdge && d.tiles < 8) {
          d.tiles++; // the music lays one tile per kick
          const tx = d.wx - pq.scrollX + (d.tiles - 1) * 8 + 4;
          if (pq.particles.length < 90)
            pq.particles.push({
              kind: "sparkle",
              x: tx,
              y: pq.groundY(Math.round(heroX)) - 3,
              vx: 0,
              vy: -6,
              age: 0,
              life: 0.4,
            });
        }
        if (d.tiles >= 8) {
          setPhase(st, "cross");
          ctl.scrollMul = 0.7;
        }
        if (st.p > 0.7 && d.tiles < 8) d.tiles = 8; // never strand him
      } else if (d.phase === "cross") {
        ctl.scrollMul = 0.7;
        if (d.wx - pq.scrollX + d.gapW < heroX - 12) {
          setPhase(st, "dissolve");
          d.dissT = 0;
        }
      } else if (d.phase === "dissolve") {
        d.dissT = (d.dissT || 0) + dt;
        ctl.scrollMul = Math.min(1, 0.7 + d.dissT * 0.4);
        if (d.dissT > 1) st.data.done = true;
      }
    },
    draw(o, st, pq) {
      const d = st.data;
      const x0 = Math.round(d.wx - pq.scrollX);
      if (x0 > pq.pw + 10 || x0 + d.gapW < -10) return;
      const fade = d.phase === "dissolve" ? Math.max(0, 1 - (d.dissT || 0)) : 1;
      const yB = pq.groundY(Math.max(0, Math.min(pq.pw - 1, x0 - 4))); // bridge level
      // the gap: a dark drop where the road used to be
      for (let x = Math.max(0, x0); x < Math.min(pq.pw, x0 + d.gapW); x++) {
        const gy = pq.groundY(x);
        o.fillStyle = "rgb(5,3,10)";
        o.fillRect(x, gy, 1, pq.ph - gy);
      }
      o.fillStyle = `rgba(120,220,160,0.6)`; // grassy rims at both edges
      o.fillRect(x0 - 1, pq.groundY(Math.max(0, Math.min(pq.pw - 1, x0 - 1))), 1, 2);
      o.fillRect(x0 + d.gapW, pq.groundY(Math.max(0, Math.min(pq.pw - 1, x0 + d.gapW))), 1, 2);
      // the moonlit tiles, laid by the beats
      for (let i = 0; i < d.tiles; i++) {
        const tx = x0 + i * 8;
        if (tx + 7 < 0 || tx > pq.pw) continue;
        const underfoot = Math.abs(tx + 4 - pq.pw * pq.heroAnchor) < 10;
        const glow = 0.5 + pq.bass.value * 0.25 + pq.kickPulse * 0.2 + (underfoot ? 0.25 : 0);
        o.fillStyle = `rgba(190,214,255,${Math.min(1, glow) * fade})`;
        o.fillRect(tx + 1, yB, 6, 2);
        o.fillStyle = `rgba(140,170,255,${0.25 * glow * fade})`; // underglow
        o.fillRect(tx, yB + 2, 8, 2);
        if (pq.treble.value > 0.5 && Math.random() < 0.06) trailSparkle(pq, tx + 4, yB + 3);
      }
    },
  },
];

// ---------------------------------------------------------------------------
// Cameo sprite wiring. Maps events to their imported art + where to draw it.
// The shared path (PixelQuestEventManager._drawEventSprite) reads def.asset +
// def.spriteAt (attached below), draws the sprite (faded by st.fade) at that
// position, and falls back to the procedural body when the asset isn't ready.
// Positions mirror each event's procedural placement. FX-only cameos (rain,
// lightning, glowing road, laser grid, portal, …) and the gated hero-costume
// showpieces (layer:null, drawn via pq.egg) stay procedural — intentionally
// absent here. `at(st,pq,pal)` returns {x,y[,scale,anchor]}; null = skip (fall
// back to procedural, e.g. the sports car's lingering trail after it exits).
const _gy = (pq, x) => pq.groundY(Math.max(0, Math.min(pq.pw - 1, Math.round(x)))) + 1;
const _moonOverlayAt = (st, pq, pal) => {
  const { mx, my } = moonPos(pq, pal);
  const d = Math.round(5 * pq.S) * 2 + 4; // ~ the moon's diameter (+ a hair)
  return { x: mx, y: my, scale: d / (71 * (pq.assets?.artScale || 1)) }; // 71 = overlay frameW
};
const CAMEO_SPRITES = {
  // sky — floating silhouettes, center-anchored
  bicycle_moon: { asset: "bicycleRider", scale: 0.7, anchor: "center", at: (st, pq, pal) => { const { mx, my } = moonPos(pq, pal); return { x: mx - 38 + st.p * 88, y: my + 2 - Math.sin(st.p * Math.PI) * 9 }; } },
  witch_moon: { asset: "witchBroom", scale: 0.65, anchor: "center", at: (st, pq) => ({ x: pq.pw + 17 - st.p * (pq.pw + 30), y: 12 + (st.seed % 18) + Math.sin(st.t * 2.2) * 2 }) },
  winged_moon_shadow: { asset: "wingedShadow", scale: 0.6, anchor: "center", at: (st, pq, pal) => { const { mx, my } = moonPos(pq, pal); return { x: mx - 29 + st.p * 60, y: my - 2 - Math.sin(st.p * Math.PI) * 4 }; } },
  dragon_shadow: { asset: "skyDragon", scale: 0.62, anchor: "center", at: (st, pq) => ({ x: pq.pw + 28 - st.p * (pq.pw + 50), y: 10 + (st.seed % 10) + Math.sin(st.t * 1.1) * 3 }) },
  pirate_ship_cloud: { asset: "pirateShip", scale: 0.55, anchor: "center", at: (st, pq) => ({ x: pq.pw + 22 - st.p * (pq.pw + 46), y: 15 + (st.seed % 8) + Math.sin(st.t * 0.8) + pq.bass.value * 1.5 }) },
  spy_rope_drop: { asset: "spyRope", scale: 1.0, anchor: "top-center", at: (st, pq) => ({ x: Math.round(pq.pw * (0.3 + ((st.seed % 100) / 100) * 0.3)) + 2, y: 2 }) },
  meteor_cassette: { asset: "meteorCassette", scale: 0.5, anchor: "center", at: (st, pq) => { const m = clamp01(st.p / 0.45); return { x: pq.pw * 0.9 - m * pq.pw * 0.45, y: -2 + m * 34 }; } },
  disco_moon: { asset: "discoMoon", anchor: "center", at: _moonOverlayAt },
  record_moon: { asset: "recordMoon", anchor: "center", at: _moonOverlayAt },
  moon_face_wink: { asset: "winkMoon", anchor: "center", at: _moonOverlayAt },
  // ground — bottom-anchored on the road
  boulder_chase: { asset: "boulder", scale: 0.7, anchor: "bottom-center", at: (st, pq) => ({ x: st.data.x, y: _gy(pq, st.data.x) }) },
  red_balloon_grate: { asset: "redBalloon", scale: 0.55, anchor: "bottom-center", at: (st, pq) => { const sx = st.data.wx - pq.scrollX; return { x: sx + Math.sin(st.t * 1.1) * 2, y: _gy(pq, sx) - st.p * 34 }; } },
  black_cat_crossing: { asset: "blackCat", scale: 0.5, anchor: "bottom-center", at: (st, pq) => { const x = pq.pw * 0.75 - st.p * pq.pw * 0.55; return { x: x + 3, y: _gy(pq, x) }; } },
  cassette_tumbleweed: { asset: "cassetteTumbleweed", scale: 0.5, anchor: "bottom-center", at: (st, pq) => { const x = pq.pw + 10 - st.p * (pq.pw + 30); return { x: x + 3, y: _gy(pq, x) - Math.abs(Math.sin(st.t * 6)) * (2 + pq.kickPulse * 3) * 0.5 }; } },
  time_trail_car: { asset: "sportsCar", scale: 0.5, anchor: "bottom-center", at: (st, pq) => { if (st.t >= 1.4) return null; const c = clamp01(st.t / 1.4); const x = -20 + c * (pq.pw + 44); return { x, y: _gy(pq, x) }; } },
  shark_fin_pond: { asset: "sharkFin", scale: 0.5, anchor: "bottom-center", at: (st, pq) => { const sx = st.data.wx - pq.scrollX + 13; return { x: sx, y: _gy(pq, sx) }; } },
  submarine_periscope: { asset: "submarinePeriscope", scale: 0.5, anchor: "bottom-center", at: (st, pq) => { const sx = st.data.wx - pq.scrollX + 11; return { x: sx, y: _gy(pq, sx) }; } },
  secret_door: { asset: "secretDoor", scale: 0.6, anchor: "bottom-center", at: (st, pq) => { const sx = roadsideX(pq, st.data.wx) + 4; return { x: sx, y: _gy(pq, sx) }; } },
  // prop — bottom-anchored roadside objects
  jukebox: { asset: "jukebox", scale: 0.7, anchor: "bottom-center", at: (st, pq) => { const sx = roadsideX(pq, st.data.wx) + 5; return { x: sx, y: _gy(pq, sx) }; } },
  arcade_cabinet: { asset: "arcadeCabinet", scale: 0.65, anchor: "bottom-center", at: (st, pq) => { const sx = roadsideX(pq, st.data.wx) + 4; return { x: sx, y: _gy(pq, sx) }; } },
  sword_in_stone: { asset: "swordInStone", scale: 0.6, anchor: "bottom-center", at: (st, pq) => { const sx = roadsideX(pq, st.data.wx); return { x: sx, y: _gy(pq, sx) }; } },
  ghost_trap: { asset: "ghostTrap", scale: 0.6, anchor: "bottom-center", at: (st, pq) => { const sx = roadsideX(pq, st.data.wx); return { x: sx, y: _gy(pq, sx) }; } },
  phone_booth_lightning: { asset: "phoneBooth", scale: 0.6, anchor: "bottom-center", at: (st, pq) => { const sx = roadsideX(pq, st.data.wx) + 4; return { x: sx, y: _gy(pq, sx) }; } },
  magic_microphone: { asset: "magicMicrophone", scale: 0.6, anchor: "bottom-center", at: (st, pq) => { const sx = roadsideX(pq, st.data.wx) + 1; return { x: sx, y: _gy(pq, sx) }; } },
  blue_time_booth: { asset: "blueTimeBooth", scale: 0.6, anchor: "bottom-center", at: (st, pq) => { const sx = roadsideX(pq, st.data.wx) + 4; return { x: sx, y: _gy(pq, sx) }; } },
  // background — distant, bottom-anchored on the horizon line
  robot_duo: { asset: "robotDuo", scale: 0.5, anchor: "bottom-center", at: (st, pq) => ({ x: pq.pw * 0.15 + st.p * pq.pw * 0.5 + 4, y: pq.groundBase() - Math.round(10 * pq.S) }) },
  crane_kick: { asset: "craneKick", scale: 0.5, anchor: "bottom-center", at: (st, pq) => ({ x: pq.pw * 0.68 + 2, y: pq.groundBase() }) },
  rainy_detective: { asset: "detectiveRain", scale: 0.5, anchor: "bottom-center", at: (st, pq) => ({ x: pq.pw * 0.82 + 7, y: pq.groundBase() - Math.round(6 * pq.S) }) },
  forest_giant: { asset: "giantCreature", scale: 0.6, anchor: "bottom-center", at: (st, pq) => ({ x: pq.pw * 0.7, y: pq.groundBase() }) },
  glam_guitarist: { asset: "glamGuitarist", scale: 0.5, anchor: "bottom-center", at: (st, pq) => ({ x: pq.pw * 0.32, y: pq.groundBase() }) },
  dinosaur_horizon: { asset: "dinosaur", scale: 0.5, anchor: "bottom-center", at: (st, pq) => ({ x: pq.pw + 30 - st.p * (pq.pw + 90) + 10, y: pq.groundBase() - Math.round(4 * pq.S) }) },
  masked_shadow: { asset: "maskedShadow", scale: 0.6, anchor: "bottom-center", at: (st, pq) => { const sx = roadsideX(pq, st.data.wx); return { x: sx, y: _gy(pq, sx) }; } },
  adventure_statue: { asset: "statue", scale: 0.55, anchor: "bottom-center", at: (st, pq) => { const sx = roadsideX(pq, st.data.wx); return { x: sx, y: _gy(pq, sx) }; } },
  wizard_train: { asset: "steamTrain", scale: 0.7, anchor: "bottom-center", at: (st, pq) => ({ x: pq.pw * 0.47, y: pq.groundBase() }) },
  tiny_drummer: { asset: "tinyDrummer", scale: 0.5, anchor: "bottom-center", at: (st, pq) => ({ x: pq.pw * 0.86, y: pq.groundBase() }) },
  neon_diner: { asset: "neonDinerSign", scale: 0.5, anchor: "bottom-center", at: (st, pq) => ({ x: st.data.wx - pq.scrollX * 0.3 + 10, y: pq.groundBase() }) },
  castle_ballroom: { asset: "ballroomWindow", scale: 0.5, anchor: "bottom-center", at: (st, pq) => ({ x: st.data.wx - pq.scrollX * 0.3 + 8, y: pq.groundBase() }) },
  keyboard_hero: { asset: "keyboardPlayer", scale: 0.5, anchor: "bottom-center", at: (st, pq) => ({ x: pq.pw * 0.62, y: pq.groundBase() }) },
  // front — a neon dragonfly flitting across (rides its own onStart y0)
  neon_dragonfly: { asset: "neonDragonfly", scale: 0.6, anchor: "center", at: (st, pq) => ({ x: pq.pw * 0.12 + st.p * pq.pw * 0.72 + Math.sin(st.t * 5.5) * 5, y: (st.data.y0 ?? pq.ph * 0.5) + Math.sin(st.t * 3.1) * 9 + Math.sin(st.t * 12) * 2 }) },
  // background — a 3-figure boombox parade marching the horizon (lead via the
  // shared path; the two followers drawn in drawExtra so they share the fade)
  boombox_parade: {
    asset: "boomboxMarcher", scale: 0.55, anchor: "bottom-center",
    at: (st, pq) => { const x0 = pq.pw + 20 - st.p * (pq.pw + 60), bob = Math.floor(st.t * 3) % 2 ? -0.5 : 0; return { x: x0, y: pq.groundBase() + bob }; },
    drawExtra: (o, st, pq) => {
      const x0 = pq.pw + 20 - st.p * (pq.pw + 60);
      for (let i = 1; i < 3; i++) {
        const x = x0 + i * 14;
        if (x < -10 || x > pq.pw + 10) continue;
        const bob = Math.floor(st.t * 3 + i) % 2 ? -0.5 : 0;
        pq.assets.drawSprite(o, "boomboxMarcher", "idle", 0, Math.round(x), Math.round(pq.groundBase() + bob), { anchor: "bottom-center", scale: 0.55, alpha: st.fade });
      }
    },
  },
};
for (const [id, s] of Object.entries(CAMEO_SPRITES)) {
  const d = PIXEL_EVENTS.find((e) => e.id === id);
  if (!d) continue;
  d.asset = s.asset;
  d.spriteAt = s.at;
  d.assetScale = s.scale;
  d.assetAnchor = s.anchor;
  if (s.drawExtra) d.drawExtra = s.drawExtra;
}

// ------------------------------------------------------------ future library
// The original 50-idea catalog is fully implemented (see PIXEL_EVENTS above).
// To add a new cameo, append an object like this to PIXEL_EVENTS — the same
// homage rules apply: silhouettes, gestures, and moods; never names, logos,
// text, or exact designs.
//
//   {
//     id: "my_event",
//     name: "My Event",
//     category: "sky" | "hero" | "ground" | "background" | "prop" | "weather" | "transition",
//     rarity: "common" | "uncommon" | "rare" | "legendary",
//     trigger: "beat" | "bass" | "treble" | "loudness" | "quiet" | "random",
//     duration: [minSeconds, maxSeconds],
//     minCooldown: 180,
//     energyRequired: 0.4,            // optional driveFx floor
//     allowedBiomes: ["moonlit-town"], // optional — hard filter, only fires there
//     preferredBiomes: ["neon-forest"], // optional — soft boost, still fires elsewhere
//     isMajor: true,                  // optional: owns the stage, longer cooldowns
//     layer: "sky" | "background" | "ground" | "front" | null, // null = via hero/egg
//     onStart(st, pq, mgr) {},        // st.data is your scratch space
//     update(st, pq, audio, dt, mgr) {}, // audio.kickEdge / snareEdge / bass / treble...
//     draw(o, st, pq, pal) {},        // st.p = progress 0..1, st.fade = in/out
//     onEnd(st, pq, mgr) {},          // clean up anything you touched on pq
//   }
export const FUTURE_EVENTS = [];
