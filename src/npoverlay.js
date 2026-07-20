// NOW PLAYING overlay — one song-information system for every visualization.
//
// A DOM layer, deliberately NOT drawn into the mode canvas: Waterfall and
// Note-Fall scroll their own bitmaps (painted overlay pixels would be dragged
// into the history), and Vector CRT / MilkDrop / Galaxy run feedback loops
// (overlay pixels would smear into the trails). A composited DOM layer is safe
// over every mode by construction.
//
// DESIGN SYSTEM (2026-07 audit). One component, four variants, shared tokens.
// The bar: quiet, precise, appliance-grade — designed with the Vizzy hardware,
// not added after it. Brand: Midnight / Cloud, with ONE accent — a 2px
// coral-to-blue rule beside the text (sound transformed into light). No cards,
// no borders, no backdrop-filter (Pi), no lyric line (karaoke lives in the
// Now Playing MODE). Legibility comes from a LOCAL feathered scrim, never
// from dimming the whole scene.
//
//   faceplate  text-led cluster: TITLE / ARTIST / time     (analyzers, pixelquest)
//   chip       compact art tile + text cluster             (wave, skyline, flames, ferrofluid)
//   label      equipment engraving: tracked mono caps      (scopes, meter faceplates)
//   lower      cinematic transient lower-third: art + text (scenes; transient: true)
//   off        never (dense instruments; the Now Playing MODE is the info)
//
// HOUSE RULE: song info biases LEFT of the display unless there's an
// articulable reason. Placement via registry `nowPlaying: { style, pos,
// transient }`; pos ∈ tl/ml/bl (+tr/br/mr for the rule's exceptions).
//
// Artwork discipline: the img is never shown until the file has actually
// loaded (offscreen preload + decode), so there is no broken-image icon and
// no old-art-with-new-title flash; until then a quiet empty tile holds the
// space so nothing reflows.

import { nowplaying } from "./nowplaying.js";

const TRANSIENT_MS = 9000;

// (NB: this stylesheet lives in a JS template literal — a backtick anywhere
// inside, even in a comment, terminates it and silently kills main.js.)
const CSS = `
#np-overlay {
  /* ---- design tokens: the whole system tunes from here ---- */
  --np-cloud: 246, 244, 241;      /* brand Cloud */
  --np-mid: 11, 13, 22;           /* brand Midnight */
  --np-coral: #ff6a5a;            /* Signal Coral — accent, used once */
  --np-blue: #6a5cfe;             /* Spectral Blue — accent, used once */
  --np-mx: clamp(20px, 4.2vh, 40px);   /* outer safe margin, x */
  --np-my: clamp(16px, 3.6vh, 32px);   /* outer safe margin, y */
  --np-gap: clamp(10px, 2.6vh, 20px);  /* art-to-text gap */
  --np-art: clamp(46px, 14vh, 78px);   /* art tile edge */
  --np-r: 5px;                          /* radius: small, machined */
  --np-title: clamp(14px, 4.6vh, 24px);
  --np-artist: clamp(10px, 2.9vh, 15px);
  --np-meta: clamp(10px, 2.7vh, 14px);
  --np-maxw: min(560px, 36vw);
  --np-dur: 420ms;
  --np-ease: cubic-bezier(0.22, 1, 0.36, 1); /* fast start, long soft landing */

  position: fixed; inset: 0; z-index: 40; pointer-events: none;
  font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
  display: none;
}
#np-overlay.np-mounted { display: block; }

/* ---- the cluster: one coordinated composition ---- */
#np-overlay .np-card {
  position: absolute; display: flex; align-items: center; gap: var(--np-gap);
  max-width: var(--np-maxw);
  opacity: 0; transform: translateY(7px);
  transition: opacity var(--np-dur) var(--np-ease),
              transform var(--np-dur) var(--np-ease);
}
#np-overlay.np-visible .np-card { opacity: 1; transform: translateY(0); }

/* local legibility scrim: an oversized feathered pool of Midnight behind the
   cluster — a shadow on the scene, not a card on the screen. No blur (Pi). */
#np-overlay .np-card::before {
  content: ""; position: absolute; z-index: -1;
  inset: -34% -22% -34% -14%;
  background: radial-gradient(ellipse 62% 58% at 38% 50%,
    rgba(var(--np-mid), 0.52), rgba(var(--np-mid), 0.30) 55%, transparent 78%);
}

/* the one brand accent: a 2px rule, coral falling into blue */
#np-overlay .np-rule {
  flex: none; width: 2px; align-self: stretch; border-radius: 1px;
  background: linear-gradient(to bottom, var(--np-coral), var(--np-blue));
  opacity: 0.85;
}

/* artwork tile: hidden img over a quiet reserved surface — the surface IS the
   loading and missing-art state, so nothing jumps and nothing breaks */
#np-overlay .np-artbox {
  position: relative; flex: none;
  width: var(--np-art); height: var(--np-art);
  border-radius: var(--np-r); overflow: hidden;
  background: rgba(var(--np-cloud), 0.05);
  box-shadow: 0 0 0 1px rgba(var(--np-cloud), 0.08) inset,
              0 6px 18px rgba(0, 0, 0, 0.45);
}
#np-overlay .np-art {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; display: block;
  opacity: 0; transform: scale(1.02);
  transition: opacity 360ms var(--np-ease), transform 480ms var(--np-ease);
}
#np-overlay .np-artbox.np-art-ready .np-art { opacity: 1; transform: scale(1); }

#np-overlay .np-text { min-width: 0; }
#np-overlay .np-title {
  color: rgba(var(--np-cloud), 0.96);
  font-size: var(--np-title); font-weight: 600; letter-spacing: 0.005em;
  line-height: 1.22; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(var(--np-mid), 0.8);
}
#np-overlay .np-artist {
  color: rgba(var(--np-cloud), 0.62);
  font-size: var(--np-artist); font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.16em;
  margin-top: 0.45em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(var(--np-mid), 0.8);
}
#np-overlay .np-meta {
  color: rgba(var(--np-cloud), 0.4);
  font-size: var(--np-meta); font-weight: 500;
  letter-spacing: 0.06em; font-variant-numeric: tabular-nums;
  margin-top: 0.6em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(var(--np-mid), 0.8);
}
#np-overlay .np-meta:empty { display: none; }

/* track change while visible: the text dips out, swaps, returns (JS drives) */
#np-overlay .np-text > div {
  transition: opacity 180ms ease-out, transform 180ms ease-out;
}
#np-overlay.np-swap .np-text > div { opacity: 0; transform: translateY(-4px); }

/* ---- positions (pos: tl / ml / bl and the mirrored exceptions) ---- */
#np-overlay.np-pos-tl .np-card { top: var(--np-my); left: var(--np-mx); }
#np-overlay.np-pos-ml .np-card,
#np-overlay.np-pos-df .np-card { top: 50%; left: var(--np-mx); transform: translateY(calc(-50% + 7px)); }
#np-overlay.np-pos-ml.np-visible .np-card,
#np-overlay.np-pos-df.np-visible .np-card { transform: translateY(-50%); }
#np-overlay.np-pos-bl .np-card { bottom: var(--np-my); left: var(--np-mx); }
#np-overlay.np-pos-tr .np-card { top: var(--np-my); right: var(--np-mx); }
#np-overlay.np-pos-mr .np-card { top: 50%; right: var(--np-mx); transform: translateY(calc(-50% + 7px)); }
#np-overlay.np-pos-mr.np-visible .np-card { transform: translateY(-50%); }
#np-overlay.np-pos-br .np-card { bottom: var(--np-my); right: var(--np-mx); }

/* ---- variant: faceplate — text-led, no artwork ---- */
#np-overlay.np-style-faceplate .np-artbox { display: none; }

/* ---- variant: chip — compact tile + text ---- */
#np-overlay.np-style-chip {
  --np-title: clamp(13px, 4vh, 21px);
  --np-artist: clamp(9px, 2.6vh, 13px);
}

/* ---- variant: label — engraved equipment lettering ---- */
#np-overlay.np-style-label .np-artbox { display: none; }
#np-overlay.np-style-label .np-card::before { display: none; } /* the faceplate is already dark */
#np-overlay.np-style-label .np-rule { opacity: 0.55; }
#np-overlay.np-style-label .np-title,
#np-overlay.np-style-label .np-artist,
#np-overlay.np-style-label .np-meta {
  font-family: ui-monospace, Menlo, monospace; text-shadow: none;
}
#np-overlay.np-style-label .np-title {
  font-size: clamp(11px, 3vh, 15px); font-weight: 500;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: rgba(var(--np-cloud), 0.78);
}
#np-overlay.np-style-label .np-artist {
  font-size: clamp(9px, 2.5vh, 13px); font-weight: 400;
  letter-spacing: 0.14em; color: rgba(var(--np-cloud), 0.48);
}
#np-overlay.np-style-label .np-meta { font-size: clamp(9px, 2.4vh, 12px); }

/* ---- variant: lower — the cinematic credit (transient modes). Position
   comes from the pos system (defaults to bl in JS) so the placement rules
   never fight. ---- */
#np-overlay.np-style-lower .np-card {
  --np-art: clamp(56px, 17vh, 92px);
  --np-title: clamp(16px, 5.4vh, 28px);
  --np-maxw: min(720px, 46vw);
}
#np-overlay.np-style-lower .np-title { white-space: normal; max-height: 2.5em; }
/* the credit's scrim rises from the display's own bottom edge instead of
   pooling behind the cluster — classic film-title treatment */
#np-overlay.np-style-lower .np-card::before { display: none; }
#np-overlay.np-style-lower .np-shade {
  position: absolute; left: 0; right: 0; bottom: 0; height: 34vh;
  background: linear-gradient(to top, rgba(var(--np-mid), 0.6), rgba(var(--np-mid), 0.22) 55%, transparent);
  opacity: 0; transition: opacity var(--np-dur) var(--np-ease);
}
#np-overlay.np-style-lower.np-visible .np-shade { opacity: 1; }
#np-overlay .np-shade { display: none; }
#np-overlay.np-style-lower .np-shade { display: block; }

@media (prefers-reduced-motion: reduce) {
  #np-overlay .np-card, #np-overlay .np-art, #np-overlay .np-text > div, #np-overlay .np-shade {
    transition-property: opacity; transition-duration: 200ms;
  }
  #np-overlay .np-card { transform: none !important; }
}
`;

export function installNpOverlay(controller) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "np-overlay";
  root.className = "np-mounted";
  root.innerHTML = `
    <div class="np-shade"></div>
    <div class="np-card">
      <div class="np-artbox"><img class="np-art" alt="" /></div>
      <div class="np-rule"></div>
      <div class="np-text">
        <div class="np-title"></div>
        <div class="np-artist"></div>
        <div class="np-meta"></div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const artBox = root.querySelector(".np-artbox");
  const artEl = root.querySelector(".np-art");
  const titleEl = root.querySelector(".np-title");
  const artistEl = root.querySelector(".np-artist");
  const metaEl = root.querySelector(".np-meta");

  let transientUntil = 0;
  let lastTrackKey = null;
  let artLoader = null; // the offscreen preloader for the CURRENT track's art

  function hint() {
    const entry = controller.currentEntry;
    if (!entry || entry.id === "nowplaying") return { style: "off" };
    return entry.nowPlaying || { style: "off" };
  }

  // The art contract: nothing is shown until the pixels are genuinely ready.
  // Track changes clear the tile immediately, so the previous record's cover
  // can never sit beside the new title while the new cover loads.
  function loadArt(url) {
    artBox.classList.remove("np-art-ready");
    artLoader = null;
    if (!url) return;
    const img = new Image();
    artLoader = img;
    img.onload = () => {
      if (artLoader !== img) return; // a newer track superseded this load
      artEl.src = url;
      artBox.classList.add("np-art-ready");
    };
    img.onerror = () => {}; // the empty tile IS the failure state
    img.src = url;
  }

  function refreshContent() {
    const m = nowplaying.match;
    if (!m) return;
    titleEl.textContent = m.title || "";
    artistEl.textContent = m.artist || "";
    loadArt(nowplaying.artwork?.url || "");
  }

  function refreshMeta() {
    const p = nowplaying.positionSec?.();
    const time =
      typeof p === "number" && isFinite(p) && p >= 0
        ? `${(p / 60) | 0}:${String(Math.floor(p % 60)).padStart(2, "0")}`
        : "";
    // album joins only in the roomy cinematic credit, and only when real
    const album = hint().style === "lower" ? nowplaying.match?.album || "" : "";
    metaEl.textContent = time && album ? `${time}  ·  ${album}` : time || album;
  }

  function update() {
    const cfg = hint();
    const matched = nowplaying.status === "matched" && nowplaying.match;
    let visible = controller.npOverlay && cfg.style !== "off" && !!matched;
    if (visible && cfg.transient) visible = performance.now() < transientUntil;

    const keepSwap = root.classList.contains("np-swap") ? " np-swap" : "";
    const pos = cfg.pos || (cfg.style === "lower" ? "bl" : "df");
    root.className = `np-mounted np-style-${cfg.style} np-pos-${pos}${visible ? " np-visible" : ""}${keepSwap}`;
    if (visible) {
      refreshContent();
      refreshMeta();
    }
  }

  function openTransientWindow() {
    transientUntil = performance.now() + TRANSIENT_MS;
    update();
    setTimeout(update, TRANSIENT_MS + 50); // the fade-out edge
  }

  // a track change while visible dips the text out, swaps it, brings it back
  function swapTo() {
    if (!root.classList.contains("np-visible")) { update(); return; }
    root.classList.add("np-swap");
    setTimeout(() => {
      update();
      root.classList.remove("np-swap");
    }, 190);
  }

  nowplaying.onChange((what) => {
    const key = nowplaying.match?.providerTrackId ?? null;
    if (what === "track" || key !== lastTrackKey) {
      const isNew = key !== lastTrackKey;
      lastTrackKey = key;
      if (key) {
        openTransientWindow();
        if (isNew) { swapTo(); return; }
      }
    }
    update();
  });

  controller.onChange((what) => {
    if (what === "mode") {
      // arriving on a new visualization re-announces the current song
      if (nowplaying.match) openTransientWindow();
      update();
    }
    if (what === "npoverlay") {
      if (controller.npOverlay && nowplaying.match) openTransientWindow();
      update();
    }
  });

  // the meta clock only does work while the overlay is on screen
  setInterval(() => {
    if (root.classList.contains("np-visible")) refreshMeta();
  }, 500);

  update();
  return { update, visible: () => root.classList.contains("np-visible") };
}
