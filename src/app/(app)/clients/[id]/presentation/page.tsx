import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/server/auth";
import { AuditError } from "@/lib/server/audits";
import { presentationClient } from "@/lib/server/presentation";
import { PresentationClient } from "@/components/restitution/PresentationClient";

/** Mode présentation : plein écran, sans données internes, pilier par pilier. */
export default async function PresentationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ audit?: string }> }) {
  await requireUser();
  const { id } = await params;
  const { audit } = await searchParams;
  const p = await presentationClient(await getDb(), id, audit ? Number(audit) : undefined).catch((e) => { if (e instanceof AuditError) notFound(); throw e; });
  return <PresentationClient p={JSON.parse(JSON.stringify(p))} retour={audit ? `/audits/${audit}` : `/clients/${id}`} />;
}
