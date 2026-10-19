import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { googleEnabled } from "@/lib/server/google";
import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

const ERREURS: Record<string, string> = {
  lien: "Ce lien de connexion n'est plus valable (déjà utilisé ou expiré). Demandez-en un nouveau.",
  refus: "Connexion impossible avec ce compte. L'accès est réservé aux adresses autorisées par l'équipe Customer Success.",
  sso: "La connexion Google n'est pas configurée.",
};

export default async function ConnexionPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { erreur } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-minuit px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center"><Logo inverse className="text-3xl" /></div>
        <div className="carte p-8">
          <h1 className="text-2xl">Plateforme d&apos;audit CSM</h1>
          <p className="mt-2 text-sm text-gris-texte">Accès réservé à l&apos;équipe Speedmedia. Recevez un lien de connexion par email, sans mot de passe.</p>
          {erreur && ERREURS[erreur] && (
            <p role="alert" className="mt-4 rounded-lg border border-rouge/40 bg-rouge/5 p-3 text-sm text-rouge-texte">{ERREURS[erreur]}</p>
          )}
          <LoginForm google={googleEnabled()} />
        </div>
      </div>
    </main>
  );
}
