"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { ImportDialog, type ClientOption } from "./ImportDialog";

const Ctx = createContext<{ ouvrir: (f?: File) => void; autorise: boolean }>({ ouvrir: () => {}, autorise: false });
export const useImport = () => useContext(Ctx);

/** Zone de glisser-déposer accessible depuis n'importe quel écran (si l'utilisateur peut importer). */
export function ImportProvider({ autorise, clients, children }: { autorise: boolean; clients: ClientOption[]; children: React.ReactNode }) {
  const [ouvert, setOuvert] = useState(false);
  const [fichier, setFichier] = useState<File | null>(null);
  const [survol, setSurvol] = useState(false);

  useEffect(() => {
    if (!autorise) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; depth++; setSurvol(true); };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setSurvol(false); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setSurvol(false);
      const f = e.dataTransfer?.files[0];
      if (f && !ouvert) { setFichier(f); setOuvert(true); }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [autorise, ouvert]);

  return (
    <Ctx.Provider value={{ autorise, ouvrir: (f) => { setFichier(f ?? null); setOuvert(true); } }}>
      {children}
      {survol && !ouvert && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-horizon/15 p-6">
          <div className="carte flex flex-col items-center gap-3 border-2 border-dashed border-horizon p-10 shadow-xl">
            <Upload className="text-horizon" size={36} aria-hidden />
            <p className="font-titres text-lg font-bold">Déposez l&apos;extract pour mettre à jour les chiffres</p>
          </div>
        </div>
      )}
      {ouvert && <ImportDialog file={fichier} clients={clients} onClose={() => { setOuvert(false); setFichier(null); }} />}
    </Ctx.Provider>
  );
}

export function BoutonImport({ className = "btn-primaire" }: { className?: string }) {
  const { ouvrir, autorise } = useImport();
  if (!autorise) return null;
  return (
    <button className={className} onClick={() => ouvrir()}>
      <Upload size={16} aria-hidden /> Mettre à jour les chiffres
    </button>
  );
}
