import Link from "next/link";
import type { ClientMetrics } from "@/lib/metrics/compute";
import { fmtEurCompact } from "@/lib/format";

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(2).replace(".", ",")} %`);

/** Trafic du site et conversion (§ 7), quand le trafic mensuel a été importé. Données internes. */
export function TraficConversion({ m }: { m: ClientMetrics }) {
  if (!m.mois_trafic) {
    return <p className="mt-3 text-xs text-gris-texte">Trafic du site non importé : conversion et manque à gagner indisponibles (<Link href="/imports" className="text-horizon hover:underline">importer le trafic</Link>).</p>;
  }
  const sous = m.conversion != null && m.conversion_reference != null && m.conversion < m.conversion_reference;
  const abandonEleve = m.abandon_panier != null && m.abandon_reference != null && m.abandon_panier > m.abandon_reference + 0.1;
  const source = m.source_trafic === "GA4" ? "Google Analytics" : m.source_trafic === "mixte" ? "Google Analytics et fichier GTM" : "fichier GTM";
  return (
    <>
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-gris-clair pt-3 text-sm sm:grid-cols-4" aria-label="Trafic et conversion">
      <div><dt className="libelle">Visites / mois</dt><dd className="font-semibold tabular-nums">{m.visites_mensuelles?.toLocaleString("fr-FR") ?? "—"}</dd><dd className="text-xs text-gris-texte">{m.periode_trafic} · {source}</dd></div>
      <div title="Dossiers confirmés ÷ visites, sur les mois mesurés. Les dossiers saisis en agence sont comptés : c'est un majorant.">
        <dt className="libelle">Conversion</dt><dd className={`font-semibold tabular-nums ${sous ? "text-rouge-texte" : ""}`}>{pct(m.conversion)}</dd><dd className="text-xs text-gris-texte">demandes : {pct(m.conversion_demandes)}</dd>
      </div>
      <div><dt className="libelle">Référence</dt><dd className="font-semibold tabular-nums">{pct(m.conversion_reference)}</dd><dd className="text-xs text-gris-texte">{m.conversion_reference_source ? `médiane ${m.conversion_reference_source === "Champions" ? "des Champions" : "du portefeuille"}` : "pas assez de clients avec du trafic"}</dd></div>
      <div title="(conversion de référence − conversion du client) × visites mensuelles × panier moyen confirmé. Estimation.">
        <dt className="libelle">Manque à gagner</dt><dd className="font-semibold tabular-nums">{m.manque_a_gagner_mensuel != null ? `${fmtEurCompact(m.manque_a_gagner_mensuel)} / mois` : "—"}</dd><dd className="text-xs text-gris-texte">estimation{m.panier_moyen_confirme ? ` · panier ${fmtEurCompact(m.panier_moyen_confirme)}` : ""}</dd>
      </div>
    </dl>
    {m.conversion_web != null && (
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4" aria-label="Parcours de réservation sur le site (Google Analytics)">
        <div title="Achats (événement de réservation finalisée) ÷ sessions, mesurés par Google Analytics."><dt className="libelle">Conversion web</dt><dd className="font-semibold tabular-nums">{pct(m.conversion_web)}</dd><dd className="text-xs text-gris-texte">Google Analytics</dd></div>
        <div><dt className="libelle">Débuts de réservation / mois</dt><dd className="font-semibold tabular-nums">{m.debuts_reservation_mensuels?.toLocaleString("fr-FR") ?? "—"}</dd></div>
        <div title="1 − réservations finalisées ÷ réservations commencées sur le site.">
          <dt className="libelle">Abandon panier</dt><dd className={`font-semibold tabular-nums ${abandonEleve ? "text-rouge-texte" : ""}`}>{m.abandon_panier != null ? `${Math.round(m.abandon_panier * 100)} %` : "—"}</dd>
          <dd className="text-xs text-gris-texte">{m.abandon_reference != null ? `médiane : ${Math.round(m.abandon_reference * 100)} %` : m.abandon_panier == null ? "trop peu de débuts de réservation" : "pas encore de médiane"}</dd>
        </div>
        <div><dt className="libelle">CA web / mois</dt><dd className="font-semibold tabular-nums">{m.ca_web_mensuel != null ? fmtEurCompact(m.ca_web_mensuel) : "—"}</dd></div>
      </dl>
    )}
    </>
  );
}
