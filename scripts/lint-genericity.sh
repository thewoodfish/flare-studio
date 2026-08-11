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

# Two passes, because `heir` is the one term whose case matters.
#
# Matched case-insensitively, `heir` fires on the word "their" -- which occurs in
# ordinary prose throughout the extension scaffold. A left boundary alone does
# not save it either: the boundary that separates `getHeir` from `their` is the
# capital H, and `-i` throws that information away.
#
# So `heir` is matched case-sensitively in four forms: on a word boundary
# (`heir`, ` heir`), after an underscore (`_heir`, which \b does not treat as a
# boundary), camelCased (`getHeir`, `myHeir`), and shouting (`HEIR_ROLE`).
# "their" and "Their" match none of them -- there is no word boundary between
# the `t` and the `h`, and the capital-H forms require a capital H.
#
# Do NOT rewrite this as `(^|[^a-zA-Z])heir`. That is the obvious formulation and
# it silently matches nothing under ugrep, which some contributors have as their
# `grep`. \b behaves identically across GNU grep, BSD grep and ugrep; anchors
# inside alternation groups do not.
#
# The other three stay case-insensitive and need no boundary -- they are matched
# as prefixes so `inheritance`, `_beneficiary` and `DEADMAN` all trip.
BANNED='inherit|beneficiar|dead[ -]?man'
BANNED_HEIR='\b[Hh]eir|_[Hh]eir|[a-z]Heir|HEIR'

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
  # Scoped to the Foundry dependencies, not every path containing "lib". The
  # blanket form also skipped apps/extension/scripts/lib, which is our own code
  # and squarely in scope. (Since those deps became submodules, git ls-files no
  # longer descends into them anyway -- this is belt and braces.)
  ':!packages/contracts/lib/*'
)

existing=()
for s in "${SCOPES[@]}"; do [ -e "$s" ] && existing+=("$s"); done
if [ ${#existing[@]} -eq 0 ]; then
  echo "genericity: no source dirs yet, nothing to check"
  exit 0
fi

files=$(git ls-files -- "${existing[@]}" "${EXCLUDES[@]}" 2>/dev/null)
[ -z "$files" ] && { echo "genericity: no tracked source files yet"; exit 0; }

# Strip comments, then match. The guard checks CODE: prose that explains the rule
# ("recipient, not beneficiary") is desirable, and Solidity's @inheritdoc tag
# contains "inherit".
#
# Two comment styles, because the scopes span two families. Solidity, Go and
# TypeScript use // and /* */; the extension also brings shell, Python, YAML,
# TOML and Dockerfiles, which use #. Handling only the first family meant every
# `#` comment in apps/extension was searched as if it were code -- which is a
# false-positive generator, and false positives are what get a guard disabled.

# Deliberately a function rather than a `case` inside the substitution below:
# bash 3.2 -- still what macOS ships -- mis-parses a case pattern's `)` as the
# end of a `$( )`. That would have passed CI on bash 5 and failed only on the
# machines this is actually run from.
comment_style() {
  case "$1" in
    *.sh|*.bash|*.py|*.yaml|*.yml|*.toml|*.env|*.mk|*Dockerfile*|*Makefile*) echo hash ;;
    *) echo cstyle ;;
  esac
}

stripped=$(
  while IFS= read -r f; do
    style=$(comment_style "$f")

    awk -v file="$f" -v style="$style" '
      { line = $0 }

      style == "cstyle" {
        # full-line doc/block comments
        if (line ~ /^[[:space:]]*(\/\/|\/\*|\*)/) next
        # trailing line comments
        sub(/\/\/.*$/, "", line)
      }

      style == "hash" {
        # full-line comments, including the #! shebang
        if (line ~ /^[[:space:]]*#/) next
        # trailing comments, only when preceded by whitespace -- so a URL
        # fragment or a shell ${#var} is not mistaken for a comment
        sub(/[[:space:]]#.*$/, "", line)
      }

      line ~ /^[[:space:]]*$/ { next }
      { print file ":" FNR ":" line }
    ' "$f"
  done <<< "$files"
)

leaks=$(
  {
    grep -iE "$BANNED" <<< "$stripped"
    grep -E "$BANNED_HEIR" <<< "$stripped"
  } | sort -u
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
