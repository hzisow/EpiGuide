// Loads the trained skin-reaction classifier (TensorFlow.js graph model) and
// scores a cropped skin region from the live camera.
//
// The model is MobileNetV2 transfer-learned on ~6,987 images from the SCIN
// dermatology registry (CC BY 4.0). Its dependable axis is "visible skin
// reaction vs normal skin" — 0.99 precision/recall on 1,389 held-out images.
// The finer hives-vs-other-rash split is NOT reliable (urticaria looks like
// other rashes, and SCIN is ~10:1 imbalanced toward other conditions), so it is
// surfaced only in the debug panel and never used to drive a verdict.
//
// Loads lazily and degrades gracefully: if TF.js or the weights can't load
// (offline first run, blocked CDN), callers fall back to landmark-only cues.

const TFJS_CDN = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js';
const MODEL_URL = new URL('./vision-model/model.json', import.meta.url).href;

let model = null;
let loadPromise = null;

function loadScript(src, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing && existing.dataset.loaded === 'true') return resolve();
    const s = existing || document.createElement('script');
    const timer = setTimeout(() => reject(new Error('tfjs script timeout')), timeout);
    s.onload = () => { clearTimeout(timer); s.dataset.loaded = 'true'; resolve(); };
    s.onerror = () => { clearTimeout(timer); reject(new Error('tfjs script error')); };
    if (!existing) { s.src = src; s.crossOrigin = 'anonymous'; document.head.appendChild(s); }
  });
}

/** Idempotently load TF.js + the graph model. Resolves to true if ready. */
export function ensureHivesModel() {
  if (model) return Promise.resolve(true);
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    await loadScript(TFJS_CDN);
    const tf = window.tf;
    if (!tf) throw new Error('tf global missing');
    model = await tf.loadGraphModel(MODEL_URL);
    // Warm the backend up with one throwaway inference so the first real frame
    // isn't slow (shader compile / kernel init).
    tf.tidy(() => model.predict(tf.zeros([1, 224, 224, 3])));
    return true;
  })().catch((err) => { loadPromise = null; throw err; });
  return loadPromise;
}

export const HIVES_CLASSES = ['hives', 'other_condition', 'normal_skin'];

/**
 * Classify a source (video/canvas/image) region as skin-reaction vs normal.
 * @returns {{ reaction:number, probs:number[], top:string, topProb:number }}
 *          reaction = 1 - P(normal_skin), the dependable signal.
 */
export function classifySkin(source) {
  const tf = window.tf;
  if (!tf || !model) return null;
  const probs = tf.tidy(() => {
    let x = tf.browser.fromPixels(source).toFloat();
    x = tf.image.resizeBilinear(x, [224, 224]);
    x = x.div(127.5).sub(1).expandDims(0);   // MobileNetV2 preprocessing → [-1,1]
    return model.predict(x).dataSync();
  });
  const arr = Array.from(probs);
  let top = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[top]) top = i;
  return {
    reaction: 1 - arr[2],
    probs: arr,
    top: HIVES_CLASSES[top],
    topProb: arr[top],
  };
}
