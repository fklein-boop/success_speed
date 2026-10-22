import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq, inArray, ne } from "drizzle-orm";
import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import { getDb } from "@/db";
import { alertes, clients, clientSnapshots, clientUrls, groupes, metriquesClientMensuelles, users } from "@/db/schema";
import { canEdit, requireUser } from "@/lib/server/auth";
import type { ClientMetrics } from "@/lib/metrics/compute";
import { fmtDate, fmtEur, fmtEurCompact, fmtNb, fmtPct } from "@/lib/format";
import { Evol, RisqueBadge, SanteJauge, SegmentBadge } from "@/components/Badges";
import { Kpi } from "@/components/Kpi";
import { MonthlyChart } from "@/components/client/MonthlyChart";
import { TraficConversion } from "@/components/client/TraficConversion";
import { InfosClientForm } from "@/components/client/InfosClientForm";
import { ajouterUrl, supprimerUrl } from "./actions";
import { auditsDuClient, loadCriteres } from "@/lib/server/audits";
import { evaluations } from "@/db/schema";
import { compareAudits, type ScoreResult, type Statut } from "@/lib/audit/score";
import { HistoriqueAudits } from "@/components/audit/HistoriqueAudits";
import { chargerRestitution, EFFECTIF_MIN_MOYENNE, type RestitutionAvecAudit } from "@/lib/server/restitution";
import { explicationModele } from "@/lib/restitution/textes";
import { planRecommande } from "@/lib/restitution/plan";
import { PiliersCompares } from "@/components/restitution/PiliersCompares";
import { Pourquoi } from "@/components/restitution/Pourquoi";
import { PlanAction } from "@/components/restitution/PlanAction";
import { AlertesLegales } from "@/components/restitution/AlertesLegales";
import { CalendarClock, FileText, Send } from "lucide-react";
import { fmtDateHeure } from "@/lib/format";
import { questionnairesDuClient, questionsAudit } from "@/lib/server/questionnaires";
import { QuestionnaireCsm } from "@/components/questionnaire/QuestionnaireCsm";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = await getDb();
  const [c] = await db.select().from(clients).where(eq(clients.id, id));
  if (!c) notFound();
  const [[snap], urls, mois, hist, csms, grp] = await Promise.all([
    db.select().from(clientSnapshots).where(eq(clientSnapshots.clientId, id)),
    db.select().from(clientUrls).where(eq(clientUrls.clientId, id)).orderBy(desc(clientUrls.principale)),
    db.select().from(metriquesClientMensuelles).where(eq(metriquesClientMensuelles.clientId, id)).orderBy(asc(metriquesClientMensuelles.mois)),
    db.select().from(alertes).where(eq(alertes.clientId, id)).orderBy(desc(alertes.ouverteLe)).limit(20),
    db.select({ id: users.id, nom: users.nom, email: users.email }).from(users).where(ne(users.role, "lecture")),
    c.groupeId ? db.select().from(groupes).where(eq(groupes.id, c.groupeId)) : Promise.resolve([]),
  ]);
  const m = (snap?.data as ClientMetrics | undefined) ?? null;
  const editable = canEdit(user);
  const listeAudits = await auditsDuClient(db, id);
  const finalises = listeAudits.filter((a) => a.statut === "finalise");
  let evolution = null;
  if (finalises.length >= 2) {
    const [apres, avant] = finalises;
    const evs = await db.select({ auditId: evaluations.auditId, critereId: evaluations.critereId, statut: evaluations.statut }).from(evaluations).where(inArray(evaluations.auditId, [apres.id, avant.id]));
    const map = (aid: number) => new Map(evs.filter((e) => e.auditId === aid).map((e) => [e.critereId, { statut: e.statut as Statut | null }]));
    const cmp = compareAudits(map(avant.id), map(apres.id));
    const libelle = new Map((await loadCriteres(db)).map((c) => [c.id, c.critere]));
    const sa = (apres.score as ScoreResult | null)?.score ?? null, sb = (avant.score as ScoreResult | null)?.score ?? null;
    evolution = {
      depuis: avant.date,
      delta: sa !== null && sb !== null ? sa - sb : null,
      gagnes: cmp.gagnes.map((g) => ({ id: g, critere: libelle.get(g) ?? "" })),
      perdus: cmp.perdus.map((g) => ({ id: g, critere: libelle.get(g) ?? "" })),
    };
  }
  const restit = await chargerRestitution(db, id);
  const [tousGroupes, modelesRows] = await Promise.all([db.select().from(groupes), db.selectDistinct({ m: clients.modele }).from(clients)]);
  const modeles = modelesRows.map((r) => r.m).filter((x): x is string => !!x).sort();
  const ra = restit.audit ? (restit as RestitutionAvecAudit) : null;
  const modeleExpl = ra ? explicationModele(c.nom, ra.enRetard, ra.causes, ra.planPropose) : null;
  // Questionnaire : il complète le brouillon en cours, à défaut le dernier audit
  const auditQ = listeAudits.find((a) => a.statut === "brouillon") ?? listeAudits[0] ?? null;
  const [questionnairesClient, questionsPrevues] = await Promise.all([questionnairesDuClient(db, id), auditQ ? questionsAudit(db, auditQ.id, false) : Promise.resolve([])]);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const nomU = (uid: number | null) => { const x = csms.find((u) => u.id === uid); return x ? x.nom || x.email : null; };

  const S = [
    { label: "Dynamique", v: m?.s_dynamique, max: 35, def: "Évolution 90 j vs N-1 (25 pts) et 30 derniers jours vs moyenne des 3 mois précédents (10 pts). −50 % → 0, +50 % → plein." },
    { label: "Activité", v: m?.s_activite, max: 25, def: "Récence du dernier dossier (15 pts : ≤ 7 j → plein, ≥ 60 j → 0) et nombre de dossiers sur 90 j (10 pts à partir de 30)." },
    { label: "Usage", v: m?.s_usage, max: 20, def: "Transformation sur 12 mois (dossiers confirmés ÷ créés) : 50 % ou plus → 20 pts." },
    { label: "Qualité", v: m?.s_qualite, max: 20, def: "Erreurs RésaLive (0 % → 10 pts, ≥ 10 % → 0) et annulations (0 % → 10 pts, ≥ 25 % → 0)." },
  ];

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-horizon hover:underline"><ArrowLeft size={14} aria-hidden /> Portefeuille</Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl">{c.nom}</h1>
          <p className="mt-1 text-sm text-gris-texte">{c.id}{grp[0] ? ` · Groupe ${grp[0].nom}` : ""}{c.modele ? ` · ${c.modele}` : ""}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <SegmentBadge segment={m?.segment} /> <RisqueBadge risque={m?.risque} />
            {m && <span className="rounded-full bg-gris-clair px-2.5 py-0.5 text-xs font-semibold">{m.usage}</span>}
          </div>
        </div>
        <div className="text-right text-sm text-gris-texte">
          {snap && <p>Données au {fmtDate(snap.reference)}</p>}
        </div>
      </header>

      {(c.googleStatut === "CLOSED_PERMANENTLY" || c.googleStatut === "CLOSED_TEMPORARILY") && (
        <p role="alert" className={`rounded-lg border p-3 text-sm ${c.googleStatut === "CLOSED_PERMANENTLY" ? "border-rouge/50 bg-rouge/10 text-rouge-texte" : "border-ambre/60 bg-ambre/15"}`}>
          <strong>Fiche Google indiquée « {c.googleStatut === "CLOSED_PERMANENTLY" ? "définitivement fermé" : "temporairement fermé"} »</strong>
          {c.googleStatutLe ? ` (relevé par le scan du ${fmtDate(c.googleStatutLe.toISOString())})` : ""}. {c.googleStatut === "CLOSED_PERMANENTLY" ? "Risque de départ : contactez le client." : "Vérifiez avec le client la date de réouverture."}
        </p>
      )}

      <HistoriqueAudits clientId={c.id} nom={c.nom} urls={urls.map((u) => u.url)} editable={editable} evolution={evolution}
        audits={listeAudits.map((a) => ({ id: a.id, date: a.date, statut: a.statut, origine: a.origine, mention: a.mention, score: a.score as ScoreResult | null, auteur: nomU(a.auteurId), assigne: nomU(a.assigneA) }))} />

      {ra && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="carte p-4" aria-labelledby="piliers-titre">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="piliers-titre" className="text-lg">Maturité par pilier</h2>
                <p className="text-sm">{ra.finalise ? "Audit" : "Pré-audit"} du {fmtDate(ra.audit.date)} · visé après plan d&apos;action : <strong>{ra.scoreVise === null ? "—" : Math.round(ra.scoreVise)}/100</strong></p>
              </div>
              <div className="mt-3"><PiliersCompares score={ra.score} portefeuille={ra.benchmark.portefeuille} champions={ra.benchmark.champions} min={EFFECTIF_MIN_MOYENNE} /></div>
            </section>
            <Pourquoi causes={ra.causes} explication={ra.textes?.explication ?? modeleExpl!.explication} plan30={(ra.textes?.plan30 as string[] | null) ?? modeleExpl!.plan30} source={ra.textes?.source ?? null} maturite={ra.score.score} />
          </div>
          <AlertesLegales legaux={ra.legaux} />
          <PlanAction clientId={c.id} editable={editable} nbProposees={ra.planPropose.length} nbRecommandees={planRecommande(ra.planPropose).length}
            actions={restit.actions.map((a) => ({ ...a, verifLe: a.verifLe ? a.verifLe.toISOString() : null, ancien: a.auditId !== ra.audit.id }))} />
          <QuestionnaireCsm clientId={c.id} auditId={auditQ?.id ?? null} auditFinalise={auditQ?.statut === "finalise"} emailContact={c.emailContact} prevues={questionsPrevues} editable={editable}
            liste={questionnairesClient.map((q) => ({ id: q.id, statut: q.statut, email: q.email, lien: q.lien, questions: q.questions, envoyeLe: iso(q.envoyeLe), ouvertLe: iso(q.ouvertLe), reponduLe: iso(q.reponduLe), relance1Le: iso(q.relance1Le), relance2Le: iso(q.relance2Le), expireLe: q.expireLe.toISOString(), createdAt: q.createdAt.toISOString(), reponses: q.reponses.map((r) => ({ critereId: r.critereId, reponse: r.reponse, commentaire: r.commentaire })) }))} />
          <section className="carte flex flex-wrap items-center justify-between gap-3 p-4" aria-labelledby="rdv-titre">
            <div>
              <h2 id="rdv-titre" className="text-lg">Restitution au client</h2>
              <p className="text-sm text-gris-texte">
                {restit.rdvs[0] ? <><CalendarClock size={13} className="inline" aria-hidden /> RDV {restit.rdvs[0].date && restit.rdvs[0].date > new Date() ? "prévu" : "passé"} le {restit.rdvs[0].date ? fmtDateHeure(restit.rdvs[0].date) : "—"}. </> : "Aucun rendez-vous enregistré. "}
                {restit.envois[0] ? <><Send size={13} className="inline" aria-hidden /> Dernier envoi le {fmtDate(restit.envois[0].createdAt)} à {restit.envois[0].destinataires}.</> : "Rien n'a encore été envoyé au client."}
              </p>
            </div>
            <Link href={`/clients/${c.id}/restitution`} className="btn-primaire"><FileText size={15} aria-hidden /> Préparer le RDV</Link>
          </section>
        </>
      )}

      {!m ? (
        <p className="carte p-6 text-gris-texte">Aucun indicateur : ce compte n&apos;a pas de dossiers dans l&apos;export importé.</p>
      ) : (
        <>
          <section aria-label="Indicateurs" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Score santé" valeur={<SanteJauge sante={m.sante} />} sous={m.segment}
              definition="Score /100 calculé uniquement à partir des données SpeedResa : dynamique 35, activité 25, usage 20, qualité 20. Champion ≥ 65, À activer 45–64, À risque < 45." />
            <Kpi label="Volume 12 mois" valeur={fmtEurCompact(m.volume_12m)} sous={<>dont confirmé {fmtEurCompact(m.va_confirme_12m)}</>}
              definition="Somme du « Total du dossier » sur les 365 jours avant la date de référence, hors annulations. Confirmé : Validée, Enregistrée, En Cours, Attente règlement." />
            <Kpi label="Évolution 90 j" valeur={<Evol x={m.evol_90j} />} sous={<>{fmtEurCompact(m.volume_90j)} vs {fmtEurCompact(m.volume_90j_n1)}</>}
              definition="Volume des 90 jours avant la date de référence comparé à la même fenêtre un an plus tôt (neutralise la saisonnalité)." />
            <Kpi label="30 derniers jours" valeur={<Evol x={m.evol_30j_vs_3m} />} sous={<>{fmtEurCompact(m.volume_30j)} vs {fmtEurCompact(m.moyenne_mensuelle_3m)}/mois</>}
              definition="Volume des 30 derniers jours comparé à la moyenne mensuelle des 90 jours précédents." />
            <Kpi label="Transformation" valeur={fmtPct(m.transformation, false, 1)} sous={<>{fmtNb(m.confirmes_12m)} confirmés / {fmtNb(m.dossiers_12m)} dossiers</>}
              definition="Dossiers confirmés ÷ dossiers créés sur 12 mois. Usage « Réservation en ligne » à partir de 20 %." />
            <Kpi label="Potentiel capté" valeur={fmtPct(m.part_captee, false, 2)} sous={<>VA estimé {fmtEurCompact(m.va_global_estime)}</>}
              definition="Volume 12 mois ÷ volume d'affaires global estimé de l'entreprise (onglet « VA annualisé »)." />
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="carte p-4 lg:col-span-2" aria-labelledby="perf-titre">
              <h2 id="perf-titre" className="text-lg">Performance mensuelle</h2>
              <MonthlyChart data={mois.map((x) => ({ mois: x.mois, volume: x.volume, confirme: x.confirme, visites: x.visites }))} reference={snap!.reference} />
              <TraficConversion m={m} />
            </section>
            <section className="carte p-4" aria-labelledby="sante-titre">
              <h2 id="sante-titre" className="text-lg">Score santé détaillé</h2>
              <ul className="mt-3 space-y-3">
                {S.map((s) => (
                  <li key={s.label} title={s.def}>
                    <div className="flex justify-between text-sm"><span className="font-semibold">{s.label}</span><span className="tabular-nums">{fmtNb(Math.round((s.v ?? 0) * 10) / 10)} / {s.max}</span></div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-gris-clair" aria-hidden><div className="h-full bg-horizon" style={{ width: `${((s.v ?? 0) / s.max) * 100}%` }} /></div>
                    <p className="mt-0.5 text-xs text-gris-texte">{s.def}</p>
                  </li>
                ))}
              </ul>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-gris-texte">Dernier dossier</dt><dd>{fmtDate(m.dernier_dossier)} ({m.jours_sans_dossier} j)</dd>
                <dt className="text-gris-texte">Dossiers 90 j</dt><dd>{fmtNb(m.dossiers_90j)}</dd>
                <dt className="text-gris-texte">Erreurs RésaLive</dt><dd>{fmtPct(m.taux_erreur_resalive, false, 1)} <span className="text-gris-texte">({m.resalive_12m} RésaLive)</span></dd>
                <dt className="text-gris-texte">Annulations</dt><dd>{fmtPct(m.taux_annulation, false, 1)}</dd>
                <dt className="text-gris-texte">Depuis janvier</dt><dd>{fmtEur(m.volume_ytd)} <span className="text-gris-texte">vs {fmtEur(m.volume_ytd_n1)}</span></dd>
              </dl>
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="carte p-4" aria-labelledby="alertes-titre">
              <h2 id="alertes-titre" className="text-lg">Alertes</h2>
              {m.alertes.length ? (
                <ul className="mt-3 space-y-2">
                  {m.alertes.map((a) => (
                    <li key={a.code} className="flex items-start gap-2 text-sm"><RisqueBadge risque={a.niveau === "critique" ? "Critique" : "À surveiller"} /><span>{a.message}</span></li>
                  ))}
                </ul>
              ) : <p className="mt-3 text-sm text-gris-texte">Aucune alerte.</p>}
              {hist.some((h) => h.closeLe) && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-horizon">Historique des alertes</summary>
                  <ul className="mt-2 space-y-1 text-gris-texte">
                    {hist.map((h) => <li key={h.id}>{fmtDate(h.ouverteLe)} {h.closeLe ? `→ ${fmtDate(h.closeLe)}` : "(en cours)"} — {h.message}</li>)}
                  </ul>
                </details>
              )}
            </section>
            <section className="carte p-4" aria-labelledby="opp-titre">
              <h2 id="opp-titre" className="text-lg">Opportunités</h2>
              {m.opportunites.length ? (
                <ul className="mt-3 space-y-2 text-sm">
                  {m.opportunites.map((o) => <li key={o.code}><strong className="text-horizon">{o.libelle}</strong> — {o.detail}</li>)}
                </ul>
              ) : <p className="mt-3 text-sm text-gris-texte">Aucune opportunité détectée sur les données. Les pistes issues de l&apos;audit sont dans le plan d&apos;action.</p>}
            </section>
          </div>
        </>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="carte p-4" aria-labelledby="infos-titre">
          <h2 id="infos-titre" className="text-lg">Informations du compte</h2>
          <InfosClientForm editable={editable} groupes={tousGroupes.map((g) => g.nom).sort()} modeles={modeles}
            client={{ id: c.id, nom: c.nom, groupe: grp[0]?.nom ?? null, modele: c.modele, vaCompteeDansTotaux: c.vaCompteeDansTotaux, csmId: c.csmId, emailContact: c.emailContact, echeanceContrat: c.echeanceContrat, vaGlobalEstime: c.vaGlobalEstime, googlePlaceId: c.googlePlaceId, interlocuteurDigital: c.interlocuteurDigital }}
            csms={csms.map((u) => ({ id: u.id, nom: u.nom || u.email }))} />
        </section>
        <section className="carte p-4" aria-labelledby="urls-titre">
          <h2 id="urls-titre" className="text-lg">Sites web</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {urls.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2">
                <a href={u.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-horizon hover:underline">{u.url} <ExternalLink size={12} aria-hidden /></a>
                <span className="flex items-center gap-2">
                  {u.principale && <span className="rounded-full bg-gris-clair px-2 text-xs">principal</span>}
                  {editable && (
                    <form action={supprimerUrl}>
                      <input type="hidden" name="id" value={c.id} /><input type="hidden" name="urlId" value={u.id} />
                      <button className="rounded p-1 text-gris-texte hover:text-rouge-texte" aria-label={`Retirer ${u.url}`}><Trash2 size={14} /></button>
                    </form>
                  )}
                </span>
              </li>
            ))}
            {!urls.length && <li className="text-gris-texte">Aucune URL renseignée : elle sera demandée au lancement du pré-audit.</li>}
          </ul>
          {editable && (
            <form action={ajouterUrl} className="mt-3 flex gap-2">
              <input type="hidden" name="id" value={c.id} />
              <label className="sr-only" htmlFor="new-url">Ajouter une URL</label>
              <input id="new-url" name="url" placeholder="https://www.exemple.fr" className="champ" />
              <button className="btn-secondaire">Ajouter</button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
