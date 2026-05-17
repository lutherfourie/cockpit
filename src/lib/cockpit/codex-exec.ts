import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseCockpitOutput, type AgentInput, type CockpitAgentOutput } from "./schema";
import type { RepoState } from "./repo-state";
import type { SessionState } from "./storage";

export type CodexExecRequest = {
  args: string[];
  stdin: string;
  cwd: string;
  outputPath: string;
  timeoutMs: number;
};

export type CodexExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CodexExecRunner = (
  request: CodexExecRequest,
) => Promise<CodexExecResult>;

export type RunCodexExecOptions = {
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  runner?: CodexExecRunner;
  schemaPath?: string;
};

export async function runCodexExecCockpit({
  input,
  repoState,
  sessionState,
  options = {},
}: {
  input: AgentInput;
  repoState: RepoState;
  sessionState?: SessionState | null;
  options?: RunCodexExecOptions;
}): Promise<CockpitAgentOutput> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? readTimeoutMs();
  const schemaPath =
    options.schemaPath ??
    path.join(cwd, "src", "lib", "cockpit", "cockpit-output.schema.json");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cockpit-codex-"));
  const outputPath = path.join(tempDir, "last-message.json");
  const args = buildCodexArgs({
    cwd,
    schemaPath,
    outputPath,
    model: options.model ?? process.env.COCKPIT_CODEX_MODEL,
  });
  const stdin = buildCodexPrompt({ input, repoState, sessionState });

  try {
    const runner = options.runner ?? runCodexCli;
    const result = await runner({ args, stdin, cwd, outputPath, timeoutMs });
    if (result.exitCode !== 0) {
      throw new Error(
        `codex exec exited ${result.exitCode}: ${trimForError(result.stderr || result.stdout)}`,
      );
    }

    const rawOutput = await readFile(outputPath, "utf8").catch(
      () => result.stdout,
    );
    return parseCockpitOutput(rawOutput);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function buildCodexPrompt({
  input,
  repoState,
  sessionState,
}: {
  input: AgentInput;
  repoState: RepoState;
  sessionState?: SessionState | null;
}): string {
  return `
You are the Cockpit coordinator for a personal ADHD development assistant.
Compress messy input into one actionable development step.

Return only JSON matching the provided output schema.

Rules:
- Keep nextAction singular and concrete.
- Do not produce a giant task list.
- Put distracting-but-valid ideas in parkingLot, not nextAction.
- Separate implemented facts, assumptions, blockers, and proof still needed.
- Treat repoState as read-only evidence.
- Do not edit files or run commands for this turn.
- For handoff mode, include a concise handoff prompt; otherwise set handoff to null.

Input:
${JSON.stringify(input, null, 2)}

Persisted session state:
${JSON.stringify(sessionState ?? null, null, 2)}

Read-only repo state:
${JSON.stringify(repoState, null, 2)}
`.trim();
}

function buildCodexArgs({
  cwd,
  schemaPath,
  outputPath,
  model,
}: {
  cwd: string;
  schemaPath: string;
  outputPath: string;
  model?: string;
}): string[] {
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "--cd",
    cwd,
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    "--color",
    "never",
  ];

  if (model) {
    args.push("--model", model);
  }

  args.push("-");
  return args;
}

function runCodexCli(request: CodexExecRequest): Promise<CodexExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", request.args, {
      cwd: request.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`codex exec timed out after ${request.timeoutMs}ms`));
    }, request.timeoutMs);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });

    child.stdin.end(request.stdin);
  });
}

function readTimeoutMs(): number {
  const value = Number(process.env.COCKPIT_CODEX_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 120_000;
}

function trimForError(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 400 ? `${compact.slice(0, 397)}...` : compact;
}
