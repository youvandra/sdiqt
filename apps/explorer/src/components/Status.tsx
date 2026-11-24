import { Check, X } from "lucide-react";
import type { Tone } from "../lib/format.ts";

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className="badge" data-tone={tone}>
      <span className="badge-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/** TableCell "Check" / "Cross": white check, or an X at half opacity. */
export function CheckCell({ ok, label }: { ok: boolean; label: string }) {
  return ok ? (
    <Check size={24} aria-label={label} />
  ) : (
    <X size={24} aria-label={label} style={{ color: "var(--bad)" }} />
  );
}
