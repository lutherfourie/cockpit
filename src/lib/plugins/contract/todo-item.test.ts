import { describe, expect, it, expectTypeOf } from "vitest";
import type { TodoItem, LaneEvent } from "./types";

describe("TodoItem", () => {
  it("has id, content, status fields per spec §5.2", () => {
    expectTypeOf<TodoItem["id"]>().toEqualTypeOf<string>();
    expectTypeOf<TodoItem["content"]>().toEqualTypeOf<string>();
    expectTypeOf<TodoItem["status"]>().toEqualTypeOf<"pending" | "in_progress" | "completed">();
    // Sanity: a concrete instance is constructable
    const t: TodoItem = { id: "1", content: "do thing", status: "pending" };
    expect(t.id).toBe("1");
  });

  it("is the items type on LaneEvent { type: 'todo' }", () => {
    type TodoEvent = Extract<LaneEvent, { type: "todo" }>;
    expectTypeOf<TodoEvent>().toEqualTypeOf<{ type: "todo"; items: TodoItem[] }>();
    // Constructability check
    const evt: LaneEvent = {
      type: "todo",
      items: [{ id: "x", content: "foo", status: "in_progress" }],
    };
    expect(evt.type).toBe("todo");
  });
});
