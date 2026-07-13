// Pixel Quest — Story Engine Scaffolding v1.
//
// This does NOT add visible content or lore. It's the organizing layer that
// lets a future song-structure / episode-director drive Pixel Quest's
// existing moments (encounters, arrivals, transitions, adventure beats,
// ambient events) INTENTIONALLY — like a silent film director — instead of
// them firing independently.
//
// It owns four small things:
//   - story TAGS on every major moment (what it's doing emotionally)
//   - a story STATE (intensity / wonder / comedy / danger / emotion levels,
//     recent beats, cooldowns) updated each frame
//   - DIRECTOR rules + query helpers (canTrigger…, chooseBeatByTags,
//     suppress…) the future director will call
//   - a cinematic TEXT-CARD system (film title cards, not HUD/dialogue)
//   - RELATIONSHIP hooks (heroLookAtOrb, orbCircleExcitedly, …) that story
//     moments can call — some are real animations now, some are structured
//     flags ready for later.
//
// No lore is hardcoded. The placeholder card lines up top are meant to be
// edited freely once the mythology is settled.

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// The vocabulary of what a moment is doing, narratively/emotionally. Kept
// deliberately small and readable.
export const STORY_TAGS = [
  "ambient",
  "discovery",
  "comedy",
  "mystery",
  "danger",
  "friendship",
  "obstacle",
  "arrival",
  "transition",
  "quiet_emotion",
  "heroic_payoff",
  "music_energy",
  "destination_reveal",
];

// -------------------------------------------------------- placeholder text
// PLACEHOLDER LINES — safe to rewrite wholesale once the story is set. These
// are film-title / storybook phrases (1–5 words), never narration/dialogue.
const BIOME_TITLES = {
  "meadow-road": "Meadow Road",
  "neon-forest": "Neon Forest",
  "moonlit-town": "Moonlit Town",
  "arcade-ruins": "Arcade Ruins",
  "castle-approach": "Castle Approach",
  "starfall-shore": "Starfall Shore",
};
// moment cards keyed by the strongest tag a beat carries
const MOMENT_LINES = {
  arrival: ["Onward", "The Gate Awakens", "A Place to Rest"],
  destination_reveal: ["A Signal in the Distance", "Something Ahead"],
  mystery: ["A Strange Door", "Who Goes There?"],
  danger: ["Something Stirs", "Stand Firm"],
  friendship: ["A Friend Appears", "Not Alone"],
  quiet_emotion: ["A Quiet Fire", "Rest a While"],
  discovery: ["A New Path", "Look —"],
  heroic_payoff: ["Onward", "The Way Opens"],
  comedy: ["A Rival Appears", "Race You"],
};
// rare, wordless-poetic interludes
const POETIC_LINES = ["The music remembers", "Follow the light", "Every song, a new world"];

const STORY_TUNING = {
  recentBeatsMax: 12, // capped history — no unbounded growth
  recentLinesMax: 8,
  majorBeatCooldown: 18, // director-level spacing between major story beats
  textCardCooldown: 26, // min seconds between any two cards
  levelDecayPerSec: 0.22, // wonder/comedy/danger/emotion ease back to 0
  intensityTau: 1.2, // storyIntensity EMA toward mood energy
  transitionGraceSeconds: 5, // no major beat right after a biome swap
  cardFade: { in: 0.8, hold: 2.4, out: 1.1 },
};

// which tags feed which emotional level, and how hard (a beat "bumps" these)
const TAG_LEVEL = {
  wonder: { discovery: 0.5, mystery: 0.45, destination_reveal: 0.4, music_energy: 0.2 },
  comedy: { comedy: 0.7 },
  danger: { danger: 0.7, obstacle: 0.25 },
  emotion: { quiet_emotion: 0.6, friendship: 0.5, heroic_payoff: 0.35, arrival: 0.3 },
};

export class StoryDirector {
  constructor(pq) {
    this.pq = pq;
    // ---- story state ----
    this.currentStoryBeat = null; // name of the beat currently "on stage"
    this.recentBeats = []; // capped [{name, tags, t}]
    this.storyIntensity = 0; // 0..1, tracks musical energy
    this.wonderLevel = 0;
    this.comedyLevel = 0;
    this.dangerLevel = 0;
    this.emotionLevel = 0;
    this.timeSinceLastMajorBeat = 999;
    this.timeSinceLastTextCard = 999;
    this.currentMomentType = "ambient";
    this.allowMajorBeat = true;
    this.allowTextCard = true;
    // ---- director control ----
    this._minorSuppressedUntil = 0; // clock time
    this._majorSuppressedUntil = 0;
    // ---- text cards ----
    this.storyTextMode = "minimal"; // "off" | "minimal" | "cinematic"
    this.card = null; // active card {text, kind, t, dur}
    this._recentLines = []; // capped, to avoid repeats
    this._lastBiomeIdx = null;
    // ---- relationship hooks state (orb reads these; hero uses reactions) ----
    this.orbCmd = null; // { mode, until } — a short-lived directed behavior
  }

  // ------------------------------------------------------------- per frame
  update(dt) {
    const pq = this.pq;
    const clock = pq.clock || 0;
    this.timeSinceLastMajorBeat += dt;
    this.timeSinceLastTextCard += dt;

    // intensity tracks the music; the emotional levels decay toward calm
    const energy = pq.adventure?.mood?.energy || 0;
    this.storyIntensity += (energy - this.storyIntensity) * Math.min(1, dt / STORY_TUNING.intensityTau);
    const decay = STORY_TUNING.levelDecayPerSec * dt;
    this.wonderLevel = Math.max(0, this.wonderLevel - decay);
    this.comedyLevel = Math.max(0, this.comedyLevel - decay);
    this.dangerLevel = Math.max(0, this.dangerLevel - decay);
    this.emotionLevel = Math.max(0, this.emotionLevel - decay);
    // a quiet mood gently keeps some emotional warmth alive
    const mood = pq.adventure?.mood?.state;
    if (mood === "calm" || mood === "breakdown") this.emotionLevel = Math.max(this.emotionLevel, 0.25);

    // derived director permissions (the future director consults these)
    this.allowMajorBeat = this.#canMajorBeat();
    this.allowTextCard = this.#canTextCard();
    this.currentMomentType = this.#deriveMomentType();

    // biome title cards — the one card type on by default (minimal+cinematic)
    if (this._lastBiomeIdx === null) this._lastBiomeIdx = pq.biomeIdx;
    if (pq.biomeIdx !== this._lastBiomeIdx && (pq.biomeT ?? 1) >= 1) {
      this._lastBiomeIdx = pq.biomeIdx;
      this.markBeatTriggered("biome:" + pq.currentBiome().name, ["transition"]);
      if (this.storyTextMode !== "off") this.#showCard(BIOME_TITLES[pq.currentBiome().name], "biome");
    }

    // orb directed-behavior expiry
    if (this.orbCmd && clock > this.orbCmd.until) this.orbCmd = null;

    this.#updateCard(dt);
  }

  #deriveMomentType() {
    if (this.dangerLevel > 0.5) return "danger";
    if (this.comedyLevel > 0.5) return "comedy";
    if (this.wonderLevel > 0.5) return "wonder";
    if (this.emotionLevel > 0.5) return "emotion";
    if (this.storyIntensity > 0.6) return "energy";
    return "ambient";
  }

  // ---------------------------------------------------- selection helpers
  // (practical names the future song-structure director will call)

  // is the world allowed to introduce a major story beat with this tag now?
  canTriggerBeat(tag) {
    if (!this.allowMajorBeat) return false;
    // danger should feel rare & meaningful; comedy occasional, not constant
    if (tag === "danger" && this.hasRecentBeatTag("danger", 90)) return false;
    if (tag === "comedy" && this.hasRecentBeatTag("comedy", 45)) return false;
    return true;
  }

  // record that a moment happened (called by encounters/arrivals/beats/events)
  markBeatTriggered(name, tags = []) {
    const clock = this.pq.clock || 0;
    this.currentStoryBeat = name;
    this.recentBeats.push({ name, tags, t: clock });
    if (this.recentBeats.length > STORY_TUNING.recentBeatsMax) this.recentBeats.shift();
    // bump emotional levels from the beat's tags
    for (const [level, map] of Object.entries(TAG_LEVEL)) {
      let bump = 0;
      for (const tag of tags) if (map[tag]) bump = Math.max(bump, map[tag]);
      if (bump) this[level + "Level"] = clamp01(this[level + "Level"] + bump);
    }
    // any major beat resets the major-beat spacing timer and may earn a
    // cinematic moment card (offerMomentCard self-gates on mode + cooldown)
    const major = tags.some((t) => t === "arrival" || t === "danger" || t === "heroic_payoff" || t === "destination_reveal");
    if (major) {
      this.timeSinceLastMajorBeat = 0;
      this.offerMomentCard(tags);
    }
  }

  getRecentBeatTags() {
    const tags = new Set();
    for (const b of this.recentBeats) for (const t of b.tags) tags.add(t);
    return [...tags];
  }

  hasRecentBeatTag(tag, seconds) {
    const clock = this.pq.clock || 0;
    for (let i = this.recentBeats.length - 1; i >= 0; i--) {
      const b = this.recentBeats[i];
      if (clock - b.t > seconds) break; // older than the window (list is chronological)
      if (b.tags.includes(tag)) return true;
    }
    return false;
  }

  // pick a moment id from a pool by tag preference — a helper the future
  // director hands a candidate list to. `pool` = [{ id, tags }].
  chooseBeatByTags(pool, allowedTags = [], blockedTags = []) {
    const cands = pool.filter((p) => {
      if (blockedTags.length && p.tags.some((t) => blockedTags.includes(t))) return false;
      if (allowedTags.length && !p.tags.some((t) => allowedTags.includes(t))) return false;
      return true;
    });
    if (!cands.length) return null;
    // prefer ones matching the current tone, lightly
    const tone = this.getCurrentStoryTone();
    let best = cands[0];
    let bestScore = -1;
    for (const c of cands) {
      const score = c.tags.includes(tone) ? 1 : 0;
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best.id;
  }

  // the dominant emotional tag right now — a coarse "tone" the director reads
  getCurrentStoryTone() {
    const levels = [
      ["mystery", this.wonderLevel],
      ["comedy", this.comedyLevel],
      ["danger", this.dangerLevel],
      ["quiet_emotion", this.emotionLevel],
      ["music_energy", this.storyIntensity * 0.8],
    ];
    levels.sort((a, b) => b[1] - a[1]);
    return levels[0][1] > 0.35 ? levels[0][0] : "ambient";
  }

  suppressMinorEventsFor(seconds) {
    this._minorSuppressedUntil = Math.max(this._minorSuppressedUntil, (this.pq.clock || 0) + seconds);
  }
  suppressMajorEventsFor(seconds) {
    this._majorSuppressedUntil = Math.max(this._majorSuppressedUntil, (this.pq.clock || 0) + seconds);
  }
  // consulted by the events manager (minor cameos) and encounter manager
  minorSuppressed() {
    return (this.pq.clock || 0) < this._minorSuppressedUntil;
  }
  majorSuppressed() {
    return (this.pq.clock || 0) < this._majorSuppressedUntil;
  }

  // ------------------------------------------------------- director rules
  #canMajorBeat() {
    const pq = this.pq;
    if (this.timeSinceLastMajorBeat < STORY_TUNING.majorBeatCooldown) return false;
    if (this.majorSuppressed()) return false;
    if (pq.adventure?.arrival?.phase === "arriving") return false; // one at a time
    if ((pq.biomeT ?? 1) < 1) return false; // not during a transition...
    // ...and not for a grace period right after one settles
    const b = this.recentBeats[this.recentBeats.length - 1];
    if (b && b.tags.includes("transition") && (pq.clock || 0) - b.t < STORY_TUNING.transitionGraceSeconds) return false;
    return true;
  }

  // ----------------------------------------------------- cinematic cards
  #canTextCard() {
    if (this.storyTextMode === "off") return false;
    if (this.card) return false; // one card at a time
    if (this.timeSinceLastTextCard < STORY_TUNING.textCardCooldown) return false;
    return true;
  }

  #showCard(text, kind) {
    if (!text) return;
    if (this.storyTextMode === "off") return;
    if (this.card) return;
    // avoid repeating a line we showed recently
    if (this._recentLines.includes(text)) return;
    this.card = { text, kind, t: 0 };
    this.timeSinceLastTextCard = 0;
    this._recentLines.push(text);
    if (this._recentLines.length > STORY_TUNING.recentLinesMax) this._recentLines.shift();
  }

  // a moment card for a beat (cinematic mode only) — rare, tag-driven
  offerMomentCard(tags) {
    if (this.storyTextMode !== "cinematic") return;
    if (!this.#canTextCard()) return;
    // pick a line from the strongest tag that has one
    for (const tag of ["arrival", "danger", "mystery", "friendship", "quiet_emotion", "destination_reveal", "heroic_payoff", "discovery", "comedy"]) {
      if (tags.includes(tag) && MOMENT_LINES[tag]) {
        const lines = MOMENT_LINES[tag];
        this.#showCard(lines[(Math.random() * lines.length) | 0], "moment");
        return;
      }
    }
  }

  // a rare poetic interlude — the director can call this very occasionally
  offerPoeticCard() {
    if (this.storyTextMode !== "cinematic") return;
    if (!this.#canTextCard()) return;
    this.#showCard(POETIC_LINES[(Math.random() * POETIC_LINES.length) | 0], "poetic");
  }

  #updateCard(dt) {
    if (!this.card) return;
    this.card.t += dt;
    const d = STORY_TUNING.cardFade;
    if (this.card.t >= d.in + d.hold + d.out) this.card = null;
  }

  cardAlpha() {
    if (!this.card) return 0;
    const d = STORY_TUNING.cardFade;
    const t = this.card.t;
    if (t < d.in) return t / d.in;
    if (t < d.in + d.hold) return 1;
    return Math.max(0, 1 - (t - d.in - d.hold) / d.out);
  }

  // drawn on the REAL (unscaled) canvas ctx so the text stays crisp — a film
  // title card, centered in the upper third, letterspaced, no box/HUD chrome
  drawCard(ctx, w, h) {
    const a = this.cardAlpha();
    if (a <= 0.01) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size = this.card.kind === "biome" ? Math.round(h * 0.055) : Math.round(h * 0.046);
    ctx.font = `600 ${size}px -apple-system, "Segoe UI", sans-serif`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = this.card.kind === "poetic" ? "3px" : "6px";
    const y = h * 0.33;
    const text = this.card.kind === "poetic" ? this.card.text : this.card.text.toUpperCase();
    ctx.fillStyle = `rgba(0,0,0,${a * 0.55})`;
    ctx.fillText(text, w / 2 + 1, y + 2);
    ctx.fillStyle = `rgba(246,242,255,${a})`;
    ctx.fillText(text, w / 2, y);
    // a thin underline flourish for biome titles only
    if (this.card.kind === "biome") {
      const lw = Math.min(w * 0.4, text.length * size * 0.62);
      ctx.fillStyle = `rgba(246,242,255,${a * 0.5})`;
      ctx.fillRect(w / 2 - lw / 2, y + size * 0.7, lw, Math.max(1, Math.round(h * 0.002)));
    }
    ctx.restore();
  }

  // -------------------------------------------- relationship hooks (v1)
  // Hero hooks map to the existing reaction system (immediate, visible).
  // Orb hooks set a short directed-behavior command the orb draw reads.
  // Some orb modes animate now; others are structured flags for later.
  #orb(mode, seconds = 1.5) {
    this.orbCmd = { mode, until: (this.pq.clock || 0) + seconds };
  }
  heroLookAtOrb() {
    this.pq.triggerReaction?.("lookup", 0.7);
  }
  heroHesitate() {
    this.pq.triggerReaction?.("stepback", 0.5);
  }
  heroLeanForward() {
    this.pq.triggerReaction?.("lean", 0.7);
  }
  heroLookUp() {
    this.pq.triggerReaction?.("lookup", 0.9);
  }
  heroCelebrateSmall() {
    this.pq.triggerReaction?.("celebrate", 0.8);
  }
  heroSitOrRest() {
    this.pq._storyRestUntil = (this.pq.clock || 0) + 2.5; // read by render/drawHero later
  }
  heroStepBack() {
    this.pq.triggerReaction?.("stepback", 0.7);
  }
  heroRunExcitedly() {
    this.pq._storyDashUntil = (this.pq.clock || 0) + 1.5; // small pace nudge flag
  }
  orbNudgeHero() {
    this.#orb("nudge", 0.8);
  }
  orbLeadForward() {
    this.#orb("lead", 2);
  }
  orbCircleExcitedly() {
    this.#orb("circle", 2);
  }
  orbDimAndRest() {
    this.#orb("rest", 3);
  }
  orbHideBehindHero() {
    this.#orb("hide", 1.5);
  }
  orbGlowProtectively() {
    this.#orb("protect", 2);
  }
  orbPointTowardDestination() {
    this.#orb("point", 2);
  }

  // ----------------------------------------------------- debug/inspection
  // a compact story-state readout drawn on the real ctx (top-left). OFF by
  // default; enabled with pq.cfg.storyDebug — never shown on the premium UI.
  drawDebug(ctx, w, h) {
    if (!this.pq.cfg?.storyDebug) return;
    ctx.save();
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const lines = [
      `beat: ${this.currentStoryBeat || "—"}`,
      `tone: ${this.getCurrentStoryTone()} · moment: ${this.currentMomentType}`,
      `intensity ${this.storyIntensity.toFixed(2)}  wonder ${this.wonderLevel.toFixed(2)}`,
      `comedy ${this.comedyLevel.toFixed(2)}  danger ${this.dangerLevel.toFixed(2)}  emotion ${this.emotionLevel.toFixed(2)}`,
      `major✔${this.allowMajorBeat ? "1" : "0"} (${Math.round(this.timeSinceLastMajorBeat)}s)  card✔${this.allowTextCard ? "1" : "0"} (${Math.round(this.timeSinceLastTextCard)}s)`,
      `text:${this.storyTextMode}${this.card ? ` "${this.card.text}"` : ""}`,
      `recent: ${this.recentBeats.slice(-3).map((b) => b.name).join(", ") || "—"}`,
    ];
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(6, 6, 300, lines.length * 14 + 8);
    ctx.fillStyle = "rgba(180,255,220,0.9)";
    lines.forEach((l, i) => ctx.fillText(l, 12, 12 + i * 14));
    ctx.restore();
  }

  status() {
    return {
      currentStoryBeat: this.currentStoryBeat,
      currentMomentType: this.currentMomentType,
      tone: this.getCurrentStoryTone(),
      storyIntensity: Math.round(this.storyIntensity * 100) / 100,
      wonderLevel: Math.round(this.wonderLevel * 100) / 100,
      comedyLevel: Math.round(this.comedyLevel * 100) / 100,
      dangerLevel: Math.round(this.dangerLevel * 100) / 100,
      emotionLevel: Math.round(this.emotionLevel * 100) / 100,
      timeSinceLastMajorBeat: Math.round(this.timeSinceLastMajorBeat),
      timeSinceLastTextCard: Math.round(this.timeSinceLastTextCard),
      allowMajorBeat: this.allowMajorBeat,
      allowTextCard: this.allowTextCard,
      storyTextMode: this.storyTextMode,
      card: this.card ? this.card.text : null,
      recentBeats: this.recentBeats.slice(-4).map((b) => b.name),
    };
  }
}
