export const NAV_ITEMS = [
  { href: "/treatments", key: "treatments" },
  { href: "/dentists", key: "dentists" },
  { href: "/international", key: "international" },
  { href: "/contact", key: "contact" },
] as const;

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
