import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db";
import { canEdit, requireUser } from "@/lib/server/auth";
import { chargerRestitution, contexteTextes, modeleClient, type RestitutionAvecAudit } from "@/lib/server/restitution";
import { emailModele } from "@/lib/restitution/textes";
import { AuditError } from "@/lib/server/audits";
import { fmtDate, fmtDateHeure } from "@/lib/format";
import { PreparationRdv } from "@/components/restitution/PreparationRdv";
import { AlertesLegales } from "@/components/restitution/AlertesLegales";
import { questionnairesDuClient } from "@/lib/server/questionnaires";

export default async function RestitutionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = await getDb();
  const r = await chargerRestitution(db, id).catch((e) => { if (e instanceof AuditError) notFound(); throw e; });
  const editable = canEdit(user);
  const retour = <Link href={`/clients/${id}`} className="inline-flex items-center gap-1 text-sm text-horizon hover:underline"><ArrowLeft size={14} aria-hidden /> {r.client.nom}</Link>;
  if (!r.audit) {
    return <div className="space-y-4">{retour}<p className="carte p-6 text-gris-texte">Aucun audit pour ce client : lancez d&apos;abord un pré-audit depuis sa fiche.</p></div>;
  }
  const ra = r as RestitutionAvecAudit;
  const qs = await questionnairesDuClient(db, id);
  const m = modeleClient(ra);
  const mail = emailModele(contexteTextes(ra));
  const version = ra.textes?.updatedAt ? String(ra.textes.updatedAt.getTime()) : "0";

  return (
    <div className="space-y-6">
      {retour}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Préparer le rendez-vous — {r.client.nom}</h1>
          <p className="text-sm text-gris-texte">
            Basé sur le {ra.finalise ? "dernier audit finalisé" : "pré-audit en cours (non finalisé)"} du {fmtDate(ra.audit.date)} · score {m.score === null ? "—" : Math.round(m.score)}/100 · visé {m.scoreVise === null ? "—" : Math.round(m.scoreVise)}/100
            {!ra.finalise && <> · <Link href={`/audits/${ra.audit.id}`} className="text-horizon hover:underline">compléter l&apos;audit</Link></>}
          </p>
        </div>
      </header>

      <PreparationRdv key={version} clientId={id} auditId={ra.audit.id} editable={editable} emailContact={r.client.emailContact} version={version}
        textes={{ synthese: ra.textes?.synthese ?? m.synthese, emailObjet: ra.textes?.emailObjet ?? mail.objet, emailCorps: ra.textes?.emailCorps ?? mail.corps, source: ra.textes?.source ?? null, modifieLe: ra.textes?.updatedAt ? fmtDateHeure(ra.textes.updatedAt) : null }} />

      <AlertesLegales legaux={ra.legaux} />

      <section className="carte p-4" aria-labelledby="hist-titre">
        <h2 id="hist-titre" className="text-lg">Historique de la relation</h2>
        <div className="mt-3 grid gap-6 md:grid-cols-3">
          <div>
            <p className="libelle">Rendez-vous</p>
            {r.rdvs.length ? <ul className="mt-1 space-y-1 text-sm">{r.rdvs.map((x) => <li key={x.id}><strong>{x.date ? fmtDateHeure(x.date) : "—"}</strong> — {x.objet}{x.notes ? <span className="text-gris-texte"> · {x.notes}</span> : null}</li>)}</ul> : <p className="mt-1 text-sm text-gris-texte">Aucun rendez-vous.</p>}
          </div>
          <div>
            <p className="libelle">Envois au client</p>
            {r.envois.length ? <ul className="mt-1 space-y-1 text-sm">{r.envois.map((x) => <li key={x.id}><strong>{fmtDate(x.createdAt)}</strong> — « {x.objet} » à {x.destinataires}{Array.isArray(x.piecesJointes) ? <span className="text-gris-texte"> · {(x.piecesJointes as string[]).length} pièce(s) jointe(s)</span> : null}</li>)}</ul> : <p className="mt-1 text-sm text-gris-texte">Aucun envoi.</p>}
          </div>
        </div>

      </section>
    </div>
  );
}
