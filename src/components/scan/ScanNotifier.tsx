"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";

const CLE = "scans-notifies";
const lire = (): number[] => { try { return JSON.parse(localStorage.getItem(CLE) ?? "[]"); } catch { return []; } };
const noter = (ids: number[]) => { try { localStorage.setItem(CLE, JSON.stringify(ids.slice(-50))); } catch { /* stockage indisponible */ } };

/** Prévient l'utilisateur quand un de ses pré-audits se termine alors qu'il a quitté la page de suivi. */
export function ScanNotifier() {
  const path = usePathname();
  const [toasts, setToasts] = useState<{ id: number; client: string; statut: string; auditId: number | null }[]>([]);
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch("/api/scans/recents").then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (!r) return;
      const vus = lire();
      const nouveaux = (r.scans as { id: number; client: string; statut: string; auditId: number | null }[]).filter((s) => !vus.includes(s.id));
      if (!nouveaux.length) return;
      noter([...vus, ...nouveaux.map((s) => s.id)]);
      // Pas de notification pour le scan déjà affiché à l'écran
      setToasts((x) => [...x, ...nouveaux.filter((s) => path !== `/scans/${s.id}`)]);
    }, 15000);
    return () => clearInterval(t);
  }, [path]);
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2" role="status" aria-live="polite">
      {toasts.map((s) => (
        <div key={s.id} className="carte flex items-start gap-3 p-4 shadow-lg">
          <CheckCircle2 className="mt-0.5 text-emeraude" size={20} aria-hidden />
          <div className="text-sm">
            <p className="font-semibold">Pré-audit {s.statut === "termine" ? "terminé" : "interrompu"} : {s.client}</p>
            <Link href={`/scans/${s.id}`} className="text-horizon hover:underline" onClick={() => setToasts((x) => x.filter((y) => y.id !== s.id))}>Voir les résultats →</Link>
          </div>
          <button className="text-gris-texte hover:text-minuit" aria-label="Fermer la notification" onClick={() => setToasts((x) => x.filter((y) => y.id !== s.id))}><X size={16} /></button>
        </div>
      ))}
    </div>
  );
}
