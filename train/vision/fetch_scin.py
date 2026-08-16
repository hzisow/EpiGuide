"""Download the SCIN dataset and build a case-level manifest.

SCIN (Skin Condition Image Network), Google Research.
  https://github.com/google-research-datasets/scin
  Ward A, et al. JAMA Netw Open 2024;7(11):e2446615

LICENCE, and this matters because the app previously stated it wrong:
SCIN is NOT CC BY 4.0. It is released under a custom "SCIN Data Use License"
which is CC-BY-derived but adds a clause forbidding any attempt to re-identify
subjects. Read it before redistributing anything derived from these images:
  https://github.com/google-research-datasets/scin/blob/main/LICENSE

The bucket is public and readable with no credentials and no billing project.

FIVE THINGS THAT SILENTLY BREAK NAIVE LOADERS, all handled below:

 1. The label column is `dermatologist_skin_condition_on_label_name`. The
    official dataset_schema.md documents it without the `_on_` and is wrong.
 2. Unlabelled cases carry the literal two-character string `{}`, not NaN.
    `dropna()` will not remove them and you will train on 1,972 empty labels.
 3. The label columns are Python literals with single quotes. `json.loads`
    fails on them; use `ast.literal_eval`.
 4. `case_id` is a signed int64-like string. Without `dtype={'case_id': str}`
    pandas coerces it and the join silently loses rows.
 5. One referenced image is genuinely absent from the bucket
    (`dataset/images/-2243186711511406658.png`), and 15 paths are duplicated
    across cases. Both are handled rather than allowed to crash mid-epoch.
"""

from __future__ import annotations

import argparse
import ast
import concurrent.futures as cf
import json
from pathlib import Path

import pandas as pd
import requests

BUCKET = "https://storage.googleapis.com/dx-scin-public-data"
CASES_CSV = f"{BUCKET}/dataset/scin_cases.csv"
LABELS_CSV = f"{BUCKET}/dataset/scin_labels.csv"

# Exact strings. Substring matching on "rticaria" would wrongly capture
# 'Urticarial vasculitis' and 'Pruritic urticarial papules and plaques of
# pregnancy', which are different conditions.
URTICARIA = "Urticaria"

NO_PATHOLOGY = "YES_IMAGE_QUALITY_SUFFICIENT_NO_DISCERNIBLE_PATHOLOGY"
GRADABLE_1 = "dermatologist_gradable_for_skin_condition_1"
WEIGHTED = "weighted_skin_condition_label"


def load_metadata(cache: Path) -> pd.DataFrame:
    cache.mkdir(parents=True, exist_ok=True)
    for url, name in ((CASES_CSV, "scin_cases.csv"), (LABELS_CSV, "scin_labels.csv")):
        dst = cache / name
        if not dst.exists():
            print(f"downloading {name}")
            dst.write_bytes(requests.get(url, timeout=120).content)

    cases = pd.read_csv(cache / "scin_cases.csv", dtype={"case_id": str})
    labels = pd.read_csv(cache / "scin_labels.csv", dtype={"case_id": str})
    df = cases.merge(labels, on="case_id", validate="one_to_one")

    weights = df[WEIGHTED].apply(ast.literal_eval)
    df["weighted"] = weights
    df["n_conditions"] = weights.map(len)
    df["labelled"] = df["n_conditions"] > 0

    labelled = df[df["labelled"]].copy()
    labelled["top_condition"] = labelled["weighted"].apply(lambda d: max(d, key=d.get))
    labelled["top_weight"] = labelled["weighted"].apply(lambda d: max(d.values()))
    labelled["urticaria_weight"] = labelled["weighted"].apply(lambda d: d.get(URTICARIA, 0.0))

    print(f"{len(df)} cases, {int(df['labelled'].sum())} with a non-empty differential")
    print(f"median top-condition weight {labelled['top_weight'].median():.2f}; "
          f"{(labelled['top_weight'] == 1.0).mean():.1%} unanimous")
    return df, labelled


def build_manifest(df: pd.DataFrame, labelled: pd.DataFrame, min_weight: float) -> list[dict]:
    """One row per image, tagged with its case so splits stay case-level.

    Splitting by image would leak: 2,289 cases contribute three photographs of
    the same lesion and 3,085 contribute two. Near-duplicate views either side
    of the split boundary inflate every metric you then report.
    """
    rows = []
    for _, r in labelled.iterrows():
        if r["top_weight"] < min_weight:
            continue
        is_urticaria = r["top_condition"] == URTICARIA
        # Exclude cases where urticaria appears in the differential but is not
        # the top call. They are neither clean positives nor clean negatives.
        if not is_urticaria and r["urticaria_weight"] > 0:
            continue
        for col in ("image_1_path", "image_2_path", "image_3_path"):
            path = r.get(col)
            if isinstance(path, str) and path.strip():
                rows.append({
                    "case_id": r["case_id"],
                    "path": path,
                    "label": int(is_urticaria),
                    "top_condition": r["top_condition"],
                    "top_weight": float(r["top_weight"]),
                })

    # The no-pathology cases: the closest thing SCIN has to normal skin, and the
    # only negative control available for the "is there a visible reaction"
    # question the app actually asks. There are only 59, which is why that
    # question cannot be properly trained from SCIN alone.
    raw_np = df[df[GRADABLE_1] == NO_PATHOLOGY]
    for _, r in raw_np.iterrows():
        path = r.get("image_1_path")
        if isinstance(path, str) and path.strip():
            rows.append({
                "case_id": r["case_id"], "path": path, "label": 0,
                "top_condition": "_no_discernible_pathology", "top_weight": 1.0,
            })

    # 15 paths are referenced by more than one case. Deduplicate on path,
    # keeping the first, so the same pixels cannot land on both sides of a split.
    seen, deduped = set(), []
    for r in rows:
        if r["path"] in seen:
            continue
        seen.add(r["path"])
        deduped.append(r)

    n_pos = sum(r["label"] for r in deduped)
    print(f"manifest: {len(deduped)} images from {len({r['case_id'] for r in deduped})} cases "
          f"({n_pos} urticaria, {len(deduped) - n_pos} not) after dropping "
          f"{len(rows) - len(deduped)} duplicate paths")
    return deduped


def download_images(manifest: list[dict], out: Path, workers: int = 16) -> list[dict]:
    out.mkdir(parents=True, exist_ok=True)

    def fetch(row: dict) -> dict | None:
        dst = out / (row["path"].rsplit("/", 1)[-1])
        row["local"] = str(dst)
        if dst.exists() and dst.stat().st_size > 0:
            return row
        try:
            resp = requests.get(f"{BUCKET}/{row['path']}", timeout=120)
            # One referenced image is missing from the bucket. Skip, don't crash.
            if resp.status_code != 200:
                return None
            dst.write_bytes(resp.content)
            return row
        except Exception:
            return None

    with cf.ThreadPoolExecutor(workers) as ex:
        got = [r for r in ex.map(fetch, manifest) if r is not None]
    print(f"downloaded {len(got)} of {len(manifest)} images "
          f"({len(manifest) - len(got)} missing from the bucket or failed)")
    return got


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=Path("data"))
    ap.add_argument("--min-weight", type=float, default=0.5,
                    help="minimum dermatologist agreement on the top condition. "
                         "Median agreement is 0.55, so the default already "
                         "discards genuinely ambiguous cases.")
    ap.add_argument("--metadata-only", action="store_true",
                    help="fetch the CSVs and write the manifest without images")
    args = ap.parse_args()

    df, labelled = load_metadata(args.out / "meta")
    manifest = build_manifest(df, labelled, args.min_weight)

    if not args.metadata_only:
        manifest = download_images(manifest, args.out / "images")

    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"wrote {args.out / 'manifest.json'}")


if __name__ == "__main__":
    main()
