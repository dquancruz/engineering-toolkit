/**
 * Merges the engkit guards into a Claude Code `settings.json` without overwriting what is there.
 * Pure: takes the file text and returns the new text.
 */

export const GUARD_FILE = ".claude/hooks/engkit-guard.mjs";
export const SETTINGS_FILE = ".claude/settings.json";
/** Identifies the hook group owned by engkit. */
export const GUARD_MARKER = "engkit-guard.mjs";

/**
 * Deny rules enforced by the permission engine (a hook cannot override a deny). Bash rules only match
 * the literal prefix, so the hook is the one that really parses commands; `.env*` patterns are the hook's
 * job too, because a deny on `.env.*` would also block `.env.example`.
 */
export const DENY_RULES = [
  "Bash(rm -rf *)",
  "Bash(rm -fr *)",
  "Bash(git push --force *)",
  "Bash(git push -f *)",
  "Bash(git push --force-with-lease *)",
  ...[".env", ".env.local", ".env.development", ".env.production", ".env.test", ".env.staging"].flatMap((f) => [
    `Read(./${f})`,
    `Edit(./${f})`,
  ]),
];

/**
 * Ask rules: commands that are legitimate but destroy work git usually cannot recover, so a person
 * decides (a deny could not be approved at the prompt). Rules match the command text, so forms such as
 * `git -C dir reset --hard` are left to the hook, which also answers "ask".
 * A trailing " *" that is the only wildcard also matches the bare command.
 */
export const ASK_RULES = [
  ...["-f", "-d", "-x", "-X", "--force"].flatMap((flag) => [`Bash(git clean ${flag}*)`, `Bash(git clean * ${flag}*)`]),
  "Bash(git reset --hard *)",
  "Bash(git reset * --hard*)",
  "Bash(git checkout .)",
  "Bash(git checkout -- .)",
  "Bash(git checkout * -- .)",
  "Bash(git restore .)",
  "Bash(git restore * .)",
  "Bash(git stash drop *)",
  "Bash(git stash clear *)",
];

export const HOOK_MATCHER = "Bash|Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob";

/** Exec form (no shell): the same entry works on Linux, macOS and Windows. */
export function guardHookGroup(): Record<string, unknown> {
  return {
    matcher: HOOK_MATCHER,
    hooks: [
      {
        type: "command",
        command: "node",
        args: ["${CLAUDE_PROJECT_DIR}/" + GUARD_FILE],
        onFailure: "block",
        timeout: 10,
      },
    ],
  };
}

export class SettingsError extends Error {}

export interface MergeResult {
  text: string;
  changed: boolean;
  warnings: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** True for a hook group (or a single hook) that points at the engkit guard script. */
export function isGuardGroup(group: unknown): boolean {
  if (!isObject(group) || !Array.isArray(group["hooks"])) return false;
  return group["hooks"].some((h) => {
    if (!isObject(h)) return false;
    const parts = [h["command"], ...(Array.isArray(h["args"]) ? h["args"] : [])];
    return parts.some((p) => typeof p === "string" && p.includes(GUARD_MARKER));
  });
}

function detectIndent(text: string): string | number {
  const m = /^([ \t]+)"/m.exec(text);
  if (!m) return 2;
  return m[1]!.startsWith("\t") ? "\t" : m[1]!.length;
}

export function mergeSettings(existing: string | null): MergeResult {
  let data: Record<string, unknown> = {};
  if (existing !== null && existing.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch (e) {
      throw new SettingsError(
        `${SETTINGS_FILE} is not valid JSON (${e instanceof Error ? e.message : String(e)}). Fix it first; nothing was changed.`
      );
    }
    if (!isObject(parsed)) throw new SettingsError(`${SETTINGS_FILE} must contain a JSON object. Nothing was changed.`);
    data = parsed;
  }
  const warnings: string[] = [];

  // permissions.deny and permissions.ask: union, keeping what is there first
  let permissions = data["permissions"];
  if (permissions === undefined) permissions = {};
  if (!isObject(permissions)) throw new SettingsError(`"permissions" in ${SETTINGS_FILE} must be an object. Nothing was changed.`);
  for (const [key, rules] of [["deny", DENY_RULES], ["ask", ASK_RULES]] as const) {
    const current = permissions[key] ?? [];
    if (!Array.isArray(current)) throw new SettingsError(`"permissions.${key}" in ${SETTINGS_FILE} must be an array. Nothing was changed.`);
    permissions[key] = [...current, ...rules.filter((r) => !current.includes(r))];
  }
  data["permissions"] = permissions;
  if (permissions["defaultMode"] === "bypassPermissions") {
    warnings.push(
      'permissions.defaultMode is "bypassPermissions". engkit did not verify how the deny rules behave in that mode; review it.'
    );
  }

  // hooks.PreToolUse: replace our group in place, or append it
  let hooks = data["hooks"];
  if (hooks === undefined) hooks = {};
  if (!isObject(hooks)) throw new SettingsError(`"hooks" in ${SETTINGS_FILE} must be an object. Nothing was changed.`);
  let pre = hooks["PreToolUse"];
  if (pre === undefined) pre = [];
  if (!Array.isArray(pre)) throw new SettingsError(`"hooks.PreToolUse" in ${SETTINGS_FILE} must be an array. Nothing was changed.`);
  const at = pre.findIndex(isGuardGroup);
  const nextPre = [...pre];
  if (at === -1) nextPre.push(guardHookGroup());
  else nextPre[at] = guardHookGroup();
  hooks["PreToolUse"] = nextPre;
  data["hooks"] = hooks;

  const eol = existing?.includes("\r\n") ? "\r\n" : "\n";
  const body = JSON.stringify(data, null, existing === null ? 2 : detectIndent(existing)).replace(/\n/g, eol);
  const text = body + eol;
  const changed = existing === null || JSON.stringify(JSON.parse(existing.trim() === "" ? "{}" : existing)) !== JSON.stringify(data);
  return { text: changed ? text : (existing as string), changed, warnings };
}
