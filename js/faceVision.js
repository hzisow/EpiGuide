// Honest face analysis from MediaPipe Face Mesh landmarks + pixel color.
//
// This does NOT diagnose. It measures two real, explainable visible cues and
// flags deviations, hedged in copy elsewhere:
//   • lip/face swelling  — lip height relative to eye spacing, and eyelid
//                          aperture, compared to this session's own baseline
//                          (captured from the first steady frames).
//   • flushing           — malar (cheek) red-chroma elevated vs the forehead
//                          in the SAME frame (a within-frame measure that needs
//                          no baseline and is robust to camera white-balance).
//
// All indices are standard 468-point Face Mesh vertices.

const L = {
  eyeInnerL: 133, eyeInnerR: 362,          // inner canthi → interocular scale
  lipTop: 0, lipBottom: 17,                // outer upper/lower lip → lip height
  lidUpperL: 159, lidLowerL: 145,          // left eye aperture
  lidUpperR: 386, lidLowerR: 374,          // right eye aperture
  cheekL: 205, cheekR: 425,                // malar cheeks (flush zone)
  forehead: 151, noseBridge: 168,          // reference (flush less)
};

const WARMUP_FRAMES = 12;   // frames used to learn the session baseline
const SWELL_LIP = 1.28;     // lip-height ratio ≥ 1.28× baseline → swelling cue
const SWELL_LID = 0.62;     // eye aperture ≤ 0.62× baseline → periorbital swelling
const FLUSH_DELTA = 0.028;  // cheek red-chroma minus forehead ≥ this → flushing

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function createFaceVision() {
  // Offscreen canvas for sampling video pixels at landmark coordinates.
  const buf = document.createElement('canvas');
  const bctx = buf.getContext('2d', { willReadFrequently: true });

  let baseLip = 0, baseLid = 0, warm = 0;
  const lipHist = [], lidHist = [];

  // Mean red-chroma r/(r+g+b) in a small patch around a normalized landmark.
  function redChroma(video, pt) {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    const px = Math.round(pt.x * w), py = Math.round(pt.y * h);
    const s = Math.max(6, Math.round(Math.min(w, h) * 0.03)); // patch half-size
    const x0 = Math.max(0, px - s), y0 = Math.max(0, py - s);
    const sw = Math.min(w - x0, s * 2), sh = Math.min(h - y0, s * 2);
    if (sw <= 0 || sh <= 0) return null;
    let data;
    try {
      data = bctx.getImageData(x0, y0, sw, sh).data;
    } catch (_) { return null; }
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    if (!n) return null;
    const sum = r + g + b || 1;
    return r / sum;
  }

  return {
    /**
     * Feed one frame. Returns a live reading:
     *   { ready, swelling, flushing, metrics }
     * `ready` is false during baseline warmup so callers don't act too early.
     */
    update(landmarks, video) {
      const io = dist(landmarks[L.eyeInnerL], landmarks[L.eyeInnerR]) || 1e-6;
      const lip = dist(landmarks[L.lipTop], landmarks[L.lipBottom]) / io;
      const apL = dist(landmarks[L.lidUpperL], landmarks[L.lidLowerL]) / io;
      const apR = dist(landmarks[L.lidUpperR], landmarks[L.lidLowerR]) / io;
      const lid = (apL + apR) / 2;

      // Flushing: draw the current frame once, sample cheeks vs forehead.
      let flushMetric = null;
      const w = video.videoWidth, h = video.videoHeight;
      if (w && h) {
        if (buf.width !== w) { buf.width = w; buf.height = h; }
        try { bctx.drawImage(video, 0, 0, w, h); } catch (_) {}
        const cheekL = redChroma(video, landmarks[L.cheekL]);
        const cheekR = redChroma(video, landmarks[L.cheekR]);
        const fore = redChroma(video, landmarks[L.forehead]);
        if (cheekL != null && cheekR != null && fore != null) {
          flushMetric = (cheekL + cheekR) / 2 - fore;
        }
      }

      // Baseline warmup — learn this face's normal proportions.
      if (warm < WARMUP_FRAMES) {
        lipHist.push(lip); lidHist.push(lid); warm++;
        if (warm === WARMUP_FRAMES) {
          lipHist.sort((a, b) => a - b); lidHist.sort((a, b) => a - b);
          baseLip = lipHist[lipHist.length >> 1];  // median
          baseLid = lidHist[lidHist.length >> 1];
        }
        return { ready: false, swelling: false, flushing: false,
                 metrics: { lip, lid, flushMetric } };
      }

      const swelling = lip >= baseLip * SWELL_LIP || lid <= baseLid * SWELL_LID;
      const flushing = flushMetric != null && flushMetric >= FLUSH_DELTA;
      return {
        ready: true, swelling, flushing,
        metrics: {
          lip, lid, flushMetric,
          lipRatio: baseLip ? lip / baseLip : 1,
          lidRatio: baseLid ? lid / baseLid : 1,
        },
      };
    },
    reset() { baseLip = baseLid = warm = 0; lipHist.length = 0; lidHist.length = 0; },
  };
}
