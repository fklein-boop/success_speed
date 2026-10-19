"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { AuditError } from "@/lib/server/audits";
import { creerCritere, ecrireParametre, empreintes, supprimerParametre, versionnerCritere, type PatchCritere } from "@/lib/server/parametres";
import { recomputeAll } from "@/lib/server/recompute";
import { planifierRescanMensuel, traiterFileScans } from "@/lib/server/scans";
import { effacerGa4, enregistrerConfigGa4 } from "@/lib/server/ga4";
import { DEFAULT_METRICS_PARAMS } from "@/lib/metrics/params";
import { GROUPES_PARAMS, depuisSaisie } from "@/lib/metrics/libelles";
import offresConfig from "../../../../config/offres.json";

type Etat = { ok?: boolean; message?: string; erreur?: string } | null;
const admin = () => assertUser(["superadmin"]);
const erreur = (e: unknown): Etat => ({ erreur: e instanceof AuditError || e instanceof Error ? e.message : "Erreur inattendue" });
const nombre = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim().replace(",", "."); return s === "" ? null : Number(s); };
const texte = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };

// ───────── Critères ─────────

function lirePatch(form: FormData): PatchCritere {
  const type = String(form.get("type")) === "Seuil" ? "Seuil" : "Oui/Non";
  return {
    pilier: String(form.get("pilier") ?? "").trim(), critere: String(form.get("critere") ?? "").trim(), commentVerifier: texte(form.get("commentVerifier")),
    source: String(form.get("source") ?? "").trim(), type, sens: type === "Seuil" ? texte(form.get("sens")) : null,
    seuilPlein: type === "Seuil" ? nombre(form.get("seuilPlein")) : null, seuilMoitie: type === "Seuil" ? nombre(form.get("seuilMoitie")) : null,
    unite: texte(form.get("unite")), points: Number(form.get("points")), obligationLegale: form.get("obligationLegale") === "on",
    offreSiNon: texte(form.get("offreSiNon")), questionClient: texte(form.get("questionClient")), actif: form.get("actif") === "on",
  };
}

export async function majCritereAction(_: Etat, form: FormData): Promise<Etat> {
  const u = await admin();
  try {
    const p = lirePatch(form);
    if (!p.critere || !p.pilier || !p.source) return { erreur: "Pilier, libellé et source sont obligatoires." };
    const r = await versionnerCritere(await getDb(), String(form.get("id")), p, u.id);
    revalidatePath("/admin"); revalidatePath("/criteres");
    return { ok: true, message: r.inchange ? "Aucune modification." : `Enregistré : version ${r.version}. Les audits passés gardent la version précédente.` };
  } catch (e) { return erreur(e); }
}

export async function creerCritereAction(_: Etat, form: FormData): Promise<Etat> {
  const u = await admin();
  try {
    const p = lirePatch(form);
    const id = String(form.get("id") ?? "").trim().toUpperCase();
    if (!p.critere || !p.pilier || !p.source) return { erreur: "Pilier, libellé et source sont obligatoires." };
    await creerCritere(await getDb(), { id, pilier: p.pilier!, critere: p.critere!, commentVerifier: p.commentVerifier ?? null, source: p.source!, type: p.type!, sens: p.sens ?? null, seuilPlein: p.seuilPlein ?? null, seuilMoitie: p.seuilMoitie ?? null, unite: p.unite ?? null, points: p.points!, obligationLegale: !!p.obligationLegale, offreSiNon: p.offreSiNon ?? null, questionClient: p.questionClient ?? null }, u.id);
    revalidatePath("/admin"); revalidatePath("/criteres");
    return { ok: true, message: `Critère ${id} créé.` };
  } catch (e) { return erreur(e); }
}

// ───────── Paramètres de calcul ─────────

export async function majParametresAction(_: Etat, form: FormData): Promise<Etat> {
  const u = await admin();
  const surcharge: Record<string, unknown> = {};
  for (const g of GROUPES_PARAMS) {
    for (const [k, , unite] of g.params) {
      const v = nombre(form.get(`${g.cle}.${k}`));
      if (v === null || !Number.isFinite(v)) return { erreur: `Valeur invalide : ${k}` };
      const val = depuisSaisie(v, unite);
      const defaut = g.cle ? (DEFAULT_METRICS_PARAMS as unknown as Record<string, Record<string, number>>)[g.cle][k] : (DEFAULT_METRICS_PARAMS as unknown as Record<string, number>)[k];
      if (Math.abs(val - defaut) < 1e-9) continue;
      if (g.cle) surcharge[g.cle] = { ...(surcharge[g.cle] as object ?? {}), [k]: val };
      else surcharge[k] = val;
    }
  }
  const db = await getDb();
  if (Object.keys(surcharge).length) await ecrireParametre(db, "metrics", surcharge, u.id);
  else await supprimerParametre(db, "metrics", u.id);
  await recomputeAll(db);
  revalidatePath("/", "layout");
  return { ok: true, message: "Paramètres enregistrés : indicateurs, scores, alertes et opportunités recalculés." };
}

export async function reinitialiserParametresAction(): Promise<Etat> {
  const u = await admin();
  const db = await getDb();
  await supprimerParametre(db, "metrics", u.id);
  await recomputeAll(db);
  revalidatePath("/", "layout");
  return { ok: true, message: "Valeurs d'origine rétablies et portefeuille recalculé." };
}

// ───────── Offres et effort ─────────

export async function majEffortsAction(_: Etat, form: FormData): Promise<Etat> {
  const u = await admin();
  const defaut = offresConfig.efforts as Record<string, string>;
  const surcharge: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("effort:")) continue;
    const offre = k.slice(7), e = String(v);
    if (!["faible", "moyen", "fort"].includes(e)) return { erreur: "Effort invalide." };
    if (defaut[offre] !== e) surcharge[offre] = e;
  }
  await ecrireParametre(await getDb(), "offres_efforts", surcharge, u.id);
  revalidatePath("/admin/offres");
  return { ok: true, message: `Efforts enregistrés (${Object.keys(surcharge).length} différent(s) de l'estimation d'origine). Les plans d'action proposés en tiennent compte.` };
}

// ───────── Empreintes TECH-06 ─────────

const Ligne = z.object({ nom: z.string().trim().min(1).max(120), motif: z.string().trim().min(3).max(200), force: z.enum(["forte", "moyenne"]).optional() });

export async function majEmpreintesAction(_: Etat, form: FormData): Promise<Etat> {
  const u = await admin();
  const lire = (prefixe: string, avecForce: boolean) => {
    const out: z.infer<typeof Ligne>[] = [];
    for (let i = 0; i < 100; i++) {
      const nom = String(form.get(`${prefixe}.${i}.nom`) ?? "").trim(), motif = String(form.get(`${prefixe}.${i}.motif`) ?? "").trim();
      if (!nom && !motif) continue;
      const l = Ligne.safeParse({ nom, motif, ...(avecForce ? { force: String(form.get(`${prefixe}.${i}.force`) ?? "moyenne") } : {}) });
      if (!l.success) throw new AuditError(`Ligne ${i + 1} (${prefixe === "sr" ? "SpeedResa" : "concurrents"}) : nom et motif (3 caractères minimum) obligatoires.`);
      out.push(l.data);
    }
    return out;
  };
  try {
    const valeur = { a_valider: form.get("a_valider") === "on", speedresa: lire("sr", true), concurrents: lire("cc", false) };
    if (!valeur.speedresa.length) return { erreur: "Au moins une empreinte SpeedResa est nécessaire." };
    await ecrireParametre(await getDb(), "empreintes", valeur, u.id);
    revalidatePath("/admin/empreintes");
    return { ok: true, message: "Empreintes enregistrées : elles s'appliquent aux prochains scans." };
  } catch (e) { return erreur(e); }
}

export async function reinitialiserEmpreintesAction(): Promise<Etat> {
  const u = await admin();
  await supprimerParametre(await getDb(), "empreintes", u.id);
  revalidatePath("/admin/empreintes");
  return { ok: true, message: `Empreintes d'origine rétablies (${(await empreintes(await getDb())).speedresa.length} SpeedResa).` };
}

// ───────── Textes légaux ─────────

export async function majReferencesAction(_: Etat, form: FormData): Promise<Etat> {
  const u = await admin();
  const valeur: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k.startsWith("ref:") && String(v).trim()) valeur[k.slice(4)] = String(v).trim().slice(0, 1500);
  await ecrireParametre(await getDb(), "references_legales", valeur, u.id);
  revalidatePath("/admin/textes-legaux");
  return { ok: true, message: "Références enregistrées : elles s'appliquent aux alertes légales et aux restitutions." };
}

// ───────── Scans planifiés ─────────

export async function lancerRescanAction(): Promise<Etat> {
  await admin();
  const db = await getDb();
  const r = await planifierRescanMensuel(db);
  // Sans worker, la file est traitée en arrière-plan (puis chaque jour par la tâche planifiée)
  if (process.env.SCAN_MODE !== "worker") after(async () => { await traiterFileScans(await getDb(), 280_000).catch(() => null); });
  revalidatePath("/admin/supervision");
  return { ok: true, message: `${r.crees} scan(s) léger(s) mis en file${r.ignores ? `, ${r.ignores} ignoré(s) (scan déjà en cours ou URL refusée)` : ""}.` };
}

// ───────── Clients ─────────

export async function creerClientAction(_: Etat, form: FormData): Promise<Etat> {
  const u = await admin();
  const { NouveauClient, creerClient } = await import("@/lib/server/clients-admin");
  const p = NouveauClient.safeParse({ ...Object.fromEntries(form), vaCompteeDansTotaux: form.get("vaCompteeDansTotaux") === "on" });
  if (!p.success) return { erreur: p.error.issues[0]?.message ?? "Formulaire incomplet." };
  try {
    const r = await creerClient(await getDb(), p.data, u.id);
    revalidatePath("/", "layout");
    return { ok: true, message: `Client ${r.id} créé${r.dossiers ? ` (${r.dossiers} dossiers déjà importés, indicateurs calculés)` : " : il sera noté dès ses premiers dossiers"}.` };
  } catch (e) { return erreur(e); }
}

export async function activerClientAction(id: string, actif: boolean): Promise<Etat> {
  const u = await admin();
  const { activerClient } = await import("@/lib/server/clients-admin");
  await activerClient(await getDb(), id, actif, u.id);
  revalidatePath("/", "layout");
  return { ok: true, message: actif ? "Client réactivé." : "Client désactivé : il n'apparaît plus dans le portefeuille." };
}

// ───────── Google Analytics 4 ─────────

export async function configGa4Action(_: Etat, form: FormData): Promise<Etat> {
  const u = await admin();
  try {
    const dimension = texte(form.get("dimension"));
    const nom = dimension ? texte(form.get(`nom.${dimension}`)) : null;
    await enregistrerConfigGa4(await getDb(), u.id, {
      propertyId: texte(form.get("propertyId")), dimension, dimensionNom: nom,
      evenementDebut: texte(form.get("evenementDebut")) ?? "begin_checkout", evenementAchat: texte(form.get("evenementAchat")) ?? "purchase",
    });
    revalidatePath("/admin/google-analytics");
    return { ok: true, message: "Configuration enregistrée." };
  } catch (e) { return erreur(e); }
}

export async function effacerGa4Action(): Promise<Etat> {
  const u = await admin();
  await effacerGa4(await getDb(), u.id);
  revalidatePath("/admin/google-analytics");
  return { ok: true, message: "Mesures Google Analytics supprimées. Réimportez le fichier GTM si besoin." };
}
