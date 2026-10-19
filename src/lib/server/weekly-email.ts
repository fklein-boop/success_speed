import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { alertes, clients, users } from "@/db/schema";
import { fmtDate, fmtEurCompact, fmtPct } from "@/lib/format";
import { appUrl } from "./auth";
import { emailLayout, sendEmail } from "./email";
import { loadPortfolio } from "./portfolio";
import { aFaire } from "./pilotage";
import type { RecomputeDiff } from "./recompute";

const liste = (xs: string[], max = 8) => (xs.length > max ? `${xs.slice(0, max).join(" ; ")} et ${xs.length - max} autre(s)` : xs.join(" ; "));

/**
 * Email récapitulatif du lundi, envoyé après l'import (super admins et CSM actifs) :
 * chiffres du portefeuille, nouveaux critiques, chutes, reprises, modules SpeedResa disparus,
 * sites inaccessibles, puis la file « À faire cette semaine » de chaque destinataire.
 */
export async function sendWeeklyEmail(db: DB, diff: RecomputeDiff) {
  const dest = await db.select({ id: users.id, email: users.email, role: users.role }).from(users)
    .where(and(eq(users.actif, true), inArray(users.role, ["superadmin", "csm"])));
  if (!dest.length) return { ok: true };
  const { kpis, reference } = await loadPortfolio(db);
  const semaine = new Date(Date.now() - 7 * 86_400_000);
  const recentes = await db.select({ code: alertes.code, message: alertes.message, nom: clients.nom }).from(alertes)
    .innerJoin(clients, eq(clients.id, alertes.clientId))
    .where(and(isNull(alertes.closeLe), inArray(alertes.code, ["module_absent", "site_indisponible", "legal_non"]), gte(alertes.ouverteLe, semaine)));

  const commun: string[] = [
    `Les chiffres du portefeuille sont à jour (données au ${fmtDate(reference)}).`,
    `Volume 12 mois : ${fmtEurCompact(kpis.volume12)} — dont confirmé ${fmtEurCompact(kpis.confirme12)}. Depuis janvier : ${kpis.evolYtd === null ? "—" : fmtPct(kpis.evolYtd, true)} vs N-1.`,
    `${kpis.critiques} clients critiques, ${kpis.surveiller} à surveiller. Couverture d'audit : ${fmtPct(kpis.couvertureAudit)}.`,
  ];
  if (diff.nouveauxCritiques.length) commun.push(`Nouveaux clients critiques : ${liste(diff.nouveauxCritiques.map((c) => `${c.nom} (${c.alerte})`))}.`);
  if (diff.chutes.length) commun.push(`Chutes du score santé : ${liste(diff.chutes.map((c) => `${c.nom} ${c.avant} → ${c.apres}`))}.`);
  if (diff.reprises.length) commun.push(`Reprises : ${liste(diff.reprises.map((c) => c.nom))} ne sont plus critiques.`);
  const parCode = (code: string) => recentes.filter((r) => r.code === code).map((r) => r.nom);
  if (parCode("module_absent").length) commun.push(`Module SpeedResa disparu ou concurrent détecté cette semaine : ${liste(parCode("module_absent"))}.`);
  if (parCode("site_indisponible").length) commun.push(`Sites inaccessibles : ${liste(parCode("site_indisponible"))}.`);
  if (parCode("legal_non").length) commun.push(`Nouveaux critères légaux à NON : ${liste(parCode("legal_non"))}.`);
  if (commun.length === 3) commun.push("Aucun changement de niveau de risque cette semaine.");

  let ok = true;
  for (const d of dest) {
    // Super admin : file de tout le portefeuille ; CSM : ses clients
    const f = await aFaire(db, d.role === "superadmin" ? null : d.id);
    const perso: string[] = [];
    if (f.critiquesSansRdv.length) perso.push(`Clients critiques sans rendez-vous : ${liste(f.critiquesSansRdv.map((c) => c.nom))}.`);
    if (f.auditsARelancer.length) perso.push(`Audits à relancer : ${liste(f.auditsARelancer.map((c) => c.nom))}.`);
    if (f.questionnairesEnAttente.length) perso.push(`Questionnaires client en attente : ${liste(f.questionnairesEnAttente.map((c) => c.nom))}.`);
    if (f.legauxNonCommuniques.length) perso.push(`Points légaux à NON pas encore communiqués : ${liste(f.legauxNonCommuniques.map((c) => c.nom))}.`);
    const paragraphes = [...commun, ...(perso.length ? [`À faire cette semaine${d.role === "superadmin" ? " (tout le portefeuille)" : ""} :`, ...perso] : ["Rien d'urgent dans votre file cette semaine."])];
    const r = await sendEmail({
      to: d.email,
      subject: `Portefeuille SpeedResa — données au ${fmtDate(reference)}`,
      text: paragraphes.join("\n\n") + `\n\n${appUrl()}`,
      html: emailLayout({ titre: "Votre lundi en un coup d'œil", paragraphes, bouton: { label: "Ouvrir le cockpit", url: appUrl() } }),
    });
    ok &&= r.ok;
  }
  return { ok };
}
