"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Recherche d'un client en haut de l'accueil : raccourci « / », flèches et Entrée pour ouvrir la fiche. */
export function RechercheClient({ clients }: { clients: { id: string; nom: string; groupe?: string | null }[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [actif, setActif] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (ev.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); ref.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const res = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return [];
    return clients.filter((c) => norm(`${c.nom} ${c.id} ${c.groupe ?? ""}`).includes(n)).slice(0, 8);
  }, [q, clients]);
  const ouvrir = (id: string) => router.push(`/clients/${id}`);
  return (
    <div className="relative w-full max-w-md">
      <label htmlFor="recherche-client" className="sr-only">Rechercher un client</label>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gris-texte" aria-hidden />
      <input id="recherche-client" ref={ref} value={q} onChange={(e) => { setQ(e.target.value); setActif(0); }} autoComplete="off"
        role="combobox" aria-expanded={res.length > 0} aria-controls="recherche-resultats" aria-activedescendant={res[actif] ? `rc-${res[actif].id}` : undefined}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActif((a) => Math.min(a + 1, res.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActif((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && res[actif]) { e.preventDefault(); ouvrir(res[actif].id); }
          else if (e.key === "Escape") { setQ(""); ref.current?.blur(); }
        }}
        placeholder="Rechercher un client (nom ou identifiant)" className="champ pl-9 pr-10" />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-gris-clair px-1.5 font-mono text-xs text-gris-texte" aria-hidden>/</kbd>
      {res.length > 0 && (
        <ul id="recherche-resultats" role="listbox" className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-gris-clair bg-white shadow-lg">
          {res.map((c, i) => (
            <li key={c.id} id={`rc-${c.id}`} role="option" aria-selected={i === actif}>
              <button type="button" onMouseEnter={() => setActif(i)} onClick={() => ouvrir(c.id)} className={`flex w-full justify-between gap-3 px-3 py-2 text-left text-sm ${i === actif ? "bg-horizon/10" : ""}`}>
                <span className="font-semibold">{c.nom}</span><span className="text-xs text-gris-texte">{c.id}{c.groupe ? ` · ${c.groupe}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim() && !res.length && <p className="absolute mt-1 text-xs text-gris-texte">Aucun client ne correspond.</p>}
    </div>
  );
}
