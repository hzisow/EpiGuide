"""Train the skin classifier and export it as a TensorFlow.js graph model.

MobileNetV2, transfer-learned, 224x224, binary: urticaria vs everything else.

WHY TENSORFLOW HERE AND NOT FOR THE SYMPTOM MODEL
    This is 2.3 million parameters and a real convolutional network, so it needs
    a real framework. The symptom model in ../src is 23 numbers and runs as
    arithmetic; putting Keras behind it would add a 900KB runtime to evaluate a
    dot product. Right tool, right place.

WHAT THIS TRAINS, AND WHAT IT DOES NOT
    It trains "urticaria vs other skin condition", because that is the question
    SCIN can actually answer. It does NOT train "visible skin reaction vs normal
    skin", which is the question the app really wants, because SCIN contains no
    normal-skin class. The 59 cases graded as showing no discernible pathology
    are photographs people submitted BECAUSE they were worried, and 59 is far
    too few to train on regardless.

    That gap is the honest reason the shipped three-class model cannot be fully
    reproduced from SCIN: its `normal_skin` class had to come from somewhere
    else, and no record of where survives. Sourcing a real normal-skin set is
    the outstanding work. See README.md.

EVALUATION
    Split by CASE, never by image: 2,289 SCIN cases contribute three photographs
    of the same lesion. Splitting by image puts near-duplicate views on both
    sides of the boundary and inflates every number you report.

    Reported as average precision (PR-AUC), not accuracy. The positive class is
    roughly 8% of the data, so a model that predicts "not urticaria" for
    everything scores 92% accuracy while being worthless.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
import tensorflow as tf
from sklearn.metrics import (average_precision_score, roc_auc_score,
                             precision_recall_curve, confusion_matrix)
from sklearn.model_selection import GroupShuffleSplit

IMG_SIZE = 224
AUTOTUNE = tf.data.AUTOTUNE


def load_manifest(path: Path) -> list[dict]:
    rows = json.loads(path.read_text())
    missing = [r for r in rows if not Path(r["local"]).exists()]
    if missing:
        print(f"warning: {len(missing)} manifest rows have no local file; skipping them")
        rows = [r for r in rows if Path(r["local"]).exists()]
    return rows


def case_level_split(rows: list[dict], val_frac: float, test_frac: float, seed: int):
    """Three-way split with no case appearing in more than one part."""
    groups = np.array([r["case_id"] for r in rows])
    y = np.array([r["label"] for r in rows])
    idx = np.arange(len(rows))

    gss = GroupShuffleSplit(n_splits=1, test_size=test_frac, random_state=seed)
    rest_i, test_i = next(gss.split(idx, y, groups))

    rel = val_frac / (1.0 - test_frac)
    gss2 = GroupShuffleSplit(n_splits=1, test_size=rel, random_state=seed)
    tr_rel, va_rel = next(gss2.split(rest_i, y[rest_i], groups[rest_i]))
    train_i, val_i = rest_i[tr_rel], rest_i[va_rel]

    for name, part in (("train", train_i), ("val", val_i), ("test", test_i)):
        print(f"  {name:5s} {len(part):5d} images, {len(set(groups[part])):5d} cases, "
              f"{y[part].mean():.1%} urticaria")

    overlap = (set(groups[train_i]) & set(groups[test_i])) | (set(groups[val_i]) & set(groups[test_i]))
    assert not overlap, f"case leaked across splits: {list(overlap)[:5]}"
    return train_i, val_i, test_i


def make_ds(rows, indices, batch: int, training: bool) -> tf.data.Dataset:
    paths = [rows[i]["local"] for i in indices]
    labels = [rows[i]["label"] for i in indices]

    def decode(path, label):
        img = tf.io.decode_png(tf.io.read_file(path), channels=3)
        img = tf.image.resize(img, [IMG_SIZE, IMG_SIZE])
        img = tf.cast(img, tf.float32) / 127.5 - 1.0   # MobileNetV2 expects [-1, 1]
        return img, label

    ds = tf.data.Dataset.from_tensor_slices((paths, labels))
    if training:
        ds = ds.shuffle(len(paths), seed=0, reshuffle_each_iteration=True)
    ds = ds.map(decode, num_parallel_calls=AUTOTUNE)
    if training:
        # Conservative augmentation. These are consumer phone photos at varying
        # distance and lighting, so flips and modest brightness/contrast jitter
        # match the real variation. No rotation beyond flips: lesion orientation
        # carries no information but heavy warping degrades fine texture, which
        # is exactly what distinguishes weals from other rashes.
        ds = ds.map(lambda x, y: (tf.image.random_flip_left_right(x), y), num_parallel_calls=AUTOTUNE)
        ds = ds.map(lambda x, y: (tf.image.random_flip_up_down(x), y), num_parallel_calls=AUTOTUNE)
        ds = ds.map(lambda x, y: (tf.image.random_brightness(x, 0.15), y), num_parallel_calls=AUTOTUNE)
        ds = ds.map(lambda x, y: (tf.image.random_contrast(x, 0.85, 1.15), y), num_parallel_calls=AUTOTUNE)
        ds = ds.map(lambda x, y: (tf.clip_by_value(x, -1.0, 1.0), y), num_parallel_calls=AUTOTUNE)
    return ds.batch(batch).prefetch(AUTOTUNE)


def build_model(dropout: float = 0.3) -> tf.keras.Model:
    base = tf.keras.applications.MobileNetV2(
        input_shape=(IMG_SIZE, IMG_SIZE, 3), include_top=False, weights="imagenet"
    )
    base.trainable = False
    inp = tf.keras.Input(shape=(IMG_SIZE, IMG_SIZE, 3))
    x = base(inp, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(dropout)(x)
    out = tf.keras.layers.Dense(1, activation="sigmoid", name="urticaria")(x)
    return tf.keras.Model(inp, out), base


def evaluate(model, ds, name: str) -> dict:
    y_true = np.concatenate([y.numpy() for _, y in ds])
    y_prob = model.predict(ds, verbose=0).ravel()

    ap = float(average_precision_score(y_true, y_prob))
    auc = float(roc_auc_score(y_true, y_prob))
    prec, rec, thr = precision_recall_curve(y_true, y_prob)

    # The app's cue only ever ADDS evidence, so precision is what matters and
    # recall is cheap: the symptom checklist covers whatever the camera misses.
    # Report the threshold that first reaches 95% precision.
    target = None
    for p, r, t in zip(prec[:-1], rec[:-1], thr):
        if p >= 0.95:
            target = {"threshold": float(t), "precision": float(p), "recall": float(r)}
            break

    at_half = (y_prob >= 0.5).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, at_half, labels=[0, 1]).ravel()

    print(f"\n{name}: n={len(y_true)}, {y_true.mean():.1%} positive")
    print(f"  average precision (PR-AUC) {ap:.4f}   ROC-AUC {auc:.4f}")
    print(f"  at 0.5: tp={tp} fp={fp} fn={fn} tn={tn}")
    if target:
        print(f"  first threshold reaching 95% precision: {target['threshold']:.3f} "
              f"(precision {target['precision']:.3f}, recall {target['recall']:.3f})")
    else:
        print("  no threshold reaches 95% precision on this split")

    return {
        "n": int(len(y_true)), "positive_rate": float(y_true.mean()),
        "average_precision": round(ap, 4), "roc_auc": round(auc, 4),
        "confusion_at_0.5": {"tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn)},
        "high_precision_operating_point": target,
    }


def main() -> None:
    ap_ = argparse.ArgumentParser(description=__doc__)
    ap_.add_argument("--manifest", type=Path, default=Path("data/manifest.json"))
    ap_.add_argument("--out", type=Path, default=Path("out"))
    ap_.add_argument("--epochs", type=int, default=12)
    ap_.add_argument("--finetune-epochs", type=int, default=6)
    ap_.add_argument("--batch", type=int, default=32)
    ap_.add_argument("--seed", type=int, default=20240816)
    args = ap_.parse_args()

    tf.keras.utils.set_random_seed(args.seed)
    args.out.mkdir(parents=True, exist_ok=True)

    rows = load_manifest(args.manifest)
    print(f"{len(rows)} images from {len({r['case_id'] for r in rows})} cases")
    print("case-level split:")
    tr, va, te = case_level_split(rows, val_frac=0.15, test_frac=0.15, seed=args.seed)

    ds_tr = make_ds(rows, tr, args.batch, training=True)
    ds_va = make_ds(rows, va, args.batch, training=False)
    ds_te = make_ds(rows, te, args.batch, training=False)

    # Class weighting rather than resampling: the positive class is ~8%, and
    # resampling duplicates the same lesions many times, which the frozen
    # backbone memorises quickly.
    y_tr = np.array([rows[i]["label"] for i in tr])
    pos = max(int(y_tr.sum()), 1)
    class_weight = {0: 1.0, 1: float(len(y_tr) - pos) / pos}
    print(f"class weight for positives: {class_weight[1]:.2f}")

    model, base = build_model()
    model.compile(optimizer=tf.keras.optimizers.Adam(1e-3),
                  loss="binary_crossentropy",
                  metrics=[tf.keras.metrics.AUC(curve="PR", name="pr_auc")])

    cb = [
        tf.keras.callbacks.EarlyStopping(monitor="val_pr_auc", mode="max",
                                         patience=4, restore_best_weights=True),
        tf.keras.callbacks.ReduceLROnPlateau(monitor="val_pr_auc", mode="max",
                                             factor=0.3, patience=2),
    ]

    print("\nstage 1: frozen backbone, training the head")
    model.fit(ds_tr, validation_data=ds_va, epochs=args.epochs,
              class_weight=class_weight, callbacks=cb, verbose=2)

    if args.finetune_epochs > 0:
        print("\nstage 2: unfreezing the top of the backbone")
        base.trainable = True
        for layer in base.layers[:-30]:
            layer.trainable = False
        # Low learning rate: at 1e-3 the pretrained features are destroyed in
        # the first few steps by gradients from a randomly initialised head.
        model.compile(optimizer=tf.keras.optimizers.Adam(1e-5),
                      loss="binary_crossentropy",
                      metrics=[tf.keras.metrics.AUC(curve="PR", name="pr_auc")])
        model.fit(ds_tr, validation_data=ds_va, epochs=args.finetune_epochs,
                  class_weight=class_weight, callbacks=cb, verbose=2)

    metrics = {
        "val": evaluate(model, ds_va, "validation"),
        "test": evaluate(model, ds_te, "TEST (touched once)"),
        "seed": args.seed,
        "git_rev": _git_rev(),
        "_note": (
            "Task is urticaria vs other skin condition on SCIN. This is NOT the "
            "reaction-vs-normal-skin question the app asks; SCIN has no normal "
            "skin class. See README.md."
        ),
    }
    (args.out / "metrics.json").write_text(json.dumps(metrics, indent=2))

    saved = args.out / "saved_model"
    model.export(str(saved))
    print(f"\nsaved model to {saved}")
    print("convert for the app with:")
    print(f"  tensorflowjs_converter --input_format=tf_saved_model \\\n"
          f"    --output_format=tfjs_graph_model {saved} ../../js/vision-model")


def _git_rev() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                       stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        return "unknown"


if __name__ == "__main__":
    main()
