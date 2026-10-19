"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload, X } from "lucide-react";
import { CHAMPS, detectColumns, normalizeHeader, rowsToDossiers, type Champ, type Mapping } from "@/lib/import/dossiers";
import { readTabularFile, type Sheet } from "@/lib/import/read-file";
import type { ImportPreview } from "@/lib/server/imports";
import { fmtDate, fmtNb } from "@/lib/format";

type Etape =
  | { e: "choisir" }
  | { e: "lecture"; message: string; progression?: number }
  | { e: "correspondance"; sheet: Sheet; mapping: Mapping; manquants: Champ[]; fichier: string }
  | { e: "apercu"; preview: ImportPreview }
  | { e: "application" }
  | { e: "termine"; nouveaux: number; modifies: number; emailEnvoye: boolean; reference: string | null }
  | { e: "erreur"; message: string };

async function api<T>(url: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.erreur ?? `Erreur ${res.status}`);
  return json as T;
}

export interface ClientOption { id: string; nom: string }

export function ImportDialog({ file, onClose, clients }: { file: File | null; onClose: () => void; clients: ClientOption[] }) {
  const router = useRouter();
  const [etape, setEtape] = useState<Etape>({ e: "choisir" });
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const importId = useRef<number | null>(null);

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
    setEtape({ e: "apercu", preview });
  }, []);

  const lire = useCallback(async (f: File) => {
    try {
      if (!/\.(xlsx|xls|csv|txt)$/i.test(f.name)) throw new Error("Format non reconnu : déposez un fichier .xlsx ou .csv.");
      setEtape({ e: "lecture", message: `Lecture de ${f.name}…` });
      const [sheet, saved] = await Promise.all([
        f.arrayBuffer().then((b) => readTabularFile(f.name, b)),
        api<{ mapping: Record<string, Champ> }>("/api/imports/mapping"),
      ]);
      const { mapping, manquants } = detectColumns(sheet.headers, saved.mapping);
      if (manquants.length) return setEtape({ e: "correspondance", sheet, mapping, manquants, fichier: f.name });
      await envoyer(sheet, mapping, f.name);
    } catch (err) {
      setEtape({ e: "erreur", message: err instanceof Error ? err.message : "Lecture impossible" });
    }
  }, [envoyer]);

  const lu = useRef<File | null>(null);
  useEffect(() => {
    // Garde : en développement, React exécute les effets deux fois
    if (file && lu.current !== file) { lu.current = file; void lire(file); }
  }, [file, lire]);

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

  async function valider(preview: ImportPreview) {
    setEtape({ e: "application" });
    try {
      const creer = Object.entries(decisions).filter(([, v]) => v === "creer").map(([k]) => k);
      const rattacher = Object.fromEntries(Object.entries(decisions).filter(([, v]) => v.startsWith("client:")).map(([k, v]) => [k, v.slice(7)]));
      const res = await api<{ nouveaux: number; modifies: number; emailEnvoye: boolean; diff: { reference: string | null } }>(`/api/imports/${preview.id}/apply`, { creer, rattacher });
      importId.current = null;
      setEtape({ e: "termine", nouveaux: res.nouveaux, modifies: res.modifies, emailEnvoye: res.emailEnvoye, reference: res.diff.reference });
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
              onDrop={(ev) => { ev.preventDefault(); const f = ev.dataTransfer.files[0]; if (f) void lire(f); }}
            >
              <Upload className="text-horizon" size={32} aria-hidden />
              <span className="font-semibold">Déposez l&apos;extract SpeedResa du lundi</span>
              <span className="text-sm text-gris-texte">Fichier .xlsx ou .csv — ou cliquez pour le choisir</span>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,.txt" className="sr-only" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void lire(f); }} />
            </label>
            <p className="mt-3 text-xs text-gris-texte">Le fichier est lu dans votre navigateur : seules les colonnes utiles sont envoyées (aucune donnée nominative de voyageur).</p>
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
            await envoyer(etape.sheet, mapping, etape.fichier);
          } catch (err) { setEtape({ e: "erreur", message: err instanceof Error ? err.message : "Erreur" }); }
        }} />}

        {etape.e === "apercu" && (
          <Apercu preview={etape.preview} clients={clients} decisions={decisions} setDecisions={setDecisions} onValider={() => valider(etape.preview)} onAnnuler={fermer} />
        )}

        {etape.e === "application" && (
          <div className="py-8 text-center" role="status" aria-live="polite">
            <p className="font-semibold">Fusion des dossiers et recalcul du portefeuille…</p>
            <p className="mt-1 text-sm text-gris-texte">Scores santé, alertes et opportunités sont recalculés pour tous les clients.</p>
          </div>
        )}

        {etape.e === "termine" && (
          <div className="py-6 text-center" role="status">
            <CheckCircle2 className="mx-auto text-emeraude" size={40} aria-hidden />
            <p className="mt-3 text-lg font-semibold">Chiffres à jour — données au {fmtDate(etape.reference)}</p>
            <p className="mt-1 text-sm text-gris-texte">{fmtNb(etape.nouveaux)} nouveaux dossiers, {fmtNb(etape.modifies)} mis à jour. {etape.emailEnvoye ? "L'email récapitulatif est parti." : "L'email récapitulatif n'a pas pu être envoyé."}</p>
            <button className="btn-primaire mt-6" onClick={onClose}>Voir le portefeuille →</button>
          </div>
        )}

        {etape.e === "erreur" && (
          <div className="py-6">
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-rouge/40 bg-rouge/5 p-4 text-sm text-rouge-texte">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden /> {etape.message}
            </p>
            <button className="btn-secondaire mt-4" onClick={() => { importId.current = null; setEtape({ e: "choisir" }); }}>Réessayer</button>
          </div>
        )}
      </div>
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

function Apercu({ preview: p, clients, decisions, setDecisions, onValider, onAnnuler }: {
  preview: ImportPreview; clients: ClientOption[]; decisions: Record<string, string>;
  setDecisions: (d: Record<string, string>) => void; onValider: () => void; onAnnuler: () => void;
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
      <div className="mt-6 flex justify-end gap-3">
        <button className="btn-discret" onClick={onAnnuler}>Abandonner</button>
        <button className="btn-primaire" onClick={onValider} autoFocus>Valider l&apos;import →</button>
      </div>
    </div>
  );
}
