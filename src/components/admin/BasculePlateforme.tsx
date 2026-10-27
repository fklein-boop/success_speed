"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { plateformeAction } from "@/app/(app)/admin/actions";

/** Marque un critère « Plateforme » (ne pénalise plus le client). */
export function BasculePlateforme({ critereId, actif, propose, dominant, part }: { critereId: string; actif: boolean; propose: boolean; dominant: string | null; part: number }) {
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-col gap-0.5">
      <label className="inline-flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={actif} disabled={pending} onChange={(e) => { const v = e.target.checked; if (confirm(`${v ? "Marquer" : "Ne plus marquer"} ${critereId} « Plateforme » ? Les scores des audits seront recalculés.`)) start(async () => { await plateformeAction(critereId, v); }); }} />
        {pending ? <Loader2 size={12} className="animate-spin" aria-hidden /> : actif ? "Plateforme" : "Client"}
      </label>
      {propose && !actif && <span className="rounded bg-ambre/20 px-1 text-[11px]">proposé : {dominant} sur {Math.round(part * 100)} %</span>}
    </span>
  );
}
