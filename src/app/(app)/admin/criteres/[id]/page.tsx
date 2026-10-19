import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db";
import { tousCriteres } from "@/lib/server/parametres";
import { ChampsCritere } from "@/components/admin/ChampsCritere";
import { FormAdmin } from "@/components/admin/FormAdmin";
import { creerCritereAction, majCritereAction } from "../../actions";

export default async function CriterePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cs = await tousCriteres(await getDb());
  const nouveau = id === "nouveau";
  const c = nouveau ? {} : cs.find((x) => x.id === id);
  if (!c) notFound();
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  return (
    <div className="space-y-4">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-horizon hover:underline"><ArrowLeft size={14} aria-hidden /> Critères</Link>
      <section className="carte p-4">
        <h2 className="text-lg">{nouveau ? "Nouveau critère" : `${id} — version ${"version" in c ? c.version : ""}`}</h2>
        {!nouveau && <p className="mb-3 text-sm text-gris-texte">L&apos;enregistrement crée la version suivante. Les audits déjà réalisés restent évalués avec leur version ; les nouveaux audits utilisent celle-ci.</p>}
        <FormAdmin action={nouveau ? creerCritereAction : majCritereAction} bouton={nouveau ? "Créer le critère" : "Enregistrer une nouvelle version"}>
          <ChampsCritere c={c} nouveau={nouveau} piliers={uniq(cs.map((x) => x.pilier))} sources={uniq(cs.map((x) => x.source))} offres={uniq(cs.map((x) => x.offreSiNon))} />
        </FormAdmin>
      </section>
    </div>
  );
}
