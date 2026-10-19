import { getDb } from "@/db";
import { assertUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";
import { logActivity } from "@/lib/server/activity";
import { pdfClient } from "@/lib/server/restitution";

export const maxDuration = 60;

/** Restitution client en PDF : affichée dans l'aperçu, ou téléchargée avec ?telecharger=1. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await assertUser();
  const { id } = await ctx.params;
  const telecharger = new URL(req.url).searchParams.has("telecharger");
  const { buffer, filename } = await pdfClient(await getDb(), id);
  if (telecharger) await logActivity(u.id, "export_pdf", "client", id, { fichier: filename });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${telecharger ? "attachment" : "inline"}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
});
