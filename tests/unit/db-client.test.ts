import { describe, expect, it } from "vitest";
import { clientOptions } from "@/lib/db/client";

describe("clientOptions", () => {
  it("turns prepared statements off behind a transaction pooler (port 6543)", () => {
    expect(clientOptions("postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres").prepare).toBe(false);
  });

  it("keeps prepared statements on for direct and session connections", () => {
    expect(clientOptions("postgres://clinic:clinic@localhost:5433/clinic").prepare).toBe(true);
    expect(clientOptions("postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:5432/postgres").prepare).toBe(true);
  });

  it("an unparseable url falls back to the defaults", () => {
    expect(clientOptions("not a url").prepare).toBe(true);
  });
});
