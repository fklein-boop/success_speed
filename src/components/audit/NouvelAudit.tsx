"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

/** Crée un audit (ou rouvre le brouillon en cours) puis ouvre l'écran de complétion. */
export function NouvelAudit({ clientId, enCours, className = "btn-primaire", label }: { clientId: string; enCours?: number | null; className?: string; label?: string }) {
  const router = useRouter();
  const [attente, setAttente] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (enCours) return <a href={`/audits/${enCours}`} className={className}><ClipboardCheck size={14} aria-hidden /> {label ?? "Reprendre l'audit"}</a>;
  return (
    <>
      <button className={className} disabled={attente} onClick={async () => {
        setAttente(true);
        const res = await fetch("/api/audits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId }) });
        const d = await res.json().catch(() => ({}));
        if (res.ok) router.push(`/audits/${d.id}`); else { setErr(d.erreur ?? "Erreur"); setAttente(false); }
      }}>
        <ClipboardCheck size={14} aria-hidden /> {attente ? "Ouverture…" : label ?? "Lancer l'audit"}
      </button>
      {err && <span role="alert" className="text-xs text-rouge-texte">{err}</span>}
    </>
  );
}
