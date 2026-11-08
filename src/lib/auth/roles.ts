/** Pure role types, safe to import from client components and tests. */
export const ROLES = ["receptionist", "dentist", "admin"] as const;
export type Role = (typeof ROLES)[number];

export type Actor = { userId: string; name: string; role: Role; dentistId: number | null };

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}
