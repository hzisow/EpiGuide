#!/usr/bin/env bash
# Run from EpiGuide-ios/:   bash commit-scan.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -f .git/index.lock ] && rm -f .git/index.lock
git config user.name "hzisow"
git config user.email "hzisow@gmail.com"

git add js/screens/recognize.js css/screens.css commit-scan.sh
git commit -q -F - <<'MSG'
Fix the camera flip freezing the scan, and drive the scan UI from the analysis

Two problems on the Recognize screen, in the same two files.

The flip control froze everything. The old code asked for the new facing mode
while the current track was still live, and released the old track in a
`finally` that ran on the failure path too. On iOS that is the normal path
rather than an edge case: WKWebView will not hand out a second camera while the
first is open, so the request threw, `finally` stopped the only working stream,
and the app was left with running === true, a dead <video>, and a detection loop
still feeding stale pixels to MediaPipe. That is indistinguishable from a hang
because it was one.

It now releases the old track before asking, which both makes the request likely
to succeed and makes failure recoverable: the worst state is "no camera yet"
rather than "camera destroyed". If the other side is unavailable it restores the
original, and if both are gone it says so and offers the checklist instead of
sitting on a frozen frame. Also guards the detection pump on video readiness,
hides the control on single-camera devices, and adds a reentrancy guard so a
double tap cannot interleave two swaps.

Separately, the scan looked fake because two of its three moving parts were
unconnected to any measurement. A badge cycled through check names every 1.8
seconds at the same rate whether the models were working, idle, or had failed to
load, and a sweep line oscillated on a sine of the wall clock. Both moved
confidently while nothing was happening.

Replaced with state the vision loop actually produces. A status panel shows one
row per engine: whether MediaPipe returned landmarks on the last frame, and how
many cheek crops the classifier has genuinely put through the network. A model
that fails to load now says unavailable and stays on screen instead of quietly
dropping out of a rotation. Progress is traced around the detected face box as a
fraction of readyFrames over SCAN_FRAMES, the real denominator the reveal fires
on, so the ring cannot advance unless analysis advances and visibly stalls when
tracking is lost. Corner brackets now mean searching and a continuous ring means
locked on, so the frame itself reports whether a face has been found.

The panel reports progress only, never findings: no probability, no cue names,
nothing that reads as a verdict at frame 3 of 30. The disclaimer and the panel
share one bottom-anchored column, since positioning both absolutely left the gap
between them a magic number that was already 4px wrong at 390pt.
MSG

echo "committed"
git --no-pager log --oneline -1
echo
echo "Then:  npm run build && git push origin ios-app"
