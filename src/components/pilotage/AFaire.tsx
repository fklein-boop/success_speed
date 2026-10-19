import Link from "next/link";
import { CalendarClock, ClipboardList, MailQuestion, Scale } from "lucide-react";
import type { AFaire as AFaireData } from "@/lib/server/pilotage";
import { fmtDate } from "@/lib/format";

/** File « À faire cette semaine » (portefeuille du CSM, ou tout le portefeuille pour le super admin). */
export function AFaire({ f, portee }: { f: AFaireData; portee: string }) {
  const blocs = [
    { titre: "Clients critiques sans RDV", Icone: CalendarClock, items: f.critiquesSansRdv.map((c) => ({ id: c.id, nom: c.nom, detail: c.alerte, href: `/clients/${c.id}/restitution` })) },
    { titre: "Audits à relancer", Icone: ClipboardList, items: f.auditsARelancer.map((c) => ({ id: c.id, nom: c.nom, detail: c.raison, href: c.auditId ? `/audits/${c.auditId}` : `/clients/${c.id}` })) },
    { titre: "Questionnaires en attente", Icone: MailQuestion, items: f.questionnairesEnAttente.map((c) => ({ id: c.id, nom: c.nom, detail: `Envoyé le ${fmtDate(c.envoyeLe)}${c.relances ? `, ${c.relances} relance(s)` : ""}`, href: `/clients/${c.id}` })) },
    { titre: "Points légaux non communiqués", Icone: Scale, items: f.legauxNonCommuniques.map((c) => ({ id: c.id, nom: c.nom, detail: c.criteres.join(", "), href: `/clients/${c.id}/restitution` })) },
  ];
  const total = blocs.reduce((n, b) => n + b.items.length, 0);
  return (
    <section className="carte p-4" aria-labelledby="afaire-titre">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="afaire-titre" className="text-lg">À faire cette semaine</h2>
        <span className="text-sm text-gris-texte">{portee} · {total ? `${total} point(s)` : "rien d'urgent"}</span>
      </div>
      {total > 0 && (
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {blocs.map(({ titre, Icone, items }) => (
            <div key={titre}>
              <p className="flex items-center gap-1.5 text-sm font-semibold"><Icone size={15} className="text-horizon" aria-hidden /> {titre} <span className="rounded-full bg-gris-clair px-1.5 text-xs">{items.length}</span></p>
              {items.length ? (
                <ul className="mt-1.5 space-y-1 text-sm">
                  {items.slice(0, 6).map((i) => <li key={`${titre}-${i.id}`}><Link href={i.href} className="font-semibold text-horizon hover:underline">{i.nom}</Link> <span className="text-gris-texte">— {i.detail}</span></li>)}
                  {items.length > 6 && <li className="text-xs text-gris-texte">et {items.length - 6} autre(s)</li>}
                </ul>
              ) : <p className="mt-1 text-sm text-gris-texte">Aucun.</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
