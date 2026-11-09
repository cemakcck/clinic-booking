import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const tokens: Record<string, string> = {
  bg: "#ffffff",
  soft: "#eef6f4",
  ink: "#10302e",
  mute: "#5d7472",
  brand: "#0f5e5a",
  "brand-2": "#1f8a7f",
  accent: "#7fd1c1",
  line: "#d9e6e3",
  booked: "#3d6fd8",
  arrived: "#2e9d5b",
  noshow: "#d0463b",
  mine: "#e0a412",
};

describe("design tokens", () => {
  it.each(Object.entries(tokens))("defines --color-%s as %s", (name, hex) => {
    expect(css).toMatch(new RegExp(`--color-${name}:\\s*${hex}\\s*;`, "i"));
  });
});
