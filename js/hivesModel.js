// Loads the trained skin-reaction classifier (TensorFlow.js graph model) and
// scores a cropped skin region from the live camera.
//
// MobileNetV2, transfer-learned, 224x224 input, 3 classes
// (hives / other_condition / normal_skin).
//
// DATA AND LICENCE
//   Trained on images from the SCIN (Skin Condition Image Network) dataset.
//   SCIN is NOT CC BY 4.0 — it is released under a custom "SCIN Data Use
//   License" which additionally forbids any attempt to re-identify subjects.
//     SCIN dataset, (c) Google LLC, SCIN Data Use License, provided AS-IS.
//     https://github.com/google-research-datasets/scin
//     Ward A, et al. JAMA Netw Open 2024;7(11):e2446615.
//   SCIN labels are retrospective dermatologist differentials, not confirmed
//   clinical diagnoses, which is a ceiling on any accuracy claim made here.
//
// WHAT THE MODEL ACTUALLY DOES  (measured, see train/vision/README.md)
//   We audited these shipped weights against 359 real SCIN images. The results
//   corrected two beliefs this file used to state as fact:
//
//   1. P(hives) is a HIGH-PRECISION signal. At a 0.7 threshold it flagged 50%
//      of dermatologist-labelled urticaria and produced ZERO false positives
//      across 209 non-urticaria images (precision 1.00, specificity 1.00).
//      This file previously called that split unreliable. It is not; it is
//      conservative, which is a different thing.
//
//   2. "1 - P(normal_skin)" is NOT usable as a reaction detector. It exceeded
//      0.6 on 98.6% of all images tested, including 54 of 59 images that
//      dermatologists graded as showing no discernible pathology. As a cue it
//      is very close to a constant yes. It used to drive the camera verdict.
//      It no longer does. It is kept in the return value for the debug panel
//      only, so the failure stays visible instead of being quietly deleted.
//
//   Caveat on that second finding: SCIN contains no true normal-skin class, so
//   the negatives above are photos people submitted BECAUSE they were worried,
//   where a dermatologist then saw nothing. That is a hard negative set, not a
//   clean one. It is still the strongest check available, and a detector that
//   fires on 98.6% of everything is not carrying information either way.
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
    // The dependable signal. Callers should drive decisions off this.
    hives: arr[0],
    // Kept for the debug panel only. See the header: this is near-constant on
    // real images and must not drive a verdict.
    reaction: 1 - arr[2],
    probs: arr,
    top: HIVES_CLASSES[top],
    topProb: arr[top],
  };
}

/**
 * Operating threshold for the camera's skin cue, chosen from the audit in
 * train/vision/. At 0.7, P(hives) had precision 1.00 and specificity 1.00 on
 * 359 real SCIN images, at 0.50 recall.
 *
 * High precision is the right trade for this cue specifically. The camera only
 * ever ADDS evidence (it sets hives=1 and never clears it), so a false positive
 * propagates into the verdict while a false negative costs nothing: the symptom
 * checklist covers everything the camera misses.
 */
export const HIVES_CUE_THRESHOLD = 0.7;
