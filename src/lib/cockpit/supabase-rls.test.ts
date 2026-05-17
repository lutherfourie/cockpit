import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260517152032_create_cockpit_memory.sql",
);

describe("Supabase RLS migration", () => {
  it("enables owner-scoped RLS on every public table", async () => {
    const sql = await readFile(migrationPath, "utf8");

    for (const table of ["cockpit_sessions", "parking_lot_items", "handoffs"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`on public.${table}`);
    }

    expect(sql.match(/user_id = \(select auth\.uid\(\)\)/g)?.length).toBeGreaterThanOrEqual(12);
    expect(sql).not.toMatch(/user_id = auth\.uid\(\)/);
    expect(sql).not.toMatch(/service_role/i);
    expect(sql).not.toMatch(/user_metadata/i);
  });
});
