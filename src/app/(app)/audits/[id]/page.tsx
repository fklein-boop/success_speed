import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { canEdit, requireUser } from "@/lib/server/auth";
import { AuditError, getAuditState } from "@/lib/server/audits";
import { AuditWorkspace } from "@/components/audit/AuditWorkspace";

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = await getDb();
  const state = await getAuditState(db, Number(id)).catch((e) => {
    if (e instanceof AuditError) notFound();
    throw e;
  });
  const json = JSON.parse(JSON.stringify(state));
  return <AuditWorkspace initial={json} me={{ id: user.id, role: user.role }} editable={canEdit(user)} />;
}
