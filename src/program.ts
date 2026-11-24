import { Command, Option } from "commander";
import { readFileSync } from "node:fs";
import { loadConfig, resolveLang } from "./config.js";
import { LANGS, type Lang } from "./i18n/index.js";
import { runIndex } from "./commands/index-cmd.js";
import { PROFILES, runInit, type Profile } from "./commands/init.js";
import { runJiraOncall } from "./commands/jira-oncall.js";
import { runJiraReport } from "./commands/jira-report.js";
import { PENDING_TYPES, runNewAdr, runNewPending, type PendingType } from "./commands/new.js";

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
    .description("Create the base documents (ADR template, log, CLAUDE.md, AGENTS.md, glossary, pending, design)")
    .addOption(new Option("--profile <profile>", "document profile").choices([...PROFILES]).default("base"))
    .option("--owner <name>", "owner written in the documents (default: git config user.name, else TODO)")
    .addHelpText(
      "after",
      `
Existing files are never overwritten: they are reported and skipped.
The language and the path of each document are stored in .engkit.json,
and "engkit new" and "engkit index" read the paths from there.

Examples:
  engkit init
  engkit init --lang en --owner "Jane Doe"`
    )
    .action((opts: { profile: Profile; owner?: string }) => {
      runInit(ctx.lang, { profile: opts.profile, owner: opts.owner });
    });

  const create = program.command("new").description("Create a new document from a template");

  create
    .command("adr")
    .description("Create the next ADR (status: proposed)")
    .argument("<title>", "title of the decision")
    .option("--owner <name>", "owner (default: git config user.name, else TODO)")
    .addHelpText("after", `\nExample:\n  engkit new adr "Use PostgreSQL for storage"   → docs/adr/0001-use-postgresql-for-storage.md`)
    .action((title: string, opts: { owner?: string }) => {
      runNewAdr(title, ctx.lang, { owner: opts.owner });
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

  program
    .command("index")
    .description("Generate the ADR index (a generated file; do not edit it)")
    .addHelpText("after", "\nWrites the file stored as paths.decisions in .engkit.json (docs/DECISIONES.md or docs/DECISIONS.md).")
    .action(() => {
      runIndex(ctx.lang);
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
