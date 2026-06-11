// PreToolUse hook for `claude -p` invocations spawned by ingest.
// Blocks the Edit tool when called with replace_all=true.
//
// Rationale: the agent (an LLM) has historically passed replace_all=true
// to write whole heading blocks to the wiki, which silently duplicates the
// block when the old_string pattern matches more than once. The fix
// pipeline (fix.ts dedup-id) recovers, but it's a 20+ minute round trip.
// This hook prevents the call at the harness layer.
//
// readFileSync(0) reads stdin — PreToolUse hooks receive the tool call as
// JSON on stdin. Non-matching calls fall through silently (exit 0, no stdout).
const input = require("fs").readFileSync(0, "utf8");
let data;
try { data = JSON.parse(input); } catch { process.exit(0); }
if (
  data.tool_name === "Edit" &&
  data.tool_input &&
  data.tool_input.replace_all === true
) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "Edit with replace_all=true is blocked by ingest policy. " +
        "For wiki writes, anchor on a unique line (the heading's " +
        ":ID:, :END:, or last cross-reference) and use single-replace.",
    },
  }) + "\n");
}
process.exit(0);
