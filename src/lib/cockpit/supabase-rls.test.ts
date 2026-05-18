import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsPath = path.join(process.cwd(), "supabase", "migrations");

const publicTables = [
  "cockpit_sessions",
  "parking_lot_items",
  "handoffs",
  "cockpit_chat_messages",
];

const appendOnlyTables = ["cockpit_assistant_events"];

const commands = ["select", "insert", "update", "delete"];

describe("Supabase RLS migration", () => {
  it("enables owner-scoped RLS on every public table", async () => {
    const sql = await readAllMigrationSql();

    for (const table of publicTables) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(
        `grant select, insert, update, delete on public.${table} to authenticated`,
      );

      for (const command of commands) {
        expect(sql).toMatch(createOwnerPolicyPattern(table, command));
      }
    }

    for (const table of appendOnlyTables) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`grant select, insert on public.${table} to authenticated`);
      expect(sql).toMatch(createOwnerPolicyPattern(table, "select"));
      expect(sql).toMatch(createOwnerPolicyPattern(table, "insert"));
      expect(sql).not.toMatch(createOwnerPolicyPattern(table, "update"));
      expect(sql).not.toMatch(createOwnerPolicyPattern(table, "delete"));
    }

    expect(sql.match(/user_id = \(select auth\.uid\(\)\)/g)?.length).toBeGreaterThanOrEqual(
      publicTables.length * 5 + appendOnlyTables.length * 2,
    );
    expect(sql).toContain(
      "alter publication supabase_realtime add table public.cockpit_assistant_events",
    );
    expect(sql).not.toMatch(/user_id = auth\.uid\(\)/);
    expect(sql).not.toMatch(/service_role/i);
    expect(sql).not.toMatch(/user_metadata/i);
  });
});

async function readAllMigrationSql(): Promise<string> {
  const migrationFiles = (await readdir(migrationsPath))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const migrationSql = await Promise.all(
    migrationFiles.map((file) => readFile(path.join(migrationsPath, file), "utf8")),
  );

  return migrationSql.join("\n");
}

function createOwnerPolicyPattern(table: string, command: string): RegExp {
  const ownerPredicate = String.raw`user_id = \(select auth\.uid\(\)\)`;
  const prefix = String.raw`create policy "${table}_${command}_own"\s+on public\.${table}\s+for ${command}\s+to authenticated\s+`;

  if (command === "insert") {
    return new RegExp(`${prefix}with check \\(${ownerPredicate}\\)`, "i");
  }

  if (command === "update") {
    return new RegExp(
      `${prefix}using \\(${ownerPredicate}\\)\\s+with check \\(${ownerPredicate}\\)`,
      "i",
    );
  }

  return new RegExp(`${prefix}using \\(${ownerPredicate}\\)`, "i");
}
