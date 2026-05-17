import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | "unknown";

export type RepoState = {
  cwd: string;
  branch: string;
  dirtyFiles: string[];
  packageManager: PackageManager;
  scripts: Record<string, string>;
  summary: string;
  errors: string[];
};

export async function summarizeRepoState(
  cwd = process.cwd(),
): Promise<RepoState> {
  const [gitStatus, packageManager, scripts] = await Promise.all([
    readGitStatus(cwd),
    detectPackageManager(cwd),
    readPackageScripts(cwd),
  ]);

  const errors = [...gitStatus.errors, ...scripts.errors];
  const dirtySummary =
    gitStatus.dirtyFiles.length === 0
      ? "clean worktree"
      : `${gitStatus.dirtyFiles.length} dirty file(s)`;

  return {
    cwd,
    branch: gitStatus.branch,
    dirtyFiles: gitStatus.dirtyFiles,
    packageManager,
    scripts: scripts.scripts,
    summary: `${gitStatus.branch}; ${dirtySummary}; package manager ${packageManager}`,
    errors,
  };
}

async function readGitStatus(cwd: string): Promise<{
  branch: string;
  dirtyFiles: string[];
  errors: string[];
}> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--short", "--branch"],
      { cwd, windowsHide: true },
    );
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    const branchLine = lines[0]?.replace(/^##\s*/, "").trim() || "unknown branch";
    const dirtyFiles = lines
      .slice(1)
      .map((line) => line.replace(/^.../, "").trim())
      .filter(Boolean);
    return { branch: branchLine, dirtyFiles, errors: [] };
  } catch (error) {
    return {
      branch: "not a git repository",
      dirtyFiles: [],
      errors: [`git status failed: ${formatError(error)}`],
    };
  }
}

async function detectPackageManager(cwd: string): Promise<PackageManager> {
  const candidates: Array<[PackageManager, string]> = [
    ["pnpm", "pnpm-lock.yaml"],
    ["npm", "package-lock.json"],
    ["yarn", "yarn.lock"],
    ["bun", "bun.lockb"],
  ];

  for (const [manager, file] of candidates) {
    try {
      await access(repoPath(cwd, file));
      return manager;
    } catch {
      // Try the next lockfile.
    }
  }

  return "unknown";
}

async function readPackageScripts(cwd: string): Promise<{
  scripts: Record<string, string>;
  errors: string[];
}> {
  try {
    const raw = await readFile(repoPath(cwd, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return { scripts: parsed.scripts ?? {}, errors: [] };
  } catch (error) {
    return {
      scripts: {},
      errors: [`package.json scripts unavailable: ${formatError(error)}`],
    };
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function repoPath(cwd: string, file: string): string {
  return path.join(/* turbopackIgnore: true */ cwd, file);
}
