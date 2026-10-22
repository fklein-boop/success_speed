import { notFound } from "next/navigation";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { questionnaires } from "@/db/schema";
import { canEdit, requireUser } from "@/lib/server/auth";
import { AuditError, getAuditState } from "@/lib/server/audits";
import { exportsDisponibles } from "@/lib/server/backoffice";
import { lienQuestionnaire } from "@/lib/server/questionnaires";
import { AuditWorkspace } from "@/components/audit/AuditWorkspace";

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = await getDb();
  const state = await getAuditState(db, Number(id)).catch((e) => {
    if (e instanceof AuditError) notFound();
    throw e;
  });
  const [dispo, [q]] = await Promise.all([
    exportsDisponibles(db),
    db.select().from(questionnaires).where(and(eq(questionnaires.auditId, state.audit.id), ne(questionnaires.statut, "annule"))).orderBy(desc(questionnaires.id)).limit(1),
  ]);
  const json = JSON.parse(JSON.stringify(state));
  const extra = {
    exports: [...dispo.keys()],
    placeId: state.client.googlePlaceId,
    questionnaire: q ? { statut: q.statut, lien: q.statut === "en_attente" ? lienQuestionnaire(q) : null, email: q.email, questions: (q.questions as { critereId: string }[]).map((x) => x.critereId), envoyeLe: q.envoyeLe?.toISOString() ?? null, reponduLe: q.reponduLe?.toISOString() ?? null } : null,
  };
  return <AuditWorkspace initial={json} extra={extra} me={{ id: user.id, role: user.role }} editable={canEdit(user)} />;
}
