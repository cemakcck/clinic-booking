import { notFound } from "next/navigation";

/** Unknown localized URLs fall through here so they render the localized not-found page. */
export default function CatchAll() {
  notFound();
}
