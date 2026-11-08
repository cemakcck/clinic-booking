import { customType } from "drizzle-orm/pg-core";
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

export type TimeRange = { start: Date; end: Date };

/** Postgres `tstzrange` <-> `{ start, end }`, always half-open `[start,end)`. */
export const tstzrange = customType<{ data: TimeRange; driverData: string }>({
  dataType() {
    return "tstzrange";
  },
  toDriver(r) {
    return `[${r.start.toISOString()},${r.end.toISOString()})`;
  },
  fromDriver(v) {
    const m = /^[[(]"?([^",]+)"?,"?([^",)\]]+)"?[)\]]$/.exec(v);
    if (!m) throw new Error(`Unparseable tstzrange: ${v}`);
    return { start: new Date(m[1]), end: new Date(m[2]) };
  },
});

/** `col && tstzrange(start, end, '[)')` */
export function overlaps(col: AnyColumn, r: TimeRange): SQL {
  return sql`${col} && tstzrange(${r.start.toISOString()}::timestamptz, ${r.end.toISOString()}::timestamptz, '[)')`;
}
