import { describe, test, expect } from "bun:test";
import { SessionOrder } from "../src/server/session-order";

describe("SessionOrder", () => {
  test("sync with initial sessions preserves natural order", () => {
    const order = new SessionOrder();
    order.sync(["a", "b", "c"]);
    expect(order.apply(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("reorder moves a session up (delta -1)", () => {
    const order = new SessionOrder();
    order.sync(["a", "b", "c"]);
    order.reorder("b", -1);
    expect(order.apply(["a", "b", "c"])).toEqual(["b", "a", "c"]);
  });

  test("reorder moves a session down (delta 1)", () => {
    const order = new SessionOrder();
    order.sync(["a", "b", "c"]);
    order.reorder("a", 1);
    expect(order.apply(["a", "b", "c"])).toEqual(["b", "a", "c"]);
  });

  test("reorder at top with delta -1 is a no-op", () => {
    const order = new SessionOrder();
    order.sync(["a", "b", "c"]);
    order.reorder("a", -1);
    expect(order.apply(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("reorder at bottom with delta 1 is a no-op", () => {
    const order = new SessionOrder();
    order.sync(["a", "b", "c"]);
    order.reorder("c", 1);
    expect(order.apply(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("sync adds new sessions at the end", () => {
    const order = new SessionOrder();
    order.sync(["a", "b"]);
    order.sync(["a", "b", "c"]);
    expect(order.apply(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("sync removes deleted sessions from order", () => {
    const order = new SessionOrder();
    order.sync(["a", "b", "c"]);
    order.reorder("c", -1); // c, b order becomes [a, c, b]
    order.sync(["a", "b"]); // c was deleted
    expect(order.apply(["a", "b"])).toEqual(["a", "b"]);
  });

  test("multiple reorders compose correctly", () => {
    const order = new SessionOrder();
    order.sync(["a", "b", "c", "d"]);
    order.reorder("d", -1); // [a, b, d, c]
    order.reorder("d", -1); // [a, d, b, c]
    expect(order.apply(["a", "b", "c", "d"])).toEqual(["a", "d", "b", "c"]);
  });
});
