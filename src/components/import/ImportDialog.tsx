"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload, X } from "lucide-react";
import { CHAMPS, detectColumns, normalizeHeader, rowsToDossiers, type Champ, type Mapping } from "@/lib/import/dossiers";
import { readTabularFile, type Sheet } from "@/lib/import/read-file";
import { COLONNES, LIBELLES_TYPE, colonnesBackoffice, ligneEntete, lireLignesBackoffice, typeDeFichier, type LigneBackoffice, type MappingBo, type TypeBackoffice } from "@/lib/import/backoffice";
import type { ImportPreview } from "@/lib/server/imports";
import { fmtDate, fmtNb } from "@/lib/format";

type Etape =
  | { e: "choisir" }
  | { e: "lecture"; message: string; progression?: number }
  | { e: "correspondance"; sheet: Sheet; mapping: Mapping; manquants: Champ[]; fichier: string }
  | { e: "correspondanceBo"; type: TypeBackoffice; headers: unknown[]; mapping: MappingBo; manquants: string[]; fichier: string; resoudre: (m: MappingBo) => void }
  | { e: "apercu"; preview: ImportPreview | null }
  | { e: "application"; message?: string }
  | { e: "termine"; nouveaux: number; modifies: number; emailEnvoye: boolean; reference: string | null; exports: string[] }
  | { e: "erreur"; message: string };

/** Export back-office lu dans le navigateur, en attente de validation */
interface ExportLu { fichier: string; type: TypeBackoffice; lignes: LigneBackoffice[]; ignorees: number; absentes: string[]; apercu: ApercuExport }
interface ApercuExport { libelle: string; lignes: number; clients: number; nbInconnues: number; agencesInconnues: string[]; periode: { debut: string; fin: string } | null }

async function api<T>(url: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.erreur ?? `Erreur ${res.status}`);
  return json as T;
}

export interface ClientOption { id: string; nom: string }

export function ImportDialog({ files, onClose, clients }: { files: File[]; onClose: () => void; clients: ClientOption[] }) {
  const router = useRouter();
  const [etape, setEtape] = useState<Etape>({ e: "choisir" });
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [exportsLus, setExportsLus] = useState<ExportLu[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const importId = useRef<number | null>(null);

  /** Envoie l'export dossiers en zone d'attente et renvoie l'aperçu (fusion à la validation). */
  const envoyer = useCallback(async (sheet: Sheet, mapping: Mapping, fichier: string) => {
    setEtape({ e: "lecture", message: "Analyse des dossiers…" });
    const { dossiers, anomalies, periode } = rowsToDossiers(sheet.rows, mapping);
    if (!dossiers.length) throw new Error("Aucun dossier lisible dans ce fichier.");
    const { id } = await api<{ id: number }>("/api/imports", { fichier, feuille: sheet.nomFeuille, lignesLues: sheet.rows.length, periode, anomalies });
    importId.current = id;
    const taille = 5000;
    for (let i = 0; i < dossiers.length; i += taille) {
      setEtape({ e: "lecture", message: `Envoi des dossiers… ${fmtNb(Math.min(i + taille, dossiers.length))} / ${fmtNb(dossiers.length)}`, progression: i / dossiers.length });
      await api(`/api/imports/${id}/rows`, { rows: dossiers.slice(i, i + taille) });
    }
    setEtape({ e: "lecture", message: "Comparaison avec les données existantes…", progression: 1 });
    const preview = await api<ImportPreview>(`/api/imports/${id}`);
    const init: Record<string, string> = {};
    for (const a of preview.agencesInconnues) init[a.idAgence] = "creer";
    setDecisions(init);
    return preview;
  }, []);

  /** Lit un export back-office : correspondance des colonnes (mémorisée) puis aperçu côté serveur. */
  const lireBackoffice = useCallback(async (f: File, type: TypeBackoffice): Promise<ExportLu> => {
    const texte = await f.arrayBuffer();
    const brut = await readTabularFile(f.name, texte);
    // readTabularFile cherche l'en-tête de l'export dossiers : on la recherche à nouveau (IDagence)
    const matrice = [brut.headers, ...brut.rows];
    const h = ligneEntete(matrice);
    const headers = matrice[h] ?? [], rows = matrice.slice(h + 1);
    const saved = await api<{ mapping: Record<string, string> }>(`/api/imports/mapping?type=${type}`);
    let { mapping, manquants, absentes } = colonnesBackoffice(type, headers, saved.mapping);
    if (manquants.length) {
      mapping = await new Promise<MappingBo>((resoudre) => setEtape({ e: "correspondanceBo", type, headers, mapping, manquants, fichier: f.name, resoudre }));
      absentes = absentes.filter((c) => mapping[c] === undefined);
    }
    setEtape({ e: "lecture", message: `Lecture de ${f.name} (${LIBELLES_TYPE[type]})…` });
    const { lignes, ignorees } = lireLignesBackoffice(type, rows, mapping);
    if (!lignes.length) throw new Error(`${f.name} : aucune ligne lisible (${LIBELLES_TYPE[type]}).`);
    const apercu = await api<ApercuExport>("/api/backoffice/apercu", { type, lignes: lignes.map((l) => ({ idAgence: l.idAgence, date: typeof l.date === "string" ? l.date : null })) });
    return { fichier: f.name, type, lignes, ignorees, absentes, apercu };
  }, []);

  const lire = useCallback(async (liste: File[]) => {
    try {
      if (!liste.length) return;
      const bad = liste.find((f) => !/\.(xlsx|xls|csv|txt)$/i.test(f.name));
      if (bad) throw new Error(`Format non reconnu (${bad.name}) : déposez des fichiers .xlsx ou .csv.`);
      let preview: ImportPreview | null = null;
      const lus: ExportLu[] = [];
      let dossiersVu = false;
      for (const f of liste) {
        setEtape({ e: "lecture", message: `Lecture de ${f.name}…` });
        const sheet = await f.arrayBuffer().then((b) => readTabularFile(f.name, b));
        const type = typeDeFichier(sheet.headers);
        if (type === "dossiers") {
          if (dossiersVu) throw new Error("Deux exports dossiers déposés : gardez-en un seul.");
          dossiersVu = true;
          const saved = await api<{ mapping: Record<string, Champ> }>("/api/imports/mapping");
          const { mapping, manquants } = detectColumns(sheet.headers, saved.mapping);
          if (manquants.length) {
            const m = await new Promise<Mapping>((resoudre) => { resoudreDossiers.current = resoudre; setEtape({ e: "correspondance", sheet, mapping, manquants, fichier: f.name }); });
            preview = await envoyer(sheet, m, f.name);
          } else preview = await envoyer(sheet, mapping, f.name);
        } else if (type) {
          if (lus.some((x) => x.type === type)) throw new Error(`Deux fichiers « ${LIBELLES_TYPE[type]} » déposés : gardez-en un seul.`);
          lus.push(await lireBackoffice(f, type));
        } else {
          throw new Error(`${f.name} : type d'export non reconnu. Attendu : export dossiers, catalogue, configuration, connexions ou PayBox (colonnes décrites dans 08_DEMANDES_EQUIPES_EXPORTS).`);
        }
      }
      setExportsLus(lus);
      setEtape({ e: "apercu", preview });
    } catch (err) {
      setEtape({ e: "erreur", message: err instanceof Error ? err.message : "Lecture impossible" });
    }
  }, [envoyer, lireBackoffice]);
  const resoudreDossiers = useRef<((m: Mapping) => void) | null>(null);

  const lu = useRef<File[] | null>(null);
  useEffect(() => {
    // Garde : en développement, React exécute les effets deux fois
    if (files.length && lu.current !== files) { lu.current = files; void lire(files); }
  }, [files, lire]);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") fermer(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fermer() {
    if (importId.current && etape.e !== "termine") {
      await api(`/api/imports/${importId.current}/abandon`, {}).catch(() => {});
    }
    onClose();
  }

  async function valider(preview: ImportPreview | null) {
    setEtape({ e: "application" });
    try {
      // 1. Exports back-office, par morceaux
      for (const x of exportsLus) {
        let id: number | undefined;
        for (let i = 0; i < x.lignes.length; i += 2000) {
          setEtape({ e: "application", message: `${x.apercu.libelle} : ${fmtNb(Math.min(i + 2000, x.lignes.length))} / ${fmtNb(x.lignes.length)} lignes…` });
          const r = await api<{ importId: number }>("/api/backoffice/appliquer", { type: x.type, fichier: x.fichier, importId: id, lignes: x.lignes.slice(i, i + 2000) });
          id = r.importId;
        }
      }
      const faits = exportsLus.map((x) => `${x.apercu.libelle} (${fmtNb(x.lignes.length)} lignes)`);
      // 2. Export dossiers (recalcule tout le portefeuille), sinon simple recalcul
      if (preview) {
        setEtape({ e: "application" });
        const creer = Object.entries(decisions).filter(([, v]) => v === "creer").map(([k]) => k);
        const rattacher = Object.fromEntries(Object.entries(decisions).filter(([, v]) => v.startsWith("client:")).map(([k, v]) => [k, v.slice(7)]));
        const res = await api<{ nouveaux: number; modifies: number; emailEnvoye: boolean; diff: { reference: string | null } }>(`/api/imports/${preview.id}/apply`, { creer, rattacher });
        importId.current = null;
        setEtape({ e: "termine", nouveaux: res.nouveaux, modifies: res.modifies, emailEnvoye: res.emailEnvoye, reference: res.diff.reference, exports: faits });
      } else {
        setEtape({ e: "application", message: "Recalcul des alertes du portefeuille…" });
        await api("/api/backoffice/terminer", {});
        setEtape({ e: "termine", nouveaux: 0, modifies: 0, emailEnvoye: false, reference: null, exports: faits });
      }
      router.refresh();
    } catch (err) {
      setEtape({ e: "erreur", message: err instanceof Error ? err.message : "Échec de l'import" });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-minuit/60 p-4" role="presentation">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="import-titre" className="carte max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6 shadow-xl outline-none">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="import-titre" className="text-xl">Mettre à jour les chiffres</h2>
          <button onClick={fermer} className="btn-discret -mr-2 -mt-1" aria-label="Fermer"><X size={18} /></button>
        </div>

        {etape.e === "choisir" && (
          <div>
            <label
              className="flex cursor-pointer flex-col items-center gap-3 rounded-carte border-2 border-dashed border-horizon/40 bg-horizon/5 p-10 text-center hover:bg-horizon/10"
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={(ev) => { ev.preventDefault(); const f = Array.from(ev.dataTransfer.files); if (f.length) void lire(f); }}
            >
              <Upload className="text-horizon" size={32} aria-hidden />
              <span className="font-semibold">Déposez l&apos;extract SpeedResa du lundi</span>
              <span className="text-sm text-gris-texte">Et, s&apos;ils sont disponibles, les exports catalogue, configuration, connexions ou PayBox, tous ensemble. Fichiers .xlsx ou .csv — ou cliquez pour les choisir.</span>
              <input ref={inputRef} type="file" multiple accept=".xlsx,.xls,.csv,.txt" className="sr-only" onChange={(ev) => { const f = Array.from(ev.target.files ?? []); if (f.length) void lire(f); }} />
            </label>
            <p className="mt-3 text-xs text-gris-texte">Les fichiers sont lus dans votre navigateur : seules les colonnes utiles sont envoyées (aucune donnée nominative). Le type de chaque fichier est reconnu à ses colonnes.</p>
          </div>
        )}

        {etape.e === "lecture" && (
          <div className="py-8 text-center" role="status" aria-live="polite">
            <FileSpreadsheet className="mx-auto text-horizon" size={32} aria-hidden />
            <p className="mt-3 font-semibold">{etape.message}</p>
            <div className="mx-auto mt-4 h-2 max-w-sm overflow-hidden rounded-full bg-gris-clair">
              <div className="bg-degrade h-full transition-all" style={{ width: `${Math.round((etape.progression ?? 0.1) * 100)}%` }} />
            </div>
          </div>
        )}

        {etape.e === "correspondance" && <Correspondance etape={etape} onValider={async (mapping, memo) => {
          try {
            await api("/api/imports/mapping", { mapping: memo });
            resoudreDossiers.current?.(mapping);
          } catch (err) { setEtape({ e: "erreur", message: err instanceof Error ? err.message : "Erreur" }); }
        }} />}

        {etape.e === "correspondanceBo" && <CorrespondanceBo etape={etape} onValider={async (mapping, memo) => {
          try {
            await api(`/api/imports/mapping?type=${etape.type}`, { mapping: memo });
            etape.resoudre(mapping);
          } catch (err) { setEtape({ e: "erreur", message: err instanceof Error ? err.message : "Erreur" }); }
        }} />}

        {etape.e === "apercu" && (
          <>
            {etape.preview && <Apercu preview={etape.preview} clients={clients} decisions={decisions} setDecisions={setDecisions} />}
            {exportsLus.length > 0 && <ApercuExports exports={exportsLus} />}
            <div className="mt-6 flex justify-end gap-3">
              <button className="btn-discret" onClick={fermer}>Abandonner</button>
              <button className="btn-primaire" onClick={() => valider(etape.preview)} autoFocus>Valider l&apos;import →</button>
            </div>
          </>
        )}

        {etape.e === "application" && (
          <div className="py-8 text-center" role="status" aria-live="polite">
            <p className="font-semibold">{etape.message ?? "Fusion des dossiers et recalcul du portefeuille…"}</p>
            <p className="mt-1 text-sm text-gris-texte">Scores santé, alertes et opportunités sont recalculés pour tous les clients.</p>
          </div>
        )}

        {etape.e === "termine" && (
          <div className="py-6 text-center" role="status">
            <CheckCircle2 className="mx-auto text-emeraude" size={40} aria-hidden />
            {etape.reference ? (
              <>
                <p className="mt-3 text-lg font-semibold">Chiffres à jour — données au {fmtDate(etape.reference)}</p>
                <p className="mt-1 text-sm text-gris-texte">{fmtNb(etape.nouveaux)} nouveaux dossiers, {fmtNb(etape.modifies)} mis à jour. {etape.emailEnvoye ? "L'email récapitulatif est parti." : "L'email récapitulatif n'a pas pu être envoyé."}</p>
              </>
            ) : <p className="mt-3 text-lg font-semibold">Exports enregistrés</p>}
            {etape.exports.length > 0 && <p className="mt-1 text-sm text-gris-texte">{etape.exports.join(" · ")}. Les critères correspondants se rempliront à la prochaine ouverture des audits.</p>}
            <button className="btn-primaire mt-6" onClick={onClose}>Voir le portefeuille →</button>
          </div>
        )}

        {etape.e === "erreur" && (
          <div className="py-6">
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-rouge/40 bg-rouge/5 p-4 text-sm text-rouge-texte">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden /> {etape.message}
            </p>
            <button className="btn-secondaire mt-4" onClick={() => { importId.current = null; setExportsLus([]); setEtape({ e: "choisir" }); }}>Réessayer</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Correspondance des colonnes d'un export back-office (mémorisée pour les prochains imports). */
function CorrespondanceBo({ etape, onValider }: {
  etape: Extract<Etape, { e: "correspondanceBo" }>;
  onValider: (m: MappingBo, memo: Record<string, string>) => void;
}) {
  const champs = Object.entries(COLONNES[etape.type]).filter(([ch]) => etape.mapping[ch] === undefined);
  const [choix, setChoix] = useState<Record<string, number | undefined>>({});
  const complet = etape.manquants.every((c) => choix[c] !== undefined);
  return (
    <div>
      <p className="text-sm"><strong>{etape.fichier}</strong> est reconnu comme « {LIBELLES_TYPE[etape.type]} », mais certaines colonnes n&apos;ont pas été trouvées. Indiquez la colonne correspondante (les champs marqués * sont indispensables) : ce choix sera mémorisé.</p>
      <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto">
        {champs.map(([ch, def]) => (
          <div key={ch} className="grid grid-cols-2 items-center gap-3">
            <label htmlFor={`bo-${ch}`} className="text-sm font-semibold">{def.label}{etape.manquants.includes(ch) ? " *" : ""}</label>
            <select id={`bo-${ch}`} className="champ" value={choix[ch] ?? ""} onChange={(ev) => setChoix({ ...choix, [ch]: ev.target.value === "" ? undefined : Number(ev.target.value) })}>
              <option value="">— Absente —</option>
              {etape.headers.map((h, i) => <option key={i} value={i}>{String(h ?? `Colonne ${i + 1}`)}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <button className="btn-primaire" disabled={!complet} onClick={() => {
          const pris = Object.fromEntries(Object.entries(choix).filter(([, v]) => v !== undefined)) as Record<string, number>;
          const memo: Record<string, string> = {};
          for (const [ch, i] of Object.entries(pris)) memo[normalizeHeader(etape.headers[i])] = ch;
          onValider({ ...etape.mapping, ...pris }, memo);
        }}>Continuer →</button>
      </div>
    </div>
  );
}

/** Récapitulatif des exports back-office déposés avec (ou sans) l'export dossiers. */
function ApercuExports({ exports }: { exports: ExportLu[] }) {
  return (
    <div className="mt-5">
      <h3 className="libelle">Exports back-office</h3>
      <ul className="mt-2 space-y-2">
        {exports.map((x) => (
          <li key={x.type} className="rounded-lg bg-gris-clair/60 p-3 text-sm">
            <p><strong>{x.apercu.libelle}</strong> · {x.fichier}</p>
            <p className="text-gris-texte">
              {fmtNb(x.lignes.length)} lignes, {x.apercu.clients} client(s) reconnu(s){x.apercu.periode ? `, du ${fmtDate(x.apercu.periode.debut)} au ${fmtDate(x.apercu.periode.fin)}` : ""}.
              {x.apercu.nbInconnues ? ` ${x.apercu.nbInconnues} agence(s) inconnue(s), ignorée(s) dans les audits : ${x.apercu.agencesInconnues.slice(0, 8).join(", ")}${x.apercu.nbInconnues > 8 ? "…" : ""}.` : ""}
              {x.ignorees ? ` ${x.ignorees} ligne(s) illisible(s) ignorée(s).` : ""}
              {x.absentes.length ? ` Colonnes absentes : ${x.absentes.map((c) => COLONNES[x.type][c].label).join(", ")}.` : ""}
            </p>
            {(x.type === "catalogue" || x.type === "configuration") && <p className="mt-1 text-xs text-gris-texte">Photo complète : elle remplacera l&apos;export précédent.</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Correspondance({ etape, onValider }: {
  etape: Extract<Etape, { e: "correspondance" }>;
  onValider: (m: Mapping, memo: Record<string, Champ>) => void;
}) {
  const [choix, setChoix] = useState<Partial<Record<Champ, number>>>({});
  const complet = etape.manquants.every((c) => choix[c] !== undefined);
  return (
    <div>
      <p className="text-sm">Certaines colonnes attendues n&apos;ont pas été reconnues dans <strong>{etape.fichier}</strong>. Indiquez la colonne correspondante : ce choix sera mémorisé pour les prochains imports.</p>
      <div className="mt-4 space-y-3">
        {etape.manquants.map((c) => (
          <div key={c} className="grid grid-cols-2 items-center gap-3">
            <label htmlFor={`map-${c}`} className="text-sm font-semibold">{CHAMPS[c].label}</label>
            <select id={`map-${c}`} className="champ" value={choix[c] ?? ""} onChange={(ev) => setChoix({ ...choix, [c]: ev.target.value === "" ? undefined : Number(ev.target.value) })}>
              <option value="">— Choisir —</option>
              {etape.sheet.headers.map((h, i) => <option key={i} value={i}>{String(h ?? `Colonne ${i + 1}`)}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <button className="btn-primaire" disabled={!complet} onClick={() => {
          const memo: Record<string, Champ> = {};
          for (const c of etape.manquants) memo[normalizeHeader(etape.sheet.headers[choix[c]!])] = c;
          onValider({ ...etape.mapping, ...choix }, memo);
        }}>Continuer →</button>
      </div>
    </div>
  );
}

function Apercu({ preview: p, clients, decisions, setDecisions }: {
  preview: ImportPreview; clients: ClientOption[]; decisions: Record<string, string>;
  setDecisions: (d: Record<string, string>) => void;
}) {
  const a = p.anomalies as Record<string, number>;
  const anomalies = [
    a.nbDatesFutures ? `${a.nbDatesFutures} dossier(s) avec une date future (ignorés dans les calculs)` : null,
    a.nbMontantsNegatifs ? `${a.nbMontantsNegatifs} montant(s) négatif(s)` : null,
    a.nbDoublons ? `${a.nbDoublons} doublon(s) d'IDresa dans le fichier (dernière ligne retenue)` : null,
    a.nbLignesIgnorees ? `${a.nbLignesIgnorees} ligne(s) illisible(s) ignorée(s)` : null,
  ].filter(Boolean) as string[];
  return (
    <div>
      <p className="text-base">{p.phrase}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Période", `${fmtDate(p.periode.debut)} → ${fmtDate(p.periode.fin)}`], ["Dossiers lus", fmtNb(p.dossiersLus)], ["Nouveaux", fmtNb(p.nouveaux)], ["Mis à jour", fmtNb(p.modifies)]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-gris-clair/60 p-3"><dt className="libelle">{k}</dt><dd className="mt-1 font-titres text-lg font-bold">{v}</dd></div>
        ))}
      </dl>
      {p.changementsStatut.length > 0 && (
        <div className="mt-4">
          <h3 className="libelle">Changements de statut</h3>
          <ul className="mt-1 text-sm">{p.changementsStatut.slice(0, 6).map((c) => <li key={c.transition}>{c.transition} : {c.nombre}</li>)}</ul>
        </div>
      )}
      {p.agencesInconnues.length > 0 && (
        <div className="mt-4">
          <h3 className="libelle">Agences inconnues</h3>
          <ul className="mt-2 space-y-2">
            {p.agencesInconnues.map((ag) => (
              <li key={ag.idAgence} className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
                <span><strong>{ag.idAgence}</strong> {ag.nomAgence} — {ag.dossiers} dossiers</span>
                <select aria-label={`Que faire de l'agence ${ag.idAgence}`} className="champ w-56" value={decisions[ag.idAgence] ?? "creer"} onChange={(ev) => setDecisions({ ...decisions, [ag.idAgence]: ev.target.value })}>
                  <option value="creer">Créer un nouveau client</option>
                  <option value="ignorer">Ne rien faire pour l&apos;instant</option>
                  <optgroup label="Rattacher à…">{clients.map((c) => <option key={c.id} value={`client:${c.id}`}>{c.nom} ({c.id})</option>)}</optgroup>
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}
      {anomalies.length > 0 && (
        <div className="mt-4 rounded-lg border border-ambre/60 bg-ambre/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} aria-hidden /> Anomalies</p>
          <ul className="mt-1 list-disc pl-6">{anomalies.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
