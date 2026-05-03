import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// Sentinel injected for literal `${...}` so we can keep the bash payload
// inside a String.raw template without escaping every parameter expansion.
const D = "$";

// Pre-commit hook bash payload. Validates staged wiki category files. The
// canonical source lives here; running `ingest init` materializes it into
// `.git/hooks/pre-commit`. To update the hook, edit this string and re-run
// `ingest init` in the target org root.
export const PRE_COMMIT_HOOK = String.raw`#!/bin/bash
# Pre-commit hook for LLM Wiki
# Managed by ingest — regenerate via 'ingest init'.
# Validates staged wiki category files (entities.org, concepts.org, sources.org, analyses.org)
# for heading format compliance, link integrity, ID uniqueness, and property drawer balance.

set -euo pipefail

ERRORS=()
CATEGORY_FILES="entities.org concepts.org sources.org analyses.org"
# summary.org and inbox.org are not category files — not checked

expected_tag_for() {
  case "$1" in
    entities.org) echo "entity" ;;
    concepts.org) echo "concept" ;;
    sources.org)  echo "source" ;;
    analyses.org) echo "analysis" ;;
    *)            echo "" ;;
  esac
}

# Get staged wiki category files
STAGED_CATEGORY_FILES=""
for cf in $CATEGORY_FILES; do
  if git diff --cached --name-only --diff-filter=ACM -- "$cf" | grep -q .; then
    STAGED_CATEGORY_FILES="$STAGED_CATEGORY_FILES $cf"
  fi
done

# Trim leading space
STAGED_CATEGORY_FILES="${D}{STAGED_CATEGORY_FILES# }"

# If no category files are staged, nothing to check
if [ -z "$STAGED_CATEGORY_FILES" ]; then
  exit 0
fi

# --- Check 1: Per-heading format compliance ---
# Verifies:
#   - heading has a tag
#   - tag matches the file (entities.org → :entity:, etc.)
#   - heading has :ID: in YYYYMMDDTHHMMSS format
#   - heading has :DATE: in [YYYY-MM-DD] format
#   - :PROPERTIES: / :END: drawers are balanced
for f in $STAGED_CATEGORY_FILES; do
  if [ ! -f "$f" ]; then continue; fi
  expected=$(expected_tag_for "$f")

  while IFS= read -r line; do
    if [ -n "$line" ]; then
      ERRORS+=("$line")
    fi
  done < <(awk -v expected="$expected" '
    function flush_heading() {
      if (heading == "") return
      if (!has_tag) {
        print "FORMAT: missing tag on heading in " FILENAME ": " heading
      } else if (!has_correct_tag && expected != "") {
        print "FORMAT: tag mismatch in " FILENAME " (expected :" expected ":): " heading
      }
      if (!has_id)   print "FORMAT: missing :ID: in " FILENAME ": " heading
      if (!has_date) print "FORMAT: missing :DATE: in " FILENAME ": " heading
    }
    /^\* / {
      flush_heading()
      heading = $0
      has_tag = 0; has_correct_tag = 0; has_id = 0; has_date = 0
      if (match(heading, /(:[a-zA-Z_]+)+:[ \t]*$/)) {
        has_tag = 1
        block = tolower(substr(heading, RSTART, RLENGTH))
        if (index(block, ":" expected ":") > 0) has_correct_tag = 1
      }
    }
    /^:PROPERTIES:/ {
      if (in_props) {
        print "FORMAT: nested :PROPERTIES: at line " NR " in " FILENAME
      }
      in_props = 1
      props_start_line = NR
    }
    /^:END:/ {
      if (!in_props) {
        print "FORMAT: orphan :END: at line " NR " in " FILENAME
      }
      in_props = 0
    }
    in_props && /^:ID:/ {
      has_id = 1
      val = $2
      if (val !~ /^[0-9]{8}T[0-9]{6}$/) {
        print "FORMAT: malformed :ID: \"" val "\" in " FILENAME ": " heading
      }
    }
    in_props && /^:DATE:/ {
      has_date = 1
      val = $2
      if (val !~ /^\[[0-9]{4}-[0-9]{2}-[0-9]{2}\]$/) {
        print "FORMAT: malformed :DATE: \"" val "\" in " FILENAME ": " heading
      }
    }
    END {
      flush_heading()
      if (in_props) {
        print "FORMAT: unclosed :PROPERTIES: at line " props_start_line " in " FILENAME
      }
    }
  ' "$f")
done

# --- Check 2: Link integrity ---
# Collect all :ID: values from ALL category files (not just staged ones)
ALL_IDS=""
for cf in $CATEGORY_FILES; do
  if [ -f "$cf" ]; then
    ids=$(grep -h '^:ID:' "$cf" 2>/dev/null | awk '{print $2}' || true)
    if [ -n "$ids" ]; then
      ALL_IDS="$ALL_IDS
$ids"
    fi
  fi
done

# Check links only in staged files
for f in $STAGED_CATEGORY_FILES; do
  if [ ! -f "$f" ]; then continue; fi

  # Extract id: references from [[id:...]] links only (not from :ID: properties)
  LINKS=$(grep -oh '\[\[id:[0-9T]*\]' "$f" 2>/dev/null | grep -oh 'id:[0-9T]*' | sort -u || true)
  for link in $LINKS; do
    id="${D}{link#id:}"
    if ! echo "$ALL_IDS" | grep -q "^${D}{id}$"; then
      ERRORS+=("LINK: broken ${D}{link} in $f (no heading with :ID: ${D}{id})")
    fi
  done
done

# --- Check 3: :ID: uniqueness across all category files ---
EXISTING_FILES=""
for cf in $CATEGORY_FILES; do
  [ -f "$cf" ] && EXISTING_FILES="$EXISTING_FILES $cf"
done
if [ -n "$EXISTING_FILES" ]; then
  # shellcheck disable=SC2086
  DUPS=$(grep -hE '^:ID:' $EXISTING_FILES 2>/dev/null | awk '{print $2}' | sort | uniq -d || true)
  if [ -n "$DUPS" ]; then
    while IFS= read -r dup; do
      [ -n "$dup" ] && ERRORS+=("ID: duplicate :ID: $dup found in multiple headings")
    done <<< "$DUPS"
  fi
fi

# --- Report ---
if [ ${D}{#ERRORS[@]} -gt 0 ]; then
  echo "❌ Pre-commit hook failed:"
  echo ""
  for err in "${D}{ERRORS[@]}"; do
    echo "  $err"
  done
  echo ""
  echo "Fix the issues above and try again. Do NOT use --no-verify."
  exit 1
fi

exit 0
`;

export type InstallAction =
  | "wrote"
  | "skipped"
  | "replaced-symlink"
  | "replaced-and-backed-up";

export type InstallResult = {
  action: InstallAction;
  path: string;
  backupPath?: string;
};

function lexists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

const WIKI_CATEGORY_FILES = [
  "entities.org",
  "concepts.org",
  "sources.org",
  "analyses.org",
];

export type ScaffoldResult = {
  dir: string;
  created: string[];
  skipped: string[];
};

export function scaffoldWiki(dir: string): ScaffoldResult {
  mkdirSync(dir, { recursive: true });

  const created: string[] = [];
  const skipped: string[] = [];

  for (const f of WIKI_CATEGORY_FILES) {
    const p = join(dir, f);
    if (existsSync(p)) {
      skipped.push(f);
    } else {
      writeFileSync(p, "");
      created.push(f);
    }
  }

  for (const d of ["raw", "subs"]) {
    const p = join(dir, d);
    if (!existsSync(p)) {
      mkdirSync(p);
      created.push(d + "/");
    }
  }

  const example = join(dir, "raw", "example-ingest-readme.md");
  if (!existsSync(example)) {
    writeFileSync(example, __README__);
    created.push("raw/example-ingest-readme.md");
  }

  return { dir, created, skipped };
}

export function installPreCommitHook(orgRoot: string): InstallResult {
  const gitDir = join(orgRoot, ".git");
  if (!lexists(gitDir)) {
    throw new Error(
      `not a git repository: ${gitDir} missing. Run 'git init' first.`,
    );
  }
  const hooksDir = join(gitDir, "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const path = join(hooksDir, "pre-commit");

  let action: InstallAction = "wrote";
  let backupPath: string | undefined;

  if (lexists(path)) {
    const lst = lstatSync(path);
    if (lst.isSymbolicLink()) {
      // Symlinks to in-repo files (e.g., scripts/hooks/pre-commit) are
      // ingest's prior install method. Removing is safe — the link target
      // still lives in the repo, tracked by git.
      unlinkSync(path);
      action = "replaced-symlink";
    } else {
      const existing = readFileSync(path, "utf8");
      if (existing === PRE_COMMIT_HOOK) {
        return { action: "skipped", path };
      }
      backupPath = path + ".bak";
      writeFileSync(backupPath, existing);
      action = "replaced-and-backed-up";
    }
  }

  writeFileSync(path, PRE_COMMIT_HOOK);
  chmodSync(path, 0o755);

  return backupPath ? { action, path, backupPath } : { action, path };
}
