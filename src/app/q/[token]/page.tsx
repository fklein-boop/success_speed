import type { Metadata } from "next";
import { getDb } from "@/db";
import { vueClient } from "@/lib/server/questionnaires";
import { Logo } from "@/components/Logo";
import { FormulaireClient } from "@/components/questionnaire/FormulaireClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Questionnaire — SpeedResa", robots: { index: false, follow: false }, referrer: "no-referrer" };

const MESSAGES: Record<string, { titre: string; texte: string }> = {
  repondu: { titre: "Merci, vos réponses ont bien été reçues", texte: "Votre chargé(e) de clientèle SpeedResa les intègre à votre audit et reviendra vers vous avec ses recommandations." },
  expire: { titre: "Ce lien a expiré", texte: "Contactez votre chargé(e) de clientèle SpeedResa pour recevoir un nouveau lien." },
  annule: { titre: "Ce lien n'est plus valable", texte: "Un lien plus récent vous a peut-être été envoyé. Sinon, contactez votre chargé(e) de clientèle SpeedResa." },
  inconnu: { titre: "Lien introuvable", texte: "Vérifiez que l'adresse est complète, ou contactez votre chargé(e) de clientèle SpeedResa." },
};

/** Questionnaire client (sans compte, par lien magique). Mobile d'abord, aucune donnée interne. */
export default async function QuestionnairePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await vueClient(await getDb(), token);
  return (
    <div className="min-h-dvh bg-[#f6f8fb]">
      <header className="bg-minuit px-4 py-3"><div className="mx-auto max-w-xl"><Logo inverse /></div></header>
      <div className="bg-degrade h-1" />
      <main className="mx-auto max-w-xl px-4 py-6">
        {v.etat === "ouvert" ? (
          <FormulaireClient token={token} client={v.client} csm={v.csm} questions={v.questions} reponsesInitiales={v.reponses} />
        ) : (
          <div className="carte p-6 text-center">
            <h1 className="text-xl">{MESSAGES[v.etat].titre}</h1>
            <p className="mt-2 text-gris-texte">{MESSAGES[v.etat].texte}</p>
          </div>
        )}
        <p className="mt-8 text-center text-xs text-gris-texte">SpeedResa · Speedmedia — vos réponses servent uniquement à l&apos;audit de votre agence.</p>
      </main>
    </div>
  );
}
