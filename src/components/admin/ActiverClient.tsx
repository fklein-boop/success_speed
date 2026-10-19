"use client";

import { BoutonAction } from "./FormAdmin";
import { activerClientAction } from "@/app/(app)/admin/actions";

export function ActiverClient({ id, nom, actif }: { id: string; nom: string; actif: boolean }) {
  return <BoutonAction action={() => activerClientAction(id, !actif)} label={actif ? "Désactiver" : "Réactiver"} className="btn-discret !px-2 !py-1 text-xs"
    confirmation={actif ? `Désactiver ${nom} ? Il disparaîtra du portefeuille (ses données sont conservées).` : undefined} />;
}
