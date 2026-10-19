"use client";

import { useState } from "react";
import { Copy, Scale } from "lucide-react";
import { MENTION_JURIDIQUE } from "@/lib/restitution/textes";

/** Points légaux non conformes, avec un texte explicatif prêt à envoyer au client. */
export function AlertesLegales({ legaux }: { legaux: { id: string; critere: string; statut: string; texte: string }[] }) {
  const [copie, setCopie] = useState<string | null>(null);
  if (!legaux.length) return null;
  const copier = async (id: string, t: string) => {
    await navigator.clipboard.writeText(`${t}\n\n${MENTION_JURIDIQUE}`).catch(() => null);
    setCopie(id);
    setTimeout(() => setCopie(null), 2000);
  };
  return (
    <section className="rounded-carte border-2 border-rouge-texte/40 bg-[#fdecec] p-4" aria-labelledby="legal-titre">
      <h2 id="legal-titre" className="flex items-center gap-2 text-lg text-rouge-texte"><Scale size={18} aria-hidden /> Alertes légales ({legaux.length})</h2>
      <p className="text-sm text-gris-texte">Texte prêt à envoyer au client. {MENTION_JURIDIQUE}</p>
      <ul className="mt-3 space-y-3">
        {legaux.map((l) => (
          <li key={l.id} className="rounded-lg bg-white p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold"><span className="mr-2 rounded bg-rouge-texte px-1.5 py-0.5 text-xs text-white">{l.statut === "NON" ? "NON" : "PARTIEL"}</span>{l.id}</p>
              <button type="button" className="btn-discret shrink-0 !px-2 !py-1 text-xs" onClick={() => copier(l.id, l.texte)}>
                <Copy size={13} aria-hidden /> {copie === l.id ? "Copié ✓" : "Copier le texte"}
              </button>
            </div>
            <p className="mt-1 whitespace-pre-line">{l.texte}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
