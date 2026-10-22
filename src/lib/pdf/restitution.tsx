import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { moisFrise } from "@/lib/restitution/feuille";
import { MATURITE_DESCRIPTION, MATURITE_LIBELLE } from "@/lib/audit/score";
import { MENTION_JURIDIQUE } from "@/lib/restitution/textes";
import type { ModeleClient } from "@/lib/server/restitution";

/**
 * Restitution client en PDF (2 à 4 pages A4), aux couleurs SpeedResa.
 * Rendu en JavaScript pur (@react-pdf/renderer) : aucun navigateur nécessaire, fonctionne sur Vercel.
 * Ne reçoit que le modèle « client » : aucune donnée interne ne peut s'y retrouver.
 */
const POLICES = path.join(process.cwd(), "assets", "fonts");
let polices = false;
function enregistrerPolices() {
  if (polices) return;
  Font.register({ family: "Outfit", src: path.join(POLICES, "outfit-latin-700-normal.woff"), fontWeight: 700 });
  Font.register({ family: "Open Sans", fonts: [
    { src: path.join(POLICES, "open-sans-latin-400-normal.woff"), fontWeight: 400 },
    { src: path.join(POLICES, "open-sans-latin-600-normal.woff"), fontWeight: 600 },
    { src: path.join(POLICES, "open-sans-latin-700-normal.woff"), fontWeight: 700 },
  ] });
  Font.registerHyphenationCallback((mot) => [mot]);
  polices = true;
}

const C = { minuit: "#000033", horizon: "#0A56FC", lagon: "#00CCCC", emeraude: "#1EDDAE", grisClair: "#E3E7EF", gris: "#5B6479", rouge: "#C62F35", rougeFond: "#FDECEC", ambre: "#B26A00" };

const s = StyleSheet.create({
  page: { fontFamily: "Open Sans", fontSize: 9.5, color: C.minuit, paddingTop: 0, paddingBottom: 48, lineHeight: 1.45 },
  bandeau: { backgroundColor: C.minuit, paddingHorizontal: 40, paddingVertical: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logo: { fontFamily: "Outfit", fontSize: 18, color: "#FFFFFF" },
  degrade: { flexDirection: "row", height: 4 },
  corps: { paddingHorizontal: 40, paddingTop: 22 },
  h1: { fontFamily: "Outfit", fontSize: 20, lineHeight: 1.25, marginBottom: 4 },
  h2: { fontFamily: "Outfit", fontSize: 13, lineHeight: 1.25, marginTop: 16, marginBottom: 8 },
  grand: { fontFamily: "Outfit", lineHeight: 1.15, marginVertical: 4 },
  petit: { fontSize: 8, color: C.gris },
  carte: { borderWidth: 1, borderColor: C.grisClair, borderRadius: 8, padding: 12 },
  ligne: { flexDirection: "row" },
  pied: { position: "absolute", bottom: 20, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.gris },
});

const fr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const n0 = (x: number | null) => (x === null ? "—" : String(Math.round(x)));

function Entete({ m }: { m: ModeleClient }) {
  return (
    <View fixed>
      <View style={s.bandeau}>
        <Text style={[s.logo, { lineHeight: 1.2 }]}>speed<Text style={{ color: C.lagon }}>resa</Text></Text>
        <Text style={{ color: "#FFFFFF", fontSize: 8.5 }}>{m.preAudit ? "Pré-audit automatique" : "Audit de maturité numérique"} · {m.client}</Text>
      </View>
      <View style={s.degrade}>
        <View style={{ flex: 1, backgroundColor: C.horizon }} /><View style={{ flex: 1, backgroundColor: C.lagon }} /><View style={{ flex: 1, backgroundColor: C.emeraude }} />
      </View>
    </View>
  );
}

function Pied({ m }: { m: ModeleClient }) {
  return (
    <View style={s.pied} fixed>
      <Text>SpeedResa · Speedmedia — document établi pour {m.client} le {fr(m.date)}{m.preAudit ? " · pré-audit à confirmer avec votre CSM" : ""}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function Barre({ libelle, score, moyenne }: { libelle: string; score: number; moyenne: number | null }) {
  return (
    <View style={{ marginBottom: 7 }} wrap={false}>
      <View style={[s.ligne, { justifyContent: "space-between" }]}>
        <Text style={{ fontWeight: 600 }}>{libelle}</Text>
        <Text>{n0(score)}/100{moyenne !== null ? <Text style={{ color: C.gris }}>  (moyenne des agences : {n0(moyenne)})</Text> : null}</Text>
      </View>
      <View style={{ height: 7, backgroundColor: C.grisClair, borderRadius: 4, marginTop: 2, position: "relative" }}>
        <View style={{ width: `${Math.max(2, Math.min(100, score))}%`, height: 7, backgroundColor: C.horizon, borderRadius: 4 }} />
        {moyenne !== null && <View style={{ position: "absolute", left: `${Math.min(99, moyenne)}%`, top: -2, width: 2, height: 11, backgroundColor: C.minuit }} />}
      </View>
    </View>
  );
}

const PRIO: Record<string, string> = { haute: C.rouge, moyenne: C.ambre, basse: C.gris };

const PORTEUR_COUL = C.horizon;

/** Feuille de route validée (lot C) : chantiers dans l'ordre, puis frise sur 6 mois. */
function FeuilleDeRoute({ f }: { f: NonNullable<ModeleClient["feuille"]> }) {
  const mois = moisFrise(f.valideeLe ? new Date(f.valideeLe) : new Date());
  return (
    <View>
      <Text style={[s.h2, { marginTop: 0 }]}>Votre feuille de route</Text>
      {f.chantiers.map((c, i) => (
        <View key={i} style={[s.carte, { marginBottom: 8, padding: 10 }]} wrap={false}>
          <View style={[s.ligne, { justifyContent: "space-between" }]}>
            <Text style={{ fontFamily: "Outfit", fontSize: 11.5, width: "75%" }}>{i + 1}. {c.titre}</Text>
            <Text style={{ color: PRIO[c.priorite], fontWeight: 700 }}>priorité {c.priorite}</Text>
          </View>
          {c.objectif ? <Text style={{ marginTop: 2 }}>{c.objectif}</Text> : null}
          {c.benefice ? <Text style={{ color: C.horizon, marginTop: 2 }}>Bénéfice : {c.benefice}</Text> : null}
          <View style={[s.ligne, { marginTop: 4, gap: 12 }]}>
            <Text style={s.petit}>Échéance : <Text style={{ color: C.minuit, fontWeight: 600 }}>{c.echeance}</Text></Text>
            <Text style={s.petit}>Porteur : <Text style={{ color: PORTEUR_COUL, fontWeight: 600 }}>{c.porteur}</Text></Text>
            {c.offre ? <Text style={s.petit}>Solution : <Text style={{ color: C.minuit, fontWeight: 600 }}>{c.offre}</Text></Text> : null}
          </View>
          <Text style={[s.petit, { marginTop: 3 }]}>Points concernés : {c.criteres.join(" · ")}</Text>
        </View>
      ))}
      <View wrap={false}>
        <Text style={s.h2}>Calendrier</Text>
        <View style={[s.ligne, { borderBottomWidth: 1, borderColor: C.minuit, paddingBottom: 2 }]}>
          <Text style={{ width: "34%" }} />
          {mois.map((x) => <Text key={x} style={{ width: `${66 / mois.length}%`, fontWeight: 700, textAlign: "center" }}>{x}</Text>)}
        </View>
        {f.chantiers.map((c, i) => (
          <View key={i} style={[s.ligne, { borderBottomWidth: 0.5, borderColor: C.grisClair, paddingVertical: 4, alignItems: "center" }]}>
            <Text style={{ width: "34%", paddingRight: 6 }}>{i + 1}. {c.titre}</Text>
            <View style={{ width: "66%", height: 9, position: "relative" }}>
              <View style={{ position: "absolute", left: `${(c.debut / mois.length) * 100}%`, width: `${(c.duree / mois.length) * 100}%`, height: 9, backgroundColor: PRIO[c.priorite] === C.gris ? C.lagon : PRIO[c.priorite], borderRadius: 4 }} />
            </View>
          </View>
        ))}
        <Text style={[s.petit, { marginTop: 6 }]}>Le détail critère par critère figure en annexe (fichier CSV joint).</Text>
      </View>
    </View>
  );
}

export function DocumentRestitution({ m }: { m: ModeleClient }) {
  enregistrerPolices();
  const vise = m.scoreVise !== null && m.score !== null && m.scoreVise > m.score;
  return (
    <Document title={`Restitution ${m.client}`} author="Speedmedia — SpeedResa" language="fr">
      <Page size="A4" style={s.page}>
        <Entete m={m} />
        <View style={s.corps}>
          <Text style={s.h1}>{m.client}</Text>
          <Text style={s.petit}>{m.url ?? ""}{m.url ? " · " : ""}{m.preAudit ? "Pré-audit automatique" : "Audit"} du {fr(m.date)}{m.csm ? ` · votre CSM : ${m.csm}` : ""}</Text>

          <View style={[s.ligne, { marginTop: 16, gap: 10 }]}>
            <View style={[s.carte, { flex: 1.1, backgroundColor: C.minuit, borderColor: C.minuit }]}>
              <Text style={{ color: "#FFFFFF", fontSize: 8 }}>SCORE DE MATURITÉ NUMÉRIQUE</Text>
              <Text style={[s.grand, { fontSize: 34, color: "#FFFFFF" }]}>{n0(m.score)}<Text style={{ fontSize: 14 }}>/100</Text></Text>
              {m.statut && <Text style={{ color: C.emeraude, fontWeight: 700 }}>{MATURITE_LIBELLE[m.statut]}</Text>}
              {m.statut && <Text style={{ color: "#FFFFFF", fontSize: 8 }}>{MATURITE_DESCRIPTION[m.statut]}</Text>}
            </View>
            <View style={[s.carte, { flex: 1 }]}>
              <Text style={s.petit}>SCORE VISÉ APRÈS ACTIONS</Text>
              <Text style={[s.grand, { fontSize: 24, color: vise ? C.horizon : C.minuit }]}>{n0(m.scoreVise)}/100</Text>
              <Text style={[s.petit, { marginTop: 6 }]}>COUVERTURE DE L&apos;AUDIT</Text>
              <Text style={{ fontWeight: 700 }}>{Math.round(m.couverture * 100)} % des critères évalués{m.couverture < 0.7 ? " (à compléter ensemble)" : ""}</Text>
            </View>
          </View>

          <Text style={s.h2}>Synthèse</Text>
          <Text>{m.synthese}</Text>

          <Text style={s.h2}>Votre maturité par pilier</Text>
          {m.piliers.map((p) => <Barre key={p.pilier} libelle={p.pilier} score={p.score} moyenne={p.moyenne} />)}
          {m.piliers.some((p) => p.moyenne !== null) && <Text style={s.petit}>Le trait vertical indique la moyenne des agences SpeedResa auditées.</Text>}
        </View>
        <Pied m={m} />
      </Page>

      <Page size="A4" style={s.page}>
        <Entete m={m} />
        <View style={s.corps}>
          {(m.forces.length > 0 || m.evolution) && (
            <View style={[s.ligne, { gap: 10 }]}>
              {m.forces.length > 0 && (
                <View style={[s.carte, { flex: 1 }]}>
                  <Text style={[s.h2, { marginTop: 0 }]}>Vos points forts</Text>
                  {m.forces.map((f) => <Text key={f}>•  {f}</Text>)}
                </View>
              )}
              {m.evolution && (
                <View style={[s.carte, { flex: 1 }]}>
                  <Text style={[s.h2, { marginTop: 0 }]}>Depuis l&apos;audit du {fr(m.evolution.depuis)}</Text>
                  {m.evolution.delta !== null && <Text style={{ fontWeight: 700 }}>{m.evolution.delta >= 0 ? "+" : ""}{Math.round(m.evolution.delta)} points</Text>}
                  <Text>{m.evolution.gagnes.length} point(s) progressé(s), {m.evolution.perdus.length} en recul.</Text>
                  {m.evolution.gagnes.slice(0, 4).map((g) => <Text key={g} style={s.petit}>+ {g.split(/[:(]/)[0]}</Text>)}
                </View>
              )}
            </View>
          )}

          {m.feuille ? <FeuilleDeRoute f={m.feuille} /> : (<>
          <Text style={s.h2}>Plan d&apos;action recommandé</Text>
          {m.priorites.length ? (
            <View>
              <View style={[s.ligne, { borderBottomWidth: 1, borderColor: C.minuit, paddingBottom: 3 }]}>
                <Text style={{ width: "13%", fontWeight: 700 }}>Priorité</Text>
                <Text style={{ width: "52%", fontWeight: 700 }}>Point à améliorer</Text>
                <Text style={{ width: "35%", fontWeight: 700 }}>Solution SpeedResa</Text>
              </View>
              {m.priorites.map((p, i) => (
                <View key={i} style={[s.ligne, { borderBottomWidth: 0.5, borderColor: C.grisClair, paddingVertical: 5 }]} wrap={false}>
                  <Text style={{ width: "13%", color: PRIO[p.priorite], fontWeight: 700 }}>{p.priorite}</Text>
                  <View style={{ width: "52%", paddingRight: 8 }}>
                    <Text>{p.critere}</Text>
                    <Text style={s.petit}>{p.pilier} · {p.quadrant}</Text>
                  </View>
                  <Text style={{ width: "35%", color: C.horizon, fontWeight: 600 }}>{p.offre ?? "À définir avec votre CSM"}</Text>
                </View>
              ))}
            </View>
          ) : <Text>Aucune action prioritaire : votre site est au niveau des meilleures pratiques sur les points évalués.</Text>}
          </>)}
        </View>
        <Pied m={m} />
      </Page>

      {m.legaux.length > 0 && (
        <Page size="A4" style={s.page}>
          <Entete m={m} />
          <View style={s.corps}>
            <Text style={[s.h2, { color: C.rouge, marginTop: 0 }]}>Points de conformité légale à traiter</Text>
            {m.legaux.map((l, i) => (
              <View key={i} style={{ backgroundColor: C.rougeFond, borderLeftWidth: 3, borderColor: C.rouge, padding: 10, marginBottom: 8 }} wrap={false}>
                {l.texte.split("\n").map((t, j) => <Text key={j} style={j === 0 ? { fontWeight: 700, marginBottom: 2 } : { marginBottom: 2 }}>{t}</Text>)}
              </View>
            ))}
            <Text style={[s.petit, { marginTop: 6 }]}>{MENTION_JURIDIQUE}</Text>
          </View>
          <Pied m={m} />
        </Page>
      )}
    </Document>
  );
}

export async function pdfRestitution(m: ModeleClient): Promise<Buffer> {
  return renderToBuffer(<DocumentRestitution m={m} />);
}
