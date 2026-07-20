// NOW PLAYING overlay — song info over any visualization that wants it.
//
// A DOM layer, deliberately NOT drawn into the mode canvas: Waterfall and
// Note-Fall scroll their own bitmaps (painted overlay pixels would be dragged
// into the history), and Vector CRT / MilkDrop / Galaxy run feedback loops
// (overlay pixels would smear into the trails). A composited DOM layer is safe
// over every mode by construction.
//
// Placement is declared per mode in the registry (`nowPlaying: { style, pos,
// transient }`) per the integration analysis:
// HOUSE RULE (user directive): song info biases LEFT of the display unless
// there's an articulable reason — reading order, and the hi-fi reference art.
// Known good exceptions: the Now Playing MODE's own balanced composition.
//   faceplate hi-fi left column: ARTIST / TITLE / elapsed (bars/spectrum/radial)
//             — floats OVER the full-bleed visualization (user: the viz takes
//             all the space possible; the info is a pure overlay on top)
//   dock    left-side panel: art + identity + current lyric (unused)
//   chip    small corner card: art + identity            (wave/skyline/…)
//   label   text only, instrument-styled                 (scope/faceplates)
//   banner  top-left strip in unused dark sky            (flames)
//   lower   transient lower-third, movie-credit style    (cinematic scenes)
//   sides   text left margin / art right margin          (ferrofluid)
//   off     never                                        (dense instruments)
// `transient: true` shows for a few seconds on song change then fades.
// The Now Playing MODE never shows the overlay — it IS the information.

import { nowplaying } from "./nowplaying.js";

const TRANSIENT_MS = 12000;

const CSS = `
#np-overlay {
  position: fixed; inset: 0; z-index: 40; pointer-events: none;
  font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
  opacity: 0; transition: opacity 0.7s ease;
  display: none;
}
#np-overlay.np-visible { opacity: 1; }
#np-overlay.np-mounted { display: block; }
#np-overlay .np-card {
  position: absolute; display: flex; align-items: center; gap: 1.6vh;
  background: rgba(7, 8, 13, 0.72); border: 1px solid rgba(255,255,255,0.10);
  border-radius: 1.6vh; padding: 1.6vh 2.2vh; backdrop-filter: blur(6px);
  max-width: 46vw;
}
#np-overlay .np-art {
  width: 11vh; height: 11vh; border-radius: 1vh; object-fit: cover;
  background: #101018; flex: none; display: block;
}
#np-overlay .np-text { min-width: 0; }
#np-overlay .np-title {
  color: rgba(240,243,250,0.96); font-weight: 700; font-size: 4.4vh;
  line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#np-overlay .np-artist {
  color: rgba(111,214,207,0.95); font-weight: 600; font-size: 3.3vh;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#np-overlay .np-line {
  color: rgba(255,222,137,0.92); font-size: 3.1vh; margin-top: 0.7vh;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#np-overlay .np-line:empty { display: none; }
#np-overlay .np-time { display: none; } /* only faceplate shows elapsed time */

/* ---- chip: corner card, identity only */
#np-overlay.np-style-chip .np-card { max-width: 34vw; }
#np-overlay.np-style-chip .np-line { display: none; }
#np-overlay.np-pos-tl .np-card { top: 3vh; left: 3vh; }
#np-overlay.np-pos-tr .np-card { top: 3vh; right: 3vh; }
#np-overlay.np-pos-bl .np-card { bottom: 3vh; left: 3vh; }
#np-overlay.np-pos-br .np-card { bottom: 3vh; right: 3vh; }
#np-overlay.np-pos-ml .np-card { top: 50%; left: 3vh; transform: translateY(-50%); }
#np-overlay.np-pos-mr .np-card { top: 50%; right: 3vh; transform: translateY(-50%); }

/* ---- lower: transient lower-third, no boxy card — text floats on the art */
#np-overlay.np-style-lower .np-card {
  left: 4vh; bottom: 4vh; background: transparent; border: none;
  backdrop-filter: none; padding: 0; max-width: 62vw;
  text-shadow: 0 1px 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9);
}
#np-overlay.np-style-lower .np-art { width: 14vh; height: 14vh; box-shadow: 0 2px 14px rgba(0,0,0,0.6); }

/* ---- dock: left-side panel, full height (currently unused; kept for future
   modes — flipped from right to left per the house info-bias rule) */
#np-overlay.np-style-dock .np-card {
  top: 0; left: 0; bottom: 0; border-radius: 0; border-width: 0 1px 0 0;
  flex-direction: column; justify-content: center; text-align: center;
  width: 24vw; max-width: 24vw; padding: 2vh;
  background: rgba(7, 8, 13, 0.82);
}
#np-overlay.np-style-dock .np-art { width: 34vh; height: 34vh; }
#np-overlay.np-style-dock .np-title { font-size: 4vh; white-space: normal; max-height: 10.4vh; }
#np-overlay.np-style-dock .np-artist { font-size: 3vh; }

/* ---- banner: top strip in the dark sky — left-anchored (house rule) */
#np-overlay.np-style-banner .np-card {
  top: 2.4vh; left: 3vh;
  max-width: 72vw; background: rgba(7,8,13,0.55);
}
#np-overlay.np-style-banner .np-art { width: 9vh; height: 9vh; }
#np-overlay.np-style-banner .np-title { font-size: 3.8vh; display: inline; }
#np-overlay.np-style-banner .np-artist { font-size: 3.2vh; }

/* ---- label: text only, instrument annotation */
#np-overlay.np-style-label .np-card {
  background: transparent; border: none; backdrop-filter: none; padding: 0;
}
#np-overlay.np-style-label .np-art, .np-style-label .np-line { display: none; }
#np-overlay.np-style-label .np-title {
  font-family: ui-monospace, Menlo, monospace; font-weight: 500;
  font-size: 2.6vh; color: rgba(214,220,232,0.55); letter-spacing: 0.12em;
}
#np-overlay.np-style-label .np-artist {
  font-family: ui-monospace, Menlo, monospace; font-weight: 400;
  font-size: 2.3vh; color: rgba(139,148,167,0.55); letter-spacing: 0.12em;
}

/* ---- faceplate: the hi-fi appliance treatment (user's reference art) —
   a quiet left column of letterspaced caps: ARTIST above TITLE, elapsed
   time beneath. No card, no scrim, no artwork, no lyric. It floats OVER
   the full-bleed visualization (the viz takes every pixel; the info is a
   pure overlay), so the text-shadow is doubled — it is the ONLY thing
   keeping caps legible over bright animated bass bars. (NB: this comment
   lives inside a JS template literal — backticks here would terminate
   it.) */
#np-overlay.np-style-faceplate .np-card {
  left: 3.2vw; top: 50%; transform: translateY(-50%); right: auto; bottom: auto;
  background: transparent; border: none; backdrop-filter: none; padding: 0;
  max-width: 23vw;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.95), 0 0 4px rgba(0, 0, 0, 0.9),
    0 1px 2px rgba(0, 0, 0, 0.95);
}
#np-overlay.np-style-faceplate .np-art { display: none; }
#np-overlay.np-style-faceplate .np-line { display: none; }
#np-overlay.np-style-faceplate .np-text { display: flex; flex-direction: column; }
#np-overlay.np-style-faceplate .np-artist {
  order: -1; /* the reference reads ARTIST first, then title */
  font-size: 3.6vh; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.2em; color: rgba(236, 241, 248, 0.96);
}
#np-overlay.np-style-faceplate .np-title {
  font-size: 3.6vh; font-weight: 500; text-transform: uppercase;
  letter-spacing: 0.18em; color: rgba(196, 204, 216, 0.88);
  margin-top: 1.2vh; white-space: normal; line-height: 1.35; max-height: 10vh;
}
#np-overlay.np-style-faceplate .np-time {
  display: block; font-size: 3.2vh; font-weight: 500;
  letter-spacing: 0.12em; font-variant-numeric: tabular-nums;
  color: rgba(148, 157, 172, 0.85); margin-top: 2.2vh;
}
#np-overlay.np-style-faceplate .np-time:empty { display: none; }

/* ---- sides: the empty side margins of a centered visualization — TEXT in
   the left margin, art in the right (ferrofluid). House rule: song info
   biases LEFT of the display; the art is decoration and can hold the right.
   The card spans the screen as a flex row (no transform: a transformed
   ancestor would become the containing block and break fixed/absolute
   children). */
#np-overlay.np-style-sides .np-card {
  inset: 0; max-width: none; padding: 0 5vh;
  justify-content: space-between;
  background: transparent; border: none; backdrop-filter: none;
  text-shadow: 0 1px 8px rgba(0,0,0,0.9);
}
#np-overlay.np-style-sides .np-art { width: 34vh; height: 34vh; box-shadow: 0 2px 14px rgba(0,0,0,0.6); }
#np-overlay.np-style-sides .np-text { order: -1; text-align: left; max-width: 32vw; }
#np-overlay.np-style-sides .np-title { font-size: 5.2vh; }
#np-overlay.np-style-sides .np-artist { font-size: 3.8vh; }
#np-overlay.np-style-sides .np-line { font-size: 3.4vh; }
`;

export function installNpOverlay(controller) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "np-overlay";
  root.className = "np-mounted";
  root.innerHTML = `
    <div class="np-card">
      <img class="np-art" alt="" />
      <div class="np-text">
        <div class="np-title"></div>
        <div class="np-artist"></div>
        <div class="np-line"></div>
        <div class="np-time"></div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const artEl = root.querySelector(".np-art");
  const titleEl = root.querySelector(".np-title");
  const artistEl = root.querySelector(".np-artist");
  const lineEl = root.querySelector(".np-line");
  const timeEl = root.querySelector(".np-time");

  let transientUntil = 0;
  let lastTrackKey = null;

  function hint() {
    const entry = controller.currentEntry;
    if (!entry || entry.id === "nowplaying") return { style: "off" };
    return entry.nowPlaying || { style: "off" };
  }

  function refreshContent() {
    const m = nowplaying.match;
    if (!m) return;
    titleEl.textContent = m.title;
    artistEl.textContent = m.artist;
    const url = nowplaying.artwork?.url || "";
    if (artEl.getAttribute("src") !== url) {
      if (url) artEl.setAttribute("src", url);
      else artEl.removeAttribute("src");
    }
  }

  function refreshLyricLine() {
    const index = nowplaying.currentLineIndex();
    const synced = nowplaying.lyrics?.synced;
    lineEl.textContent =
      synced && index != null && index >= 0 ? synced[index].text || "♪" : "";
  }

  // elapsed track time (matchOffsetSec + wall clock since the clip) — the
  // faceplate's third line; collapses when the match carried no offset
  function refreshTime() {
    const p = nowplaying.positionSec?.();
    timeEl.textContent =
      typeof p === "number" && isFinite(p) && p >= 0
        ? `${(p / 60) | 0}:${String(Math.floor(p % 60)).padStart(2, "0")}`
        : "";
  }

  function update() {
    const cfg = hint();
    const matched = nowplaying.status === "matched" && nowplaying.match;
    let visible = controller.npOverlay && cfg.style !== "off" && !!matched;
    if (visible && cfg.transient) visible = performance.now() < transientUntil;

    root.className = `np-mounted np-style-${cfg.style} np-pos-${cfg.pos || "df"}${visible ? " np-visible" : ""}`;
    if (visible) {
      refreshContent();
      refreshLyricLine();
      refreshTime();
    }
  }

  function openTransientWindow() {
    transientUntil = performance.now() + TRANSIENT_MS;
    update();
    // schedule the fade-out edge (opacity transition handles the visual)
    setTimeout(update, TRANSIENT_MS + 50);
  }

  nowplaying.onChange((what) => {
    const key = nowplaying.match?.providerTrackId ?? null;
    if (what === "track" || key !== lastTrackKey) {
      lastTrackKey = key;
      if (key) openTransientWindow();
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

  // tickers only do work while the overlay is on screen
  setInterval(() => {
    if (!root.classList.contains("np-visible")) return;
    if (nowplaying.lyrics?.synced) refreshLyricLine();
    refreshTime();
  }, 300);

  update();
  // `visible` lets main.js drive the faceplate render inset off the overlay's
  // real state (match present + toggle on), not a guess
  return { update, visible: () => root.classList.contains("np-visible") };
}
