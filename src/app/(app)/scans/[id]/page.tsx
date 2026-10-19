import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { clients, scanRuns } from "@/db/schema";
import { requireUser } from "@/lib/server/auth";
import { ScanProgress } from "@/components/scan/ScanProgress";

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const db = await getDb();
  const [run] = await db.select().from(scanRuns).where(eq(scanRuns.id, Number(id)));
  if (!run) notFound();
  const [c] = await db.select({ id: clients.id, nom: clients.nom }).from(clients).where(eq(clients.id, run.clientId));
  return <ScanProgress id={run.id} client={c} />;
}
