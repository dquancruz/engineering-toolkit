import { Command, Option } from "commander";
import { readFileSync } from "node:fs";
import { loadConfig, resolveLang } from "./config.js";
import { LANGS, type Lang } from "./i18n/index.js";
import { runAdrAccept } from "./commands/adr.js";
import { CheckSetupError, formatReport, runCheck } from "./commands/check.js";
import { runIndex } from "./commands/index-cmd.js";
import { runEvidenceAdd, runEvidenceUpdate, runNewItem, runRulesIndex, type NewItemOptions } from "./commands/legacy.js";
import { AGENT_CHOICES, PROFILES, parseExtras, parseProfiles, runInitProfiles, type Profile } from "./commands/init.js";
import { runAgentTestGuards } from "./commands/agent.js";
import { runBranch } from "./commands/branch.js";
import { runChangelog } from "./commands/changelog.js";
import { runEnvCheck, runEnvExample } from "./commands/env.js";
import type { AgentChoice } from "./agent/install.js";
import { runJiraOncall } from "./commands/jira-oncall.js";
import { runJiraReport } from "./commands/jira-report.js";
import { runPrompt } from "./commands/prompt.js";
import { runDataHash, runNewSlice, runTestPlan, type NewSliceOptions, type TestPlanOptions } from "./commands/rebuild.js";
import { runRequirements, type RequirementsOptions } from "./commands/requirements.js";
import { PRESET_IDS } from "./prompt/model.js";
import { PENDING_TYPES, runNewAdr, runNewPending, type PendingType } from "./commands/new.js";

const collect = (value: string, previous: string[]) => [...previous, value];

function readVersion(): string {
  const pkg = new URL("../package.json", import.meta.url);
  return (JSON.parse(readFileSync(pkg, "utf-8")) as { version: string }).version;
}

/** Language resolved for the current invocation (flag > .engkit.json > es). */
export interface Context {
  lang: Lang;
}

export function createProgram(): Command {
  const ctx: Context = { lang: "es" };

  const program = new Command()
    .name("engkit")
    .description("Engineering toolkit: docs templates, prompt builder, git helpers and Jira reports.")
    .version(readVersion(), "-v, --version", "print the version")
    .addOption(
      new Option("--lang <lang>", "language for templates and messages").choices([...LANGS])
    )
    .showHelpAfterError();

  // Resolve the language once, before any subcommand runs.
  program.hook("preAction", (thisCommand) => {
    const flag = thisCommand.opts<{ lang?: string }>().lang;
    ctx.lang = resolveLang(flag, loadConfig());
  });

  program
    .command("init")
    .description("Create the base documents (ADR template, log, CLAUDE.md, AGENTS.md, glossary, pending, design) and optional profiles")
    .option("--profile <profiles>", `profiles to apply, comma separated (${PROFILES.join(", ")})`, "base")
    .option("--owner <name>", "owner written in the documents (default: git config user.name, else TODO)")
    .addOption(new Option("--agent <agent>", "subagents to create with the agent profile").choices([...AGENT_CHOICES]).default("both"))
    .option("--yes", "agent profile: write .claude/settings.json without asking")
    .option("--with <plans>", "rebuild profile: optional plans, comma separated (strangler, data)")
    .option("--dry-run", "show what would be created or changed and write nothing")
    .option("--update-guard", "agent profile: replace .claude/hooks/engkit-guard.mjs if it differs (shows a diff first)")
    .addHelpText(
      "after",
      `
Profiles:
  base   the documents (default)
  agent  additive: subagents in .claude/agents/ (reviewer: read-only; builder: edits and runs commands),
         the guard hook in .claude/hooks/engkit-guard.mjs and the permissions and hooks in
         .claude/settings.json. An existing settings.json is merged, never overwritten: the diff is
         shown and confirmed first (--yes skips the question; without a terminal nothing is written
         unless --yes). Protected branches come from "protectedBranches" in .engkit.json
         (default: main, master; patterns like release/* work).
  legacy additive: the sources register (F-xx), folders for business rules (RN), acceptance tests (PA) and
         defects (D), and the rule index. "engkit check" then verifies their links and the code evidence.
  requirements  additive: the document of non-functional requirements (RNF) and fixed constraints (RES),
         and the sources register (F-xx) it shares with legacy. Works without legacy, for new systems.
  rebuild  requirements + legacy (added when missing) + the rebuild plan, its vertical slices and the test
         plan. --with strangler adds the single-writer plan; --with data the data migration plan.

Existing files are never overwritten: they are reported and skipped.
The language and the path of each document are stored in .engkit.json,
and "engkit new" and "engkit index" read the paths from there.

Examples:
  engkit init
  engkit init --lang en --owner "Jane Doe"
  engkit init --profile base,agent --agent reviewer --dry-run
  engkit init --profile agent --yes`
    )
    .action(async (opts: { profile: string; owner?: string; agent: AgentChoice; with?: string; yes?: boolean; dryRun?: boolean; updateGuard?: boolean }) => {
      const profiles: Profile[] = parseProfiles(opts.profile);
      process.exitCode = await runInitProfiles(ctx.lang, {
        profiles,
        owner: opts.owner,
        agent: opts.agent,
        ...(opts.yes ? { yes: true } : {}),
        ...(opts.dryRun ? { dryRun: true } : {}),
        ...(opts.updateGuard ? { updateGuard: true } : {}),
        ...(opts.with !== undefined ? { extras: parseExtras(opts.with) } : {}),
      });
    });

  const agent = program.command("agent").description("Claude Code agent profile tools");

  agent
    .command("test-guards")
    .description("Check that the guards are installed and block what they should, without running anything dangerous")
    .option("--json", "print the result as JSON")
    .addHelpText(
      "after",
      `
Starts the configured hook like Claude Code does (command and args from .claude/settings.json, JSON on stdin)
with synthetic inputs and a throwaway git repository as working directory. Nothing is executed:
the guard only receives the text of the command. Checks that blocked cases exit 2 with a reason and
allowed ones exit 0, that commands which discard work are answered with "ask", that the deny and ask rules and "onFailure": "block" are present, that the hook command
exists and that "claude --version" is at least 2.1.295 (a warning if not).
It cannot test Claude Code's own permission engine.

Exit code: 0 all good, 1 a check failed, 2 the guards are not installed.

Example:
  engkit agent test-guards --json`
    )
    .action((opts: { json?: boolean }) => {
      process.exitCode = runAgentTestGuards({ ...(opts.json ? { json: true } : {}) });
    });

  const create = program.command("new").description("Create a new document from a template");

  create
    .command("adr")
    .description("Create the next ADR (status: proposed)")
    .argument("<title>", "title of the decision")
    .option("--owner <name>", "owner (default: git config user.name, else TODO)")
    .option("--supersedes <ID>", "accepted ADR that this one replaces (it becomes superseded)")
    .addHelpText(
      "after",
      `
Also regenerates the ADR index.

Examples:
  engkit new adr "Use PostgreSQL for storage"   → docs/adr/0001-use-postgresql-for-storage.md
  engkit new adr "Move to MySQL" --supersedes ADR-0001`
    )
    .action((title: string, opts: { owner?: string; supersedes?: string }) => {
      runNewAdr(title, ctx.lang, { owner: opts.owner, supersedes: opts.supersedes });
    });

  create
    .command("pendiente")
    .alias("pending")
    .description("Add an entry with the next P-xx ID to the pending file")
    .argument("[title]", "short title of the item")
    .addOption(new Option("--type <type>", "kind of item").choices([...PENDING_TYPES]).default("question"))
    .option("--owner <name>", "owner (default: git config user.name, else TODO)")
    .addHelpText("after", `\nExample:\n  engkit new pendiente "Confirm retention period" --type question --owner "Jane Doe"`)
    .action((title: string | undefined, opts: { type: PendingType; owner?: string }) => {
      runNewPending(title, ctx.lang, { type: opts.type, owner: opts.owner });
    });

  const owner = ["--owner <name>", "owner (default: git config user.name, else TODO)"] as const;

  create
    .command("rn")
    .description("Create the next business rule (legacy profile, status: draft)")
    .argument("<title>", "short title of the rule")
    .option("--area <area>", "group used by the rule index")
    .option("--question <P-xx>", "open question about it (repeatable)", collect, [])
    .option(...owner)
    .addHelpText("after", `\nExample:\n  engkit new rn "Late fee after 30 days" --area billing`)
    .action((title: string, opts: NewItemOptions) => {
      runNewItem("rule", title, ctx.lang, opts);
    });

  create
    .command("pa")
    .description("Create the next acceptance test (legacy profile)")
    .argument("<title>", "short title of the test")
    .option("--rule <RN>", "business rule it checks (repeatable)", collect, [])
    .option("--source <F-xx>", "source of the expected result, never code (repeatable)", collect, [])
    .option("--defect <D>", "defect it covers (repeatable)", collect, [])
    .option(...owner)
    .addHelpText("after", `\nExample:\n  engkit new pa "Fee on day 31" --rule RN-0001 --source F-02`)
    .action((title: string, opts: NewItemOptions) => {
      runNewItem("test", title, ctx.lang, opts);
    });

  create
    .command("defecto")
    .alias("defect")
    .description("Create the next defect of the old system (legacy profile, status: suspected)")
    .argument("<title>", "short title of the defect")
    .option("--rule <RN>", "business rule it affects (repeatable)", collect, [])
    .option("--question <P-xx>", "open question about it (repeatable)", collect, [])
    .option(...owner)
    .addHelpText("after", `\nExample:\n  engkit new defecto "Fee is charged twice" --rule RN-0001`)
    .action((title: string, opts: NewItemOptions) => {
      runNewItem("defect", title, ctx.lang, opts);
    });

  create
    .command("slice")
    .alias("rebanada")
    .description("Create the next vertical slice of the rebuild plan")
    .argument("<title>", "what the slice delivers")
    .option("--rule <RN>", "business rule it covers (repeatable)", collect, [])
    .option("--test <PA>", "acceptance test that checks it (repeatable)", collect, [])
    .option(...owner)
    .addHelpText("after", `\nExample:\n  engkit new slice "Issue an invoice" --rule RN-0001 --test PA-0001`)
    .action((title: string, opts: NewSliceOptions) => {
      runNewSlice(title, ctx.lang, opts);
    });

  program
    .command("requirements")
    .description("Collect non-functional requirements (RNF) and fixed constraints (RES)")
    .option("--from <file>", "YAML or JSON with \"requirements\" and \"constraints\" lists; no questions are asked")
    .option("--dry-run", "print the new entries and write nothing")
    .option("--owner <name>", "owner of the entries without one (default: git config user.name, else TODO)")
    .option("--allow-secrets", "write even if a possible secret was detected")
    .addHelpText(
      "after",
      `
New entries are appended with new IDs; existing ones are never changed, and one with the same category (or
kind) and title is skipped. In the guided mode nothing is written until the end.

--from file:
  requirements:
    - category: performance
      title: Invoice search
      status: confirmed          # draft (default) | confirmed | not-applicable
      measure: p95 latency
      target: <= 300 ms
      verify: PA-0012
      source: F-02
  constraints:
    - kind: region
      title: Deployment region
      value: eu-west-1
      decided_by: Legal
      origin: [ADR-0002]

Exit code: 0 ok, 1 possible secret, 2 bad input or no terminal, 130 cancelled.`
    )
    .action(async (opts: RequirementsOptions) => {
      process.exitCode = await runRequirements(ctx.lang, opts);
    });

  program
    .command("testplan")
    .description("Generate the test plan from the acceptance tests and the done criteria of the slices")
    .option("--slice <SL>", "only one slice (printed, the file is not written)")
    .option("--stdout", "print and write nothing")
    .addOption(new Option("--format <format>", "output format; json is printed").choices(["md", "json"]).default("md"))
    .addHelpText(
      "after",
      `
Writes rebuild.testplan (docs/plan-de-pruebas.md or docs/test-plan.md). It links the tests instead of copying
them, and ends with the gaps: rules without a test or a slice, slices without a test, and requirements and
criteria without verification. "engkit check" warns when the file is out of date.

Exit code: 0 ok, 2 the project cannot be read.

Examples:
  engkit testplan
  engkit testplan --slice SL-01
  engkit testplan --format json`
    )
    .action((opts: TestPlanOptions) => {
      process.exitCode = runTestPlan(ctx.lang, opts);
    });

  const data = program.command("data").description("Data migration plan tools (engkit never connects to a database)");

  data
    .command("hash")
    .description('Print the "definition" that the results file of a data plan must carry')
    .argument("<file>", "data plan file")
    .addHelpText("after", `\nExample:\n  engkit data hash docs/rebuild/data/invoices.md`)
    .action((file: string) => {
      process.exitCode = runDataHash(file);
    });

  const evidence = program.command("evidence").description("Code evidence of business rules and defects (legacy profile)");

  evidence
    .command("add")
    .description("Cite lines of code as evidence, recording their hash (the code is not copied)")
    .argument("<ID>", "RN-0001 or D-0001")
    .argument("<ref>", "<root>:<path>:<line> or <root>:<path>:<start>-<end>")
    .addHelpText(
      "after",
      `
Roots come from "evidenceRoots" in .engkit.json ("self" is this project); .engkit.local.json overrides
their paths on one machine. A reference written by hand without a hash gets it with this command.

Exit code: 0 ok, 1 root not available or the recorded content differs, 2 bad input.

Example:
  engkit evidence add RN-0001 erp:src/billing/fee.cbl:120-128`
    )
    .action((id: string, ref: string) => {
      process.exitCode = runEvidenceAdd(id, ref);
    });

  evidence
    .command("update")
    .description("Fix the line numbers of evidence that moved")
    .argument("[IDs...]", "rules or defects (default: all)")
    .option("--accept <ID>", "record the new content of this item's evidence, after reading it again (repeatable)", collect, [])
    .addHelpText(
      "after",
      `
Exit code: 0 up to date, 1 something needs review, 2 bad input.

Examples:
  engkit evidence update
  engkit evidence update --accept RN-0001`
    )
    .action((ids: string[], opts: { accept: string[] }) => {
      process.exitCode = runEvidenceUpdate(ids, opts);
    });

  const adr = program.command("adr").description("Change the state of an ADR");

  adr
    .command("accept")
    .description("Move an ADR from proposed to accepted and set its date to today")
    .argument("<ID>", "ADR-0003, 0003 or 3")
    .addHelpText(
      "after",
      `
Fails if the ADR is not "proposed" or its owner is TODO. Regenerates the ADR index.
After the acceptance is committed, "engkit check" rejects any later change to the ADR
except status -> superseded and adding superseded_by.

Example:
  engkit adr accept ADR-0003`
    )
    .action((id: string) => {
      runAdrAccept(id, ctx.lang);
    });

  program
    .command("check")
    .description("Verify the project documents (ADR immutability, dates, IDs, references, log, pending items)")
    .option("--json", "print the result as JSON")
    .option("--strict", "treat warnings as errors (recommended in CI)")
    .option("--allow-unavailable-evidence", "with --strict, an evidence root that is not available stays a warning")
    .addHelpText(
      "after",
      `
Rules: adr-immutable, status-date, unique-id, broken-ref, log-append-only, pending-owner,
pending-entry, todo-field, frontmatter, supersede-coherence, index-stale (warning),
adr-deleted (warning), git-history (warning), missing-doc (warning).

The git-based rules need history: without git, with a shallow clone, or for changes not
committed yet they report a warning instead of passing silently. In CI use
"actions/checkout" with fetch-depth: 0 and run "engkit check --strict".

Legacy profile (when .engkit.json has "legacy"): source-entry, expected-source, test-rule, rule-evidence,
rule-decision, rule-question, defect-evidence, legacy-field, evidence-invalid, evidence-changed and
evidence-missing are errors or, for drafts, warnings; rule-untested, test-discarded-rule, defect-question,
defect-untested, rule-deleted, legacy-file and the other evidence-* rules are warnings.
Evidence whose root is not available is reported as not verified (evidence-unavailable).

Requirements and rebuild profiles add their own rules (see the README), among them constraint-origin,
single-writer, data-results (errors) and requirement-measurable, rule-unplanned, slice-untested (warnings).

Exit code: 0 no errors, 1 errors found, 2 the project could not be checked (run "engkit init").

Examples:
  engkit check
  engkit check --json
  engkit check --strict`
    )
    .action((opts: { json?: boolean; strict?: boolean; allowUnavailableEvidence?: boolean }) => {
      try {
        const result = runCheck(ctx.lang, {
          strict: opts.strict === true,
          allowUnavailableEvidence: opts.allowUnavailableEvidence === true,
        });
        console.log(opts.json ? JSON.stringify(result, null, 2) : formatReport(result));
        process.exitCode = result.ok ? 0 : 1;
      } catch (e) {
        if (!(e instanceof CheckSetupError)) throw e;
        console.error(e.message);
        process.exitCode = 2;
      }
    });

  program
    .command("prompt")
    .description("Build a well-formed prompt for an AI (goal, context, material, limits, autonomy, done, verification, response)")
    .option("--from <file>", "answers file (.yaml or .json); no questions are asked")
    .addOption(new Option("--preset <preset>", "task type: preloads typical limits and verification").choices([...PRESET_IDS]))
    .option("--goal <text>", "what you want to achieve")
    .option("--context <text>", "what cannot be derived from the code")
    .option("--material <item>", "file, link or @adr:ADR-0003 / @pending:P-04 (repeatable)", collect, [])
    .option("--limit <item>", "something it must not do or touch, or @claude (repeatable)", collect, [])
    .option("--autonomy <text>", "when to stop and ask instead of deciding")
    .option("--done <text>", "how you will know it is finished (must be checkable)")
    .option("--verify <item>", "command or step that checks the result (repeatable)", collect, [])
    .option("--response <text>", "shape of the answer you want")
    .option("--checklist <id>", "add the limits and verification of a checklist, <id> or <id>:<variant> (repeatable)", collect, [])
    .option("--save [name]", "save the prompt and its answers to the prompts folder (git-ignored by default)")
    .option("--no-gitignore", "do not add the prompts folder to .gitignore")
    .option("--allow-secrets", "print and save even if a possible secret was detected")
    .option("--no-env-scan", "do not compare the prompt with values from .env files")
    .option("--strict", "exit 1 when there are warnings about empty or weak elements")
    .addHelpText(
      "after",
      `
Without --from or element flags it asks one question per element (needs a terminal).
The prompt is printed to stdout; warnings, questions and messages go to stderr.

Checklists: code-review (variants feature, bugfix, refactor, docs, dependencies), definition-of-done,
system-design and threat-model. Their prompt items go after the preset's and before yours. The guided
mode offers the one that fits the preset (default: no). --checklist alone keeps the guided mode.

Project integration (needs .engkit.json): the guided mode offers accepted ADRs and open
pending items as material, and CLAUDE.md as a limit. They are added as paths, never copied.
In files and flags use @adr:ADR-0003, @pending:P-04 and @claude.

Secrets: if the prompt looks like it contains a token, key or a value from a .env file,
nothing is printed or saved and the exit code is 1 (--allow-secrets overrides this).
Warnings about empty or weak elements never block.

Answers file (keys in English): preset, goal, context, material[], limits[], autonomy,
done, verify[], response. Flags override the file.

Exit codes: 0 ok, 1 blocked (secret, or warnings with --strict), 2 bad input or no terminal.

Examples:
  engkit prompt
  engkit prompt --from prompts/2026-03-09-add-pagination.yaml
  engkit prompt --preset bugfix --goal "Fix the 500 on POST /orders" --done "POST /orders returns 201" --verify '\`npm test\`' --save fix-orders`
    )
    .action(async (opts) => {
      process.exitCode = await runPrompt(ctx.lang, opts as Parameters<typeof runPrompt>[1]);
    });

  program
    .command("index")
    .description("Generate the ADR index and, with the legacy profile, the rule index (generated files; do not edit them)")
    .addHelpText(
      "after",
      "\nWrites paths.decisions (docs/DECISIONES.md or docs/DECISIONS.md) and legacy.rulesIndex (docs/REGLAS.md or\ndocs/RULES.md) as stored in .engkit.json."
    )
    .action(() => {
      const config = loadConfig();
      if (config.paths || !config.legacy) runIndex(ctx.lang);
      if (config.legacy) runRulesIndex(ctx.lang);
    });

  program
    .command("branch")
    .description("Create and switch to a branch named <type>/<TICKET>-<description>")
    .argument("<words...>", "ticket ID (optional, first) and short description")
    .option("--type <type>", "prefix: one of branch.types (default: branch.defaultType)")
    .option("--ticket <id>", "ticket ID, instead of writing it first")
    .option("--from <ref>", "base commit or branch (default: the current one)")
    .option("--dry-run", "only print the name")
    .addHelpText(
      "after",
      `
.engkit.json (all keys optional):
  { "branch": { "types": ["feature", "fix", "chore", "docs", "refactor", "test"],
                "defaultType": "feature",
                "ticketPattern": "[A-Z][A-Z0-9]+-\\\\d+",
                "requireTicket": false } }

It refuses a name that matches "protectedBranches" (ignoring case) or an existing branch.
The name is printed on stdout.

Exit code: 0 ok, 1 refused or git failed, 2 bad input.

Examples:
  engkit branch ABC-123 "Add pagination" --type fix   → fix/ABC-123-add-pagination
  engkit branch update dependencies --type chore      → chore/update-dependencies`
    )
    .action((words: string[], opts: { type?: string; ticket?: string; from?: string; dryRun?: boolean }) => {
      process.exitCode = runBranch(words, opts);
    });

  program
    .command("changelog")
    .description("Add the Conventional Commits between two refs to CHANGELOG.md")
    .argument("<refs...>", "<from> <to>, or only <to> with --from-start")
    .option("--release <name>", 'name in the heading (default: <to> if it is a tag, else "Unreleased")')
    .option("--from-start", "everything up to <to> (for the first release)")
    .option("--stdout", "print the section and write nothing")
    .option("--force", "rewrite the section if the release is already in the file")
    .option("--all", "also list docs, refactor, test, build, ci, style, chore and revert commits")
    .addHelpText(
      "after",
      `
Reads <from>..<to> without merge commits. Sections: breaking changes ("!" or a "BREAKING CHANGE:" footer),
features, fixes, performance and other (messages that do not follow the convention). The date is the one of
the <to> commit. The rest of the file is not touched. Headings follow --lang.

Exit code: 0 ok, 1 the release is already in the file, 2 bad input or shallow clone.

Examples:
  engkit --lang en changelog v1.1.0 HEAD --release v1.2.0
  engkit changelog v1.1.0 v1.2.0 --stdout
  engkit changelog v1.0.0 --from-start`
    )
    .action((refs: string[], opts: { release?: string; fromStart?: boolean; stdout?: boolean; force?: boolean; all?: boolean }) => {
      process.exitCode = runChangelog(ctx.lang, refs, opts);
    });

  const env = program.command("env").description("Work with the variable names of .env files (values are never printed or written)");

  env
    .command("example")
    .description("Create .env.example from the variable names of the .env files, or add the missing ones")
    .addHelpText(
      "after",
      `
Reads .env and .env.* in this folder (not *.example, *.sample, *.template, *.dist or backups).
Writes only NAME= lines; values and comments are never copied. Existing lines are not touched.
If a line cannot be read for certain, nothing is written and only the file and line number are shown.

Exit code: 0 ok, 2 it could not be done.

Example:
  engkit env example`
    )
    .action(() => {
      process.exitCode = runEnvExample();
    });

  env
    .command("check")
    .description("List the variables each .env file lacks compared with .env.example")
    .argument("[files...]", "files to compare (default: every .env file in this folder)")
    .option("--json", "print the result as JSON")
    .addHelpText(
      "after",
      `
Without .env.example each file is compared with all the variables of the compared files.
Variables that are not in .env.example are reported as warnings. A variable with an empty value counts
as present. Only names are shown.

Exit code: 0 nothing missing, 1 missing variables, 2 a file could not be read or there is nothing to compare.

Examples:
  engkit env check
  engkit env check .env.local .env.production --json`
    )
    .action((files: string[], opts: { json?: boolean }) => {
      process.exitCode = runEnvCheck(files, opts);
    });

  const jira = program.command("jira").description("Jira defect tools");

  jira
    .command("report")
    .description("Turn a Jira CSV export into a JSON report and summary of defects")
    .argument("<csv>", "path to the Jira CSV export")
    .argument("[person]", "only defects where this person is assignee or reporter")
    .option("--out <dir>", "directory for the report files", "reports")
    .addHelpText(
      "after",
      `
Environment:
  JIRA_BASE_URL   base URL of your Jira instance (adds "url" links to each defect)

Examples:
  engkit jira report Jira.csv
  engkit jira report Jira.csv "Jane Doe" --out ./out`
    )
    .action((csv: string, person: string | undefined, opts: { out: string }) => {
      process.exitCode = runJiraReport(csv, person, { out: opts.out });
    });

  jira
    .command("oncall")
    .description("Turn a jira report JSON into a Markdown oncall ticket, ordered by priority")
    .argument("<report>", "path to a JSON produced by `engkit jira report`")
    .argument("[name]", "oncall person", undefined)
    .argument("[sprint]", "sprint name")
    .option("--out <dir>", "directory for the ticket file", "tickets")
    .addHelpText(
      "after",
      `
Examples:
  engkit jira oncall reports/report_Jira_2026-05-13T19-06-42.json
  engkit jira oncall reports/report_Jira_2026-05-13T19-06-42.json "Daniel Quan" "Sprint 42"`
    )
    .action(
      (
        report: string,
        name: string | undefined,
        sprint: string | undefined,
        opts: { out: string }
      ) => {
        process.exitCode = runJiraOncall(report, name, sprint, { out: opts.out });
      }
    );

  return program;
}
