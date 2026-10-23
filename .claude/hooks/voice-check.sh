#!/bin/bash
# Reads the prose on this branch and refuses to let a session end until it has
# been read back. Two modes:
#
#   (no argument)   Stop hook. Blocks once, with what to do.
#   --guard         Compares the prose against the snapshot taken when the hook
#                   blocked, and reports anything a style edit must not change.
#   --glossary      Reports words CONTEXT.md rules out, appearing in a changed
#                   file name or heading. Read-only.
#   --list          Prints the files a Stop run would ask about, one per line.
#                   Read-only: writes neither the marker nor the snapshot.
#
# The failure it prevents: a style rewrite that changes what a sentence says.
# One swapped word once turned three measured numbers into double what was
# measured, and nothing noticed for a week.
#
# This is a Stop hook, so it is harness configuration rather than a boundary. It
# blocks the agent's own turn from ending; it does not survive a clean checkout
# and it stops nothing determined. Anything that must hold belongs in continuous
# integration.

set -uo pipefail

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0

# Not ".git/..." directly: in a linked worktree ".git" at the root is a file
# pointing at the real git directory, so neither the marker nor the snapshot
# could be written there, and every turn that touched prose blocked again.
git_dir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
marker="$git_dir/voice-checked"
snapshot="$git_dir/voice-snapshot"

# The marker holds two lines: the commit prose was last checked at, and the hash
# of that prose. The commit is what makes the file list below mean anything.
marker_commit() { [ -f "$marker" ] && sed -n '1p' "$marker"; }
marker_hash()   { [ -f "$marker" ] && sed -n '2p' "$marker"; }
write_marker()  { printf '%s\n%s\n' "$(git rev-parse HEAD 2>/dev/null)" "$1" > "$marker"; }

# What to compare against. VOICE_CHECK_BASE first, when a caller has already worked
# out the base commit and set it (this is how scripts/checks/glossary calls in from a
# clean checkout, which has no Stop-hook marker to read one from); otherwise the
# commit this hook last checked, when it is still an ancestor of HEAD; otherwise the
# merge base with main.
#
# Comparing against main alone was the original defect: git push updates the
# origin/main tracking ref, so a session that wrote prose, committed and pushed
# ended with an empty file list and met no check at all. Measured on a current
# main branch, the list was zero files.
#
# One window stays open and is written here rather than papered over: the very
# first turn in a fresh checkout has no marker, so prose written, committed and
# pushed inside that single turn is still compared against main and still slips.
# Closing it needs a check that runs from a clean checkout, not a Stop hook.
#
# The marker alone also counted files that arrived by a fast-forward of a main
# checkout or by a merge of main into a branch: the marker commit stays an ancestor,
# so every file merged since then looked like this session's prose (incident #26).
# prose_files now also requires the file to differ from the fork point with
# origin/main (branch_files). That cannot reopen the push window above: every
# project's block-direct-push.sh blocks pushing to main, and squash merges never make
# a session's commits ancestors of origin/main, so its own prose still differs.
base_commit() {
  if [ -n "${VOICE_CHECK_BASE:-}" ]; then
    printf '%s\n' "$VOICE_CHECK_BASE"
    return
  fi
  local m
  m=$(marker_commit)
  if [ -n "$m" ] && git merge-base --is-ancestor "$m" HEAD 2>/dev/null; then
    printf '%s\n' "$m"
    return
  fi
  git merge-base origin/main HEAD 2>/dev/null || git rev-parse HEAD 2>/dev/null
}

# The files this branch carries that main does not: what differs from the fork point
# with origin/main, plus untracked files. A fast-forwarded main checkout listed every
# file other sessions had merged since the last check (incident #26); requiring a file
# to be in this set as well keeps those out. Returns 1, printing nothing, when no such
# filter applies: VOICE_CHECK_BASE is set, or there is no origin/main to fork from.
branch_files() {
  [ -z "${VOICE_CHECK_BASE:-}" ] || return 1
  local fork
  fork=$(git merge-base origin/main HEAD 2>/dev/null) || return 1
  [ -n "$fork" ] || return 1
  { git diff --name-only "$fork" 2>/dev/null
    git ls-files --others --exclude-standard 2>/dev/null; } | sort -u
}

# Every Markdown file changed since that commit, plus HTML we authored. Skills are
# excluded because they mostly still carry upstream's prose, and holding all of
# that to our voice is not work we have chosen; captured specimens live outside
# docs/ so they never match.
# The voice regression set is excluded because it holds bad prose on purpose, and a
# pass that repaired its own test data would report success for ever after.
prose_files() {
  local base
  base=$(base_commit) || return
  [ -n "$base" ] || return
  local mine
  { git diff --name-only "$base" 2>/dev/null
    git ls-files --others --exclude-standard 2>/dev/null; } \
    | sort -u \
    | if mine=$(branch_files); then
        # grep -Fxf with an empty pattern file keeps nothing, which is what an
        # empty branch list means.
        grep -Fxf <(printf '%s\n' "$mine") 2>/dev/null || true
      else
        cat
      fi \
    | grep -E '\.md$|^docs/.*\.html$' \
    | grep -v '^\.claude/skills/' \
    | grep -v '^\.agents/skills/' \
    | grep -v '^\.claude/hooks/voice-regression\.md$' \
    | while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done
}

content_hash() {
  prose_files | tr '\n' '\0' | xargs -0 -r cat 2>/dev/null | sha256sum | cut -d' ' -f1
}

# The words CONTEXT.md rules out. An _Avoid_ entry comes in two shapes: a bare list
# of words that are always wrong here, and a sentence about a misuse ("using X for
# Y"), which names a word that is right elsewhere. Only the first shape can be
# checked mechanically, so entries opening with a verb are skipped.
avoid_terms() {
  [ -f CONTEXT.md ] || return 0
  awk '
    /^_Avoid_:/ { if (n) emit(); n=1; buf=substr($0, 10); next }
    n && (/^$/ || /^\*\*/ || /^\[/) { emit(); n=0; next }
    n { buf = buf " " $0 }
    END { if (n) emit() }
    function emit(   head, parts, i, t) {
      gsub(/^[ \t]+|[ \t]+$/, "", buf)
      if (tolower(buf) ~ /^(using|treating|reading|describing|expecting|saying|calling)[ ,]/) return
      head = buf; sub(/\. .*$/, "", head); sub(/\.$/, "", head)
      split(head, parts, ",")
      for (i in parts) {
        t = parts[i]
        gsub(/^[ \t"]+|[ \t".]+$/, "", t)
        if (t == "" || split(t, junk, " ") > 3) continue
        if (tolower(t) ~ /^(and|also|which|since|an older name)/) continue
        print tolower(t)
      }
    }
  ' CONTEXT.md | sort -u
}

# A document whose subject is not this project can say so, and CONTEXT.md's
# vocabulary then does not govern it. Without this, a file about software in
# general fails on ordinary software words that a project glossary rules out for
# its own reasons, and the check cannot tell which sense is meant.
# The marker must sit in the first 20 lines, so it is declared and not buried.
#
# This is advisory and stays advisory: any file can carry the line, so it stops
# noise and stops nothing determined. What it does not do is stay quiet about it.
# Every file that used the marker is named in the report, so exempting a document
# that is about this project is visible rather than silent. A path allowlist would
# make it a boundary, and would then need a human signal every time a document
# legitimately is not about the project, which is the wrong price for noise.
declares_out_of_scope() { head -20 "$1" | grep -q '^<!-- glossary-scope: none'; }

scope_declarations() {
  while IFS= read -r f; do
    declares_out_of_scope "$f" && printf '%s\n' "$f"
  done < <(prose_files)
}

# Where a ruled-out word actually lands somewhere deliberate: the name of a file, or
# a heading. Prose is not checked, because a word the glossary rules out as a name for
# one thing is usually right in its ordinary sense, and a check nobody can trust gets
# switched off.
# Exempt: a quotation (CONTEXT.md allows quoting a skill's own wording), a fenced
# block, and CONTEXT.md's own _Avoid_ lines, which have to name the words.
glossary_hits() {
  local terms; terms=$(avoid_terms)
  [ -z "$terms" ] && return 0
  while IFS= read -r f; do
    declares_out_of_scope "$f" && continue
    while IFS= read -r term; do
      [ -z "$term" ] && continue
      case "$(basename "$f" .md | tr '[:upper:]' '[:lower:]' | tr -- '-_' '  ')" in
        *"$term"*) echo "$f: the file name says \"$term\"" ;;
      esac
      awk -v term="$term" -v file="$f" '
        /^[ \t]*```/ { fence = !fence; next }
        fence { next }
        /^#/ {
          line = $0
          gsub(/"[^"]*"/, "", line)          # a quotation is exempt
          if (tolower(line) ~ ("(^|[^a-z])" term "([^a-z]|$)")) print file ":" NR ": heading says \"" term "\": " $0
        }
        /^_Avoid_:/ { next }
      ' "$f"
    done <<< "$terms"
  done < <(prose_files)
}

# What a style edit is never allowed to alter: every number, every term the
# glossary defines, every link.
tokens() {
  local terms
  terms=$(grep -oP '^\*\*\K[^*]+(?=\*\*:)' CONTEXT.md 2>/dev/null \
          | sed 's/[^a-zA-Z ]//g' | grep -v '^$' | paste -sd'|')
  # A pointer to a numbered section of the document is structure, not a measurement.
  # Replacing "as described above" with "as described in section 3" is the writing
  # rules working, and counting it as a changed number would make every document that
  # refers to its own sections fail the guard on any structural edit.
  # The word boundary is spelled (^|[^[:alnum:]_]) and put back with \1, not \b:
  # BSD sed on macOS has no \b, and with it this line silently matched nothing.
  cat "$@" 2>/dev/null \
    | sed -E 's/(^|[^[:alnum:]_])[Ss]ections?[[:space:]]+[0-9]+([[:space:]]+(to|and)[[:space:]]+[0-9]+)?/\1section-reference/g' \
    | grep -oiE "https?://[^ )\"'>]+|[0-9]+(\.[0-9]+)?%?|\b(${terms:-zzzzzz})\b" \
    | tr '[:upper:]' '[:lower:]' | sort | uniq -c | sed 's/^ *//'
}

report_scope_declarations() {
  local declared; declared=$(scope_declarations)
  [ -z "$declared" ] && return 0
  echo
  echo "These files declared themselves outside the glossary's scope, so the check"
  echo "skipped them. That is advisory: check the declaration is honest."
  printf '%s\n' "$declared" | sed 's/^/  /'
}

case "${1:-}" in
--list)
  prose_files
  exit 0
  ;;
--glossary)
  hits=$(glossary_hits)
  if [ -n "$hits" ]; then printf '%s\n' "$hits"; report_scope_declarations; exit 1; fi
  echo "No word CONTEXT.md rules out appears in a changed file name or heading."
  report_scope_declarations
  exit 0
  ;;
--guard)
  # No snapshot means there is nothing to compare against, so this run cannot tell
  # whether a style edit preserved what it had to. It says so and fails. Exiting
  # successfully here was a success-shaped answer to "I cannot tell", which is the
  # failure this whole check exists to catch.
  if [ ! -d "$snapshot" ]; then
    echo "GUARD CANNOT RUN: no snapshot to compare against." >&2
    echo "  A snapshot is taken when the Stop hook blocks. Run the hook with no" >&2
    echo "  argument first, or make a prose change, so there is a baseline." >&2
    exit 1
  fi
  status=0
  while IFS= read -r f; do
    before="$snapshot/$(echo "$f" | tr '/' '%')"
    [ -f "$before" ] || continue
    if ! diff <(tokens "$before") <(tokens "$f") >/tmp/voice-guard.$$ 2>/dev/null; then
      echo "GUARD FAILED: $f"
      echo "  A style pass may reshape a sentence. It may not change a number, a"
      echo "  glossary term, or a link. These counts moved:"
      sed 's/^/  /' /tmp/voice-guard.$$
      status=1
    fi
    rm -f /tmp/voice-guard.$$
  done < <(prose_files)
  if [ "$status" -eq 0 ]; then
    write_marker "$(content_hash)"
    rm -rf "$snapshot"
    echo "Guard passed. Nothing a style edit must preserve was changed."
  fi
  exit "$status"
  ;;
esac

# Stop hook mode.
input=$(cat 2>/dev/null || true)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ] && exit 0

files=$(prose_files)
if [ -z "$files" ]; then
  write_marker "$(marker_hash)"
  # A stale baseline would otherwise be compared against a later, unrelated edit of
  # the same file.
  rm -rf "$snapshot"
  exit 0
fi

# A word CONTEXT.md rules out, in a file name or a heading. This blocks whether or not
# the prose has been read back: the failure it prevents is a file shipping under a name
# the glossary rules out, which a read-back for voice will not catch because the
# sentence reads perfectly well.
hits=$(glossary_hits)
if [ -n "$hits" ]; then
  cat >&2 <<MSG
CONTEXT.md rules these words out, and they are in a file name or a heading:

$(printf '%s' "$hits" | sed 's/^/  /')

Use the term CONTEXT.md defines instead, and rename the file if the name is the
problem. If the word is genuinely right here, the glossary entry is what is wrong:
say so rather than working around the check.
$(report_scope_declarations)
MSG
  exit 2
fi

[ -n "$(marker_hash)" ] && [ "$(marker_hash)" = "$(content_hash)" ] && { write_marker "$(marker_hash)"; exit 0; }

# Never overwrite a baseline that is already here. A guard failure leaves the
# snapshot in place, and this hook runs again at the end of the very next turn: if
# that re-copied the current files, the failed comparison would become a comparison
# of each file against itself, which passes, writes the marker and reports that
# nothing a style edit must preserve was changed. A detected failure would erase
# itself by being ignored. A baseline is taken once and lives until --guard genuinely
# passes and deletes it. New files still get one, so adding prose is still checked.
mkdir -p "$snapshot"
while IFS= read -r f; do
  before="$snapshot/$(echo "$f" | tr '/' '%')"
  [ -f "$before" ] || cp "$f" "$before"
done <<< "$files"

cat >&2 <<MSG
These files carry prose that has not been read back:

$(printf '%s' "$files" | sed 's/^/  /')

Read each one against the five writing rules in AGENTS.md and fix what breaks
them. Rewrite in place. You are changing how a sentence reads and nothing else:
leave every number, every term CONTEXT.md defines, and every link exactly as it
is. If a glossary term genuinely reads badly, say so rather than writing around it.

Then run: .claude/hooks/voice-check.sh --guard

If you are choosing to skip this, say so in your reply and say why. Do not skip
it silently.
$(report_scope_declarations)
MSG
exit 2
