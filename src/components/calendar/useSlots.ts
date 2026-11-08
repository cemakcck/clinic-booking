"use client";

import { useCallback, useRef, useState } from "react";
import { loadStaffSlots } from "@/app/[locale]/staff/(app)/calendar/actions";

type Q = { treatmentId: number; dentistId: number; date: string; appointmentId?: string };

/**
 * Free staff start times (null from `load` means a newer request superseded it) for a treatment/dentist/date, loaded on demand. Only the latest
 * request's answer is kept, so quick changes of date or dentist can't show stale times.
 */
export function useSlots() {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [slots, setSlots] = useState<string[]>([]);
  const seq = useRef(0);

  const load = useCallback(async (q: Q): Promise<string[] | null> => {
    const n = ++seq.current;
    setState("loading");
    try {
      const r = await loadStaffSlots(q);
      if (n !== seq.current) return null;
      const list = r.ok ? r.slots : [];
      setSlots(list);
      setState(r.ok ? "ready" : "error");
      return list;
    } catch {
      if (n === seq.current) {
        setSlots([]);
        setState("error");
      }
      return null;
    }
  }, []);

  return { state, slots, load };
}
