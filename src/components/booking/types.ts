import type { DayData } from "@/lib/booking/wizard";

export type { DayData, SlotView, StripDay } from "@/lib/booking/wizard";

export type TreatmentOption = { slug: string; name: string; description: string; durationMin: number };
export type DentistOption = { slug: string; name: string; title: string };

/** Everything the server resolved from the URL; the client never sends ids or labels back. */
export type WizardProps = {
  locale: string;
  step: 1 | 2 | 3;
  treatments: TreatmentOption[];
  treatment: (TreatmentOption & { dentists: DentistOption[] }) | null;
  /** "any", a dentist slug, or null when the dentist step is due. */
  dentist: string | null;
  /** A dentist from a ?dentist= link, carried through step 1. */
  preDentist: DentistOption | null;
  /** Set when the linked dentist doesn't perform the chosen treatment. */
  notOffered: string | null;
  day: DayData | null;
  pricing: React.ReactNode;
};

export type Hold = {
  holdId: string;
  holdToken: string;
  dentistName: string;
  expiresAt: string;
  when: string;
  start: string;
};

export type Details = { name: string; phone: string; email: string; language: string; privacy: boolean; website: string };
