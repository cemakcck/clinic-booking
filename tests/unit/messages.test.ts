import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import tr from "../../messages/tr.json";

const keys = (obj: object, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

describe("translations", () => {
  it("English and Turkish have exactly the same keys", () => {
    expect(keys(tr).sort()).toEqual(keys(en).sort());
  });

  it("no Turkish string is left empty", () => {
    const empty = keys(tr).filter((k) => k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], tr) === "");
    expect(empty).toEqual([]);
  });
});
