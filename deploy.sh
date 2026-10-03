#!/usr/bin/env bash
# One-shot deploy to GitHub Pages. Run from this directory.
set -euo pipefail
REPO="${1:-mba-command-center}"

command -v gh >/dev/null || { echo "gh is not installed. Run: brew install gh"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Not signed in. Run: gh auth login"; exit 1; }

OWNER=$(gh api user --jq .login)
echo "Signed in as $OWNER"

if gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  echo "Repo exists, pushing to it."
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$REPO.git"
  git push -u origin main
else
  gh repo create "$REPO" --public --source=. --remote=origin --push
fi

# enable Pages from main / root (ignore 409 if it is already on)
gh api -X POST "repos/$OWNER/$REPO/pages" \
  -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 || true

echo
echo "Live in a minute or two at: https://$OWNER.github.io/$REPO/"
echo "If it 404s at first, give Pages a couple of minutes to build."
