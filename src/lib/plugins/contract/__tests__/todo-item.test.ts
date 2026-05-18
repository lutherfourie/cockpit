import { describe, it, expectTypeOf } from "vitest";
import type { TodoItem, LaneEvent } from "../types";

describe("TodoItem", () => {
  it("has id, content, status fields per spec §5.2", () => {
    const t: TodoItem = { id: "1", content: "do thing", status: "pending" };
    expectTypeOf(t.id).toEqualTypeOf<string>();
    expectTypeOf(t.content).toEqualTypeOf<string>();
    expectTypeOf(t.status).toEqualTypeOf<"pending" | "in_progress" | "completed">();
  });

  it("is the items type on LaneEvent { type: 'todo' }", () => {
    const evt: LaneEvent = {
      type: "todo",
      items: [{ id: "x", content: "foo", status: "in_progress" }],
    };
    expectTypeOf(evt).toMatchTypeOf<{ type: "todo"; items: TodoItem[] }>();
  });
});
