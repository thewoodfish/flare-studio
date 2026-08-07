#!/usr/bin/env bash
# Genericity guard. See plan.md § "The genericity constraint".
#
# The engine must not know what an inheritance is. Template-specific vocabulary is
# allowed only in template definitions and user-facing copy; everywhere else the
# engine's words are `recipient`, `trigger`, `condition`, `distribution`.
#
# This checks CODE, not comments. Prose that explains the rule ("recipient, not
# beneficiary") is desirable, and Solidity's own `@inheritdoc` tag contains
# "inherit". A guard with false positives gets disabled, which defeats it.
#
# Runs in CI from day 1, while it is trivially true -- cheap to keep true, and
# expensive to make true again later.
set -uo pipefail

BANNED='inherit|beneficiar|heir|dead[ -]?man'

SCOPES=(
  packages/contracts/src
  packages/contracts/test
  packages/policy/src
  apps/extension
  apps/orchestrator/src
)

EXCLUDES=(
  ':!*templates*'
  ':!*fixtures*'
  ':!*.md'
  ':!*lib/*'
)

existing=()
for s in "${SCOPES[@]}"; do [ -e "$s" ] && existing+=("$s"); done
if [ ${#existing[@]} -eq 0 ]; then
  echo "genericity: no source dirs yet, nothing to check"
  exit 0
fi

files=$(git ls-files -- "${existing[@]}" "${EXCLUDES[@]}" 2>/dev/null)
[ -z "$files" ] && { echo "genericity: no tracked source files yet"; exit 0; }

# Strip comments, then match. Handles // line comments, /* */ block comments,
# and /// or * doc-comment continuation lines.
leaks=$(
  while IFS= read -r f; do
    awk -v file="$f" '
      { line = $0 }
      # drop full-line doc/block comments
      line ~ /^[[:space:]]*(\/\/|\/\*|\*)/ { next }
      # drop trailing line comments
      { sub(/\/\/.*$/, "", line) }
      line ~ /^[[:space:]]*$/ { next }
      { print file ":" FNR ":" line }
    ' "$f"
  done <<< "$files" | grep -iE "$BANNED"
)

if [ -n "$leaks" ]; then
  echo "GENERICITY LEAK -- template vocabulary reached engine code:"
  echo
  echo "$leaks"
  echo
  echo "The engine is asset- and template-agnostic. Use 'recipient', not 'beneficiary'."
  echo "If this is genuinely template code, it belongs under templates/."
  exit 1
fi

echo "genericity: clean ($(wc -l <<< "$files" | tr -d ' ') files checked)"
