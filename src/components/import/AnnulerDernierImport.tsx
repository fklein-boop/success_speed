"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";

export function AnnulerDernierImport({ fichier }: { fichier: string }) {
  const router = useRouter();
  const [etat, setEtat] = useState<"repos" | "confirmer" | "encours" | "erreur">("repos");
  const [msg, setMsg] = useState("");
  async function annuler() {
    setEtat("encours");
    const res = await fetch("/api/imports/annuler-dernier", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(json.erreur ?? "Échec"); setEtat("erreur"); return; }
    setEtat("repos");
    router.refresh();
  }
  if (etat === "confirmer" || etat === "encours") {
    return (
      <div className="flex items-center gap-2 text-sm" role="alertdialog" aria-label="Confirmer l'annulation">
        <span>Annuler l&apos;import de <strong>{fichier}</strong> et restaurer les chiffres précédents ?</span>
        <button className="btn-danger px-3 py-1.5" onClick={annuler} disabled={etat === "encours"}>{etat === "encours" ? "Annulation…" : "Oui, annuler"}</button>
        <button className="btn-discret" onClick={() => setEtat("repos")}>Non</button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {etat === "erreur" && <span role="alert" className="text-sm text-rouge-texte">{msg}</span>}
      <button className="btn-secondaire px-3 py-1.5" onClick={() => setEtat("confirmer")}><Undo2 size={14} aria-hidden /> Annuler le dernier import</button>
    </div>
  );
}
