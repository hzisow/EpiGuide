// Audit the SHIPPED vision model against real SCIN images.
//
// js/hivesModel.js makes two specific claims about this model:
//   (a) its dependable axis is "visible skin reaction vs normal skin",
//       at 0.99 precision/recall on 1,389 held-out images
//   (b) the hives-vs-other-rash split is NOT reliable
// meta.json additionally claims val_accuracy 0.9215 over 6,987 images and
// three classes: hives / other_condition / normal_skin.
//
// This script checks those claims against images the model's own stated source
// dataset (SCIN) actually contains.
const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const path = require('path');

const MODEL = process.env.MODEL_URL || 'file://' + require('path').resolve(__dirname, '../../js/vision-model/model.json');
const CLASSES = ['hives', 'other_condition', 'normal_skin'];

(async () => {
  const model = await tf.loadGraphModel(MODEL);
  const sel = JSON.parse(fs.readFileSync(process.env.SAMPLE || 'data/audit_sample.json'));

  const rows = [];
  for (const s of sel) {
    const p = `${process.env.IMAGES || 'data/images'}/${s.case_id}.png`;
    if (!fs.existsSync(p)) continue;
    const probs = tf.tidy(() => {
      let x = tf.node.decodeImage(fs.readFileSync(p), 3).toFloat();
      x = tf.image.resizeBilinear(x, [224, 224]);
      x = x.div(127.5).sub(1).expandDims(0);
      return model.predict(x).dataSync();
    });
    const a = Array.from(probs);
    let top = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[top]) top = i;
    rows.push({ group: s.group, top: CLASSES[top], probs: a, reaction: 1 - a[2] });
  }

  const byGroup = {};
  for (const r of rows) {
    byGroup[r.group] ??= { n: 0, pred: {}, reactionSum: 0 };
    const g = byGroup[r.group];
    g.n++; g.pred[r.top] = (g.pred[r.top] || 0) + 1; g.reactionSum += r.reaction;
  }

  console.log('SHIPPED VISION MODEL, evaluated on real SCIN images\n');
  console.log('predicted class distribution per true group:');
  for (const [g, v] of Object.entries(byGroup)) {
    const dist = CLASSES.map(c => `${c}=${((v.pred[c] || 0) / v.n * 100).toFixed(0)}%`).join('  ');
    console.log(`  ${g.padEnd(14)} n=${String(v.n).padEnd(4)} ${dist}   mean P(reaction)=${(v.reactionSum / v.n).toFixed(3)}`);
  }

  // Claim (a): reaction vs normal. SCIN's only stand-in for "normal skin" is the
  // 59 cases dermatologists graded as having no discernible pathology.
  const isReaction = r => r.group !== 'no_pathology';
  for (const thr of [0.5, 0.9]) {
    const tp = rows.filter(r => isReaction(r) && r.reaction >= thr).length;
    const fn = rows.filter(r => isReaction(r) && r.reaction < thr).length;
    const fp = rows.filter(r => !isReaction(r) && r.reaction >= thr).length;
    const tn = rows.filter(r => !isReaction(r) && r.reaction < thr).length;
    console.log(`\nreaction-vs-no-pathology @ P(reaction)>=${thr}:`
      + `  recall=${(tp / (tp + fn)).toFixed(3)}  precision=${(tp / (tp + fp)).toFixed(3)}`
      + `  specificity=${(tn / (tn + fp)).toFixed(3)}  [tp=${tp} fn=${fn} fp=${fp} tn=${tn}]`);
  }

  // Claim (b): hives vs other rash, on high-confidence dermatologist labels.
  const hv = rows.filter(r => r.group === 'urticaria' || r.group === 'other');
  const tp = hv.filter(r => r.group === 'urticaria' && r.top === 'hives').length;
  const fn = hv.filter(r => r.group === 'urticaria' && r.top !== 'hives').length;
  const fp = hv.filter(r => r.group === 'other' && r.top === 'hives').length;
  const tn = hv.filter(r => r.group === 'other' && r.top !== 'hives').length;
  console.log(`\nhives-vs-other-rash (argmax):  recall=${(tp / (tp + fn)).toFixed(3)}`
    + `  precision=${(tp + fp ? tp / (tp + fp) : NaN).toFixed(3)}`
    + `  specificity=${(tn / (tn + fp)).toFixed(3)}  [tp=${tp} fn=${fn} fp=${fp} tn=${tn}]`);

  fs.writeFileSync('audit_results.json', JSON.stringify({ byGroup, rows: rows.length }, null, 2));
})();
