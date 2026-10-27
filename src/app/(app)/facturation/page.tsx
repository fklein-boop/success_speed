import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/db";
import { facturationMois } from "@/lib/server/facturation";
import { moisPrecedent } from "@/lib/facturation/calcul";
import { Facturation } from "@/components/facturation/Facturation";

/** Commissions du mois écoulé (frais variables) par client ou groupe de comptes. */
export default async function FacturationPage({ searchParams }: { searchParams: Promise<{ mois?: string }> }) {
  await requireUser(["superadmin"]);
  const { mois } = await searchParams;
  const m = mois && /^\d{4}-\d{2}$/.test(mois) ? mois : moisPrecedent();
  const f = await facturationMois(await getDb(), m);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Facturation</h1>
        <p className="mt-1 max-w-3xl text-gris-texte">Commissions du mois (frais variables) calculées sur l&apos;export dossiers, selon la matrice de facturation : demandes, RésaLive en production interne et hors production. Sélectionnez un ou plusieurs comptes pour une facture unique (ex. Quartier Libre, APAS).</p>
      </div>
      <Facturation f={JSON.parse(JSON.stringify(f))} />
    </div>
  );
}
