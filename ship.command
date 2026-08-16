#!/usr/bin/env bash
# ship.command — double-click this in Finder. macOS opens .command files in
# Terminal and runs them, so shipping needs no typing beyond a commit message.
#
# Commits whatever has changed, pushes the work branch, merges straight into
# main, pushes main, then re-levels the work branch so it stops reporting as
# behind.
#
# This exists because the cloud session reaches this repo through a bridge that
# cannot delete files, and git needs to unlink .git/index.lock on every write.
# Edits arrive on disk from there; this does the git part here.

cd "$(dirname "$0")" || exit 1

WORK_BRANCH="${WORK_BRANCH:-ios-app}"

# Keep the window readable instead of letting it vanish on exit.
finish() {
  echo
  echo "----------------------------------------"
  if [ "$1" -eq 0 ]; then
    echo "Done. You can close this window."
  else
    echo "Stopped. Nothing further was pushed."
  fi
  echo "Press return to close."
  read -r _
  exit "$1"
}

set -o pipefail

# Clear a stale zero-byte lock left behind by a blocked session.
[ -f .git/index.lock ] && rm -f .git/index.lock

git config user.name "hzisow"
git config user.email "hzisow@gmail.com"

current="$(git branch --show-current)"
if [ "$current" != "$WORK_BRANCH" ]; then
  echo "You are on '$current', but this script ships '$WORK_BRANCH'."
  printf "Switch to %s and continue? [y/N] " "$WORK_BRANCH"
  read -r ans
  case "$ans" in
    [yY]*) git checkout "$WORK_BRANCH" || finish 1 ;;
    *) echo "Cancelled."; finish 1 ;;
  esac
fi

# ---------------------------------------------------------------- 1. commit
if [ -n "$(git status --porcelain)" ]; then
  echo "Changes to commit:"
  git status --short
  echo
  printf "Commit message: "
  read -r msg
  if [ -z "$msg" ]; then
    echo "No message given. Cancelled."
    finish 1
  fi
  git add -A || finish 1
  git commit -q -m "$msg" || finish 1
  echo "committed on $WORK_BRANCH"
else
  echo "nothing to commit"
fi

git push -q origin "$WORK_BRANCH" || finish 1
echo "pushed $WORK_BRANCH"

# ------------------------------------------------------- 2. straight to main
# --no-ff keeps each piece of work legible as one merge rather than smearing
# the commits into main's timeline.
git checkout -q main || finish 1
git pull -q --ff-only origin main || finish 1

if ! git merge --no-ff -m "Merge $WORK_BRANCH" "$WORK_BRANCH"; then
  echo
  echo "MERGE CONFLICT. Nothing has been pushed to main."
  echo "  Resolve the files above, then:  git commit && git push origin main"
  echo "  Or back out entirely with:      git merge --abort && git checkout $WORK_BRANCH"
  finish 1
fi

git push -q origin main || finish 1
echo "merged into main and pushed"

# ------------------------------------------- 3. re-level the work branch
git checkout -q "$WORK_BRANCH" || finish 1
git merge -q --ff-only main || finish 1
git push -q origin "$WORK_BRANCH" || finish 1
echo "$WORK_BRANCH re-levelled with main"

echo
git --no-pager log --oneline --graph -6

finish 0
