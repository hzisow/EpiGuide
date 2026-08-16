#!/usr/bin/env bash
# ship.sh — commit whatever is staged/modified, merge straight into main, push both.
#
#   bash ship.sh "Commit subject line"
#   bash ship.sh -F message.txt          # long message from a file
#   bash ship.sh                         # nothing to commit; just merge + push
#
# Exists because the cloud session reaches this repo through a bridge that
# cannot delete files, and git needs to unlink .git/index.lock on every write.
# So the edits arrive on disk from there, and this does the git part here.
set -euo pipefail
cd "$(dirname "$0")"

WORK_BRANCH="${WORK_BRANCH:-ios-app}"

# Clear a stale zero-byte lock left behind by a blocked session.
[ -f .git/index.lock ] && rm -f .git/index.lock

git config user.name "hzisow"
git config user.email "hzisow@gmail.com"

current="$(git branch --show-current)"
if [ "$current" != "$WORK_BRANCH" ]; then
  echo "! on '$current', expected '$WORK_BRANCH'. Switch first, or set WORK_BRANCH." >&2
  exit 1
fi

# 1. Commit, if there is anything to commit.
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  if [ "${1:-}" = "-F" ]; then
    git commit -q -F "$2"
  elif [ -n "${1:-}" ]; then
    git commit -q -m "$1"
  else
    echo "! uncommitted changes but no message given." >&2
    echo "  usage: bash ship.sh \"Subject line\"   (or -F message.txt)" >&2
    exit 1
  fi
  echo "committed on $WORK_BRANCH"
else
  echo "nothing to commit"
fi

git push -q origin "$WORK_BRANCH"
echo "pushed $WORK_BRANCH"

# 2. Straight into main. --no-ff keeps each piece of work legible as one merge
#    rather than smearing the commits into main's timeline.
git checkout -q main
git pull -q --ff-only origin main
if ! git merge --no-ff -m "Merge $WORK_BRANCH" "$WORK_BRANCH"; then
  echo
  echo "! merge conflict. Nothing has been pushed to main." >&2
  echo "  Resolve, then: git commit && git push origin main" >&2
  echo "  Or back out entirely with: git merge --abort && git checkout $WORK_BRANCH" >&2
  exit 1
fi
git push -q origin main
echo "merged into main and pushed"

# 3. Level the work branch so it stops reporting as behind.
git checkout -q "$WORK_BRANCH"
git merge -q --ff-only main
git push -q origin "$WORK_BRANCH"
echo "$WORK_BRANCH re-levelled with main"

echo
git --no-pager log --oneline --graph -6
