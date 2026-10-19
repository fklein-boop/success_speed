import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { clientSnapshots } from "@/db/schema";
import { buildAuditCsv } from "@/lib/audit/export-csv";
import type { Statut } from "@/lib/audit/score";
import type { ClientMetrics } from "@/lib/metrics/compute";
import { getAuditState, scoreAudit } from "./audits";

/** CSV d'un audit (version client ou interne), utilisé par le téléchargement et l'envoi au client. */
export async function csvAudit(db: DB, auditId: number, version: "client" | "interne") {
  const st = await getAuditState(db, auditId);
  const nom = (uid: number | null) => { const x = st.users.find((y) => y.id === uid); return x ? x.nom || x.email : null; };
  const [snap] = version === "interne" ? await db.select().from(clientSnapshots).where(eq(clientSnapshots.clientId, st.client.id)) : [];
  const m = snap?.data as ClientMetrics | undefined;
  return buildAuditCsv({
    version,
    client: st.client,
    audit: st.audit,
    csm: nom(st.audit.assigneA ?? st.audit.auteurId),
    score: scoreAudit(st.criteres, st.evaluations),
    criteres: st.criteres,
    evaluations: st.evaluations.map((e) => ({ ...e, statut: e.statut as Statut | null, proposition: e.proposition as never, auteur: nom(e.auteurId) })),
    interne: m ? { sante: m.sante, risque: m.risque, alertes: m.alertes.map((a) => a.message) } : undefined,
  });
}
