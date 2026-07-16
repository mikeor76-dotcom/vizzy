// MilkDrop bench — does the resolution governor actually govern?
//
//   const src = await (await fetch('/test/milkdrop-suite.browser.js')).text();
//   eval(src); await milkdropSuite();
//
// This exists because of a shipped bug that ran undetected for weeks: the
// governor timed `viz.render()` with performance.now() and steered on it. WebGL
// is ASYNCHRONOUS — render() queues commands and returns before the GPU does
// any work — so that number is command-submission time and nothing else. On a
// 28x internal-resolution sweep it moved 9% while real GPU cost doubled. A slow
// device therefore reported ~1ms of cost, and the governor responded by
// scaling resolution UP to maximum. It made the Pi worse, on purpose, forever.
//
// So the test is a CLOSED LOOP: frame cost is a function of the scale the
// governor chooses, exactly as on real hardware. An open-loop test (feed a
// fixed fps) only proves it reacts, not that it settles anywhere sane.
//
//   frameMs = fixedMs                  the blit/compositing — does NOT shrink
//           + pixelMs * scale^2        GPU shading — does

const SCALES = [1, 0.8, 0.65, 0.5, 0.4];

async function milkdropSuite() {
  const V = Date.now();
  const { Milkdrop } = await import(`/src/milkdrop.js?v=${V}`);
  const results = {};

  // butterchurn wires real audio nodes; it needs a real context
  const actx = new (window.AudioContext || window.webkitAudioContext)();
  const an = actx.createAnalyser();
  an.fftSize = 2048;
  const osc = actx.createOscillator();
  osc.connect(an);
  osc.start();
  const cv = document.createElement("canvas");
  cv.width = 1920; cv.height = 480;
  const ctx = cv.getContext("2d");

  const probe = new Milkdrop();
  probe.render(ctx, an, 1920, 480, 1000);
  if (probe.failed) {
    results.webgl2 = { pass: false, note: "butterchurn/WebGL2 unavailable in this browser" };
    results.pass = false;
    return results;
  }
  results.webgl2 = { pass: true };

  const settle = (fixedMs, pixelMs, secs = 24) => {
    const inst = new Milkdrop();
    let now = 1000;
    for (let i = 0; i < secs * 60; i++) {
      const sc = SCALES[inst._scaleIdx];
      now += Math.max(16.7, fixedMs + pixelMs * sc * sc); // vsync floor
      inst.render(ctx, an, 1920, 480, now);
    }
    const sc = SCALES[inst._scaleIdx];
    return {
      scale: sc,
      fps: +(1000 / Math.max(16.7, fixedMs + pixelMs * sc * sc)).toFixed(0),
      internal: `${inst.canvas.width}x${inst.canvas.height}`,
      blendSec: inst._blendSec,
    };
  };

  // --- 1. a fast device keeps full resolution
  const fast = settle(2, 12);
  results.fastDevice = {
    pass: fast.scale === 1 && fast.fps >= 58,
    ...fast,
    note: "blit 2ms + GPU 12ms: no reason to degrade anything",
  };

  // --- 2. THE REGRESSION TEST. A GPU-bound slow device must be rescued.
  // With the old submission-timing governor this settled at scale 1.0 and 18fps.
  const gpuBound = settle(2, 55);
  results.gpuBoundDevice = {
    pass: gpuBound.scale < 1 && gpuBound.fps >= 50,
    ...gpuBound,
    note: "GPU 55ms @full (18fps): the governor must trade resolution for fps",
  };

  // --- 3. a blit-bound device: the governor does everything it can, and the
  // remaining floor is NOT its fault — drawImage from a WebGL canvas costs the
  // same whatever the internal size is. This case is why status()/?mdebug=1
  // report submit and blit separately: it's the signal that the fix has to be
  // architectural (render straight to a visible canvas) rather than a knob.
  const blitBound = settle(30, 15);
  results.blitBoundDevice = {
    pass: blitBound.scale === 0.4, // bottoms out, correctly
    ...blitBound,
    note: "blit 30ms (canvas2d readback): governor bottoms out; fps floor is the blit",
  };

  // --- 4. blends are suppressed once the device is struggling (a blend renders
  // BOTH presets every frame — double cost, exactly when it can least afford it)
  const struggling = new Milkdrop();
  struggling._scaleIdx = 3;
  struggling.render(ctx, an, 1920, 480, 1000);
  struggling._load(5.7, 2000);
  const healthy = new Milkdrop();
  healthy.render(ctx, an, 1920, 480, 1000);
  healthy._scaleIdx = 0;
  healthy._load(5.7, 2000);
  results.blendGuard = {
    pass: struggling._blendSec === 0 && healthy._blendSec === 5.7,
    whenStruggling: struggling._blendSec,
    whenHealthy: healthy._blendSec,
    note: "hard-cut instead of blending when the governor has had to back off",
  };

  // --- 5. status() reports what a human on the Pi needs
  const st = probe.status();
  results.status = {
    pass: ["fps", "frameMs", "submitMs", "blitMs", "scale", "internal"].every((k) => k in st),
    keys: Object.keys(st),
  };

  results.pass = Object.values(results).every((r) => r.pass !== false);
  console.log(results);
  return results;
}
window.milkdropSuite = milkdropSuite;
