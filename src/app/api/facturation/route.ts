import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";
import { facturationMois } from "@/lib/server/facturation";
import { moisPrecedent } from "@/lib/facturation/calcul";

/** Synthèse du mois par agence (comme les cellules P4:Q10 de la matrice), en CSV. */
export const GET = handle(async (req: Request) => {
  await assertUser(["superadmin"]);
  const mois = new URL(req.url).searchParams.get("mois") ?? moisPrecedent();
  const f = await facturationMois(await getDb(), mois);
  const n = (x: number) => String(Math.round(x * 100) / 100).replace(".", ",");
  const t = f.tarifs;
  const entete = ["IDagence", "Client", "Groupe", "Demandes (pax)", "RésaLive KO (pax)", "Fees demandes (€)", "RésaLive OK (pax)", "RésaLive OK (CA)", "Production déclarée", "RésaLive OK prod (pax)", "RésaLive OK prod (CA)", "Fees prod interne (€)", "RésaLive OK hors prod (pax)", "RésaLive OK hors prod (CA)", "Fees prod externe (€)", "Total fees (€)"];
  const lignes = f.agences.map((a) => {
    const fd = (a.demandes + a.resaliveKo) * t.demande, fi = a.prodPax * t.resaliveInterne, fe = a.horsProdCa * t.resaliveExterne;
    return [a.idAgence, a.nom, a.groupe ?? "", a.demandes, a.resaliveKo, n(fd), a.resaliveOkPax, n(a.resaliveOkCa), a.production ? "oui" : "non", a.prodPax, n(a.prodCa), n(fi), a.horsProdPax, n(a.horsProdCa), n(fe), n(fd + fi + fe)];
  });
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = "﻿" + [entete, ...lignes].map((l) => l.map(esc).join(";")).join("\r\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="commissions-${mois}.csv"` } });
});
