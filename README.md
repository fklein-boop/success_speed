# Plateforme d'audit & de pilotage CSM — SpeedResa

Application interne de l'équipe Customer Success de Speedmedia : portefeuille clients, score santé,
alertes de départ, opportunités, import hebdomadaire de l'extract SpeedResa et, dans les étapes
suivantes, audits de maturité numérique.

**État : étapes 1 à 7 livrées** (socle, audit manuel, pré-audit automatique des 36 critères Auto, restitution avec plan d'action, PDF et email de rendez-vous, questionnaire client avec relances, pilotage, administration, scans planifiés et monitoring), plus la création manuelle de clients, l'import du trafic (conversion, manque à gagner) et le connecteur Google Analytics 4 (conversion web, abandon panier). L'étape 8 (auto-audit public) est prévue « plus tard, sur demande ». Voir [DECISIONS.md](DECISIONS.md) pour les choix faits et ce qui reste.

## Stack

- Next.js 16 (App Router) + TypeScript, Tailwind CSS 4 avec les tokens de la charte SpeedResa (`src/app/globals.css`)
- PostgreSQL (Neon, région Frankfurt) via Drizzle ORM — en local, base PGlite embarquée (aucune installation)
- Connexion sans mot de passe (lien magique par email) + SSO Google, limités à la liste blanche
- Emails : Resend · Graphiques : Recharts · Tests : Vitest

## Déployer sur Vercel (première fois, ~15 min)

> **Guide complet et à jour : [DEPLOIEMENT.md](DEPLOIEMENT.md)** (qui fait quoi, variables, Resend, worker Fly.io, clés d'API). La section ci-dessous en est un résumé.

### 1. Créer le projet Vercel

Deux possibilités :

- **Depuis GitHub** (recommandé) : déposez ce dossier dans un dépôt GitHub privé, puis sur
  [vercel.com/new](https://vercel.com/new) importez le dépôt. Le dossier `node_modules`, `.data` et `.env.local` ne doivent pas être envoyés (ils sont dans `.gitignore`).
- **Depuis ce Mac, sans GitHub**, avec la CLI Vercel :

```bash
cd "/Users/francoisklein/DOSSIERS CLAUDE/AUDIT CSM/plateforme-audit-csm" && PATH=$HOME/.local/node/bin:$PATH npx vercel link
```

Choisissez la région **Frankfurt (fra1)** si elle est demandée (elle est déjà fixée dans `vercel.json`).

### 2. Ajouter la base Neon

Dans le projet Vercel : **Storage → Create Database → Neon (Serverless Postgres)**, région
**Frankfurt (eu-central-1)**, puis **Connect** au projet. Vercel ajoute automatiquement la variable `DATABASE_URL`.

### 3. Renseigner les variables d'environnement

Dans **Settings → Environment Variables** (environnement *Production*) :

| Variable | Valeur |
|---|---|
| `SUPERADMIN_EMAIL` | votre adresse Speedmedia (premier super admin, non supprimable) |
| `APP_URL` | l'URL de production, ex. `https://audit-csm.vercel.app` |
| `AUTH_SECRET` | une chaîne aléatoire : `openssl rand -base64 32` |
| `RESEND_API_KEY` | clé Resend (voir étape 4) |
| `EMAIL_FROM` | ex. `Audit CSM SpeedResa <audit@speedmedia.fr>` (domaine vérifié dans Resend) |
| `CRON_SECRET` | une chaîne aléatoire (protège les tâches planifiées : rappel du lundi, relances des questionnaires) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | facultatif, voir étape 5 |
| `ANTHROPIC_API_KEY` | analyse des pages légales et des fiches par Claude (facultatif : sinon analyse par motifs) |
| `GOOGLE_PAGESPEED_API_KEY` / `GOOGLE_PLACES_API_KEY` | vitesse du site (PERF-10/11), note et avis Google (VIS-01 à 03) |

### 4. Configurer Resend (emails)

1. Créez un compte sur [resend.com](https://resend.com), région **EU (Irlande)**.
2. **Domains → Add domain** : ajoutez le domaine d'envoi (ex. `speedmedia.fr`) et publiez les
   enregistrements DNS indiqués (SPF, DKIM).
3. **API Keys → Create** (droit *Sending access*) et copiez la clé dans `RESEND_API_KEY`.

Sans clé Resend, personne ne peut recevoir de lien de connexion en production.

### 5. (Facultatif) SSO Google

Dans [Google Cloud Console](https://console.cloud.google.com/apis/credentials) : **Créer des identifiants →
ID client OAuth → Application Web**, URI de redirection autorisée :
`https://<votre-url>/api/auth/google/callback`. Copiez l'ID et le secret dans les variables Vercel.
Le bouton « Continuer avec Google » n'apparaît que si ces deux variables sont définies.
Seules les adresses de la liste blanche peuvent se connecter, même via Google.

### 6. Déployer

Avec GitHub : chaque `push` sur la branche principale déploie. Avec la CLI :

```bash
cd "/Users/francoisklein/DOSSIERS CLAUDE/AUDIT CSM/plateforme-audit-csm" && PATH=$HOME/.local/node/bin:$PATH npx vercel deploy --prod
```

Le script `vercel-build` applique les migrations de base, crée les 77 critères et les 83 comptes
clients (`data/kit/`) si la base est vide, importe les deux audits de l'ancienne grille, puis compile l'application.

### 7. Premier lancement

1. Ouvrez l'URL, saisissez l'adresse `SUPERADMIN_EMAIL`, cliquez sur le lien reçu.
2. Glissez-déposez sur le cockpit le fichier `CSM - Score de maturité numérique (1).xlsx` (ou le
   dernier extract du lundi) : l'onglet « 3. Métriques mensuelles » est reconnu automatiquement.
3. Menu **Utilisateurs** : ajoutez les CSM (collage d'une liste possible) et envoyez les invitations.

## Worker de pré-audit (scan avec navigateur)

Sur Vercel, le pré-audit fonctionne sans navigateur (mode dégradé : cookies, Consent Mode et rendu mobile partiellement vérifiés, pas de capture). Pour le mode complet, déployez le worker Playwright, par exemple sur Fly.io (région Paris) :

1. Installez la CLI Fly (https://fly.io/docs/flyctl/install/) et connectez-vous (`fly auth login`).
2. Depuis ce dossier : `fly launch --config fly.worker.toml --no-deploy`.
3. Renseignez les secrets : `fly secrets set DATABASE_URL=… GOOGLE_PAGESPEED_API_KEY=… SCAN_CONTACT_URL=… --config fly.worker.toml` (même `DATABASE_URL` que sur Vercel).
4. `fly deploy --config fly.worker.toml`.
5. Sur Vercel, ajoutez `SCAN_MODE=worker` et redéployez : les scans sont alors mis en file et exécutés par le worker.

Le worker mesure aussi la disponibilité de chaque site client toutes les 15 minutes (TECH-04). Donnez-lui les mêmes clés d'API que Vercel (`ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_PAGESPEED_API_KEY`) : c'est lui qui exécute les scans. Le parcours du tunnel de réservation reste désactivé tant que `SCAN_TUNNEL=oui` n'est pas défini (voir DECISIONS.md, étape 4).

Test d'un site en ligne de commande, sans base : `npm run scan -- https://www.exemple.fr`.

## Développement local

```bash
cd "/Users/francoisklein/DOSSIERS CLAUDE/AUDIT CSM/plateforme-audit-csm" && export PATH=$HOME/.local/node/bin:$PATH && npm install && cp .env.example .env.local && npm run db:migrate && npm run dev
```

- Renseignez au minimum `SUPERADMIN_EMAIL` dans `.env.local`. Sans `DATABASE_URL`, une base locale est
  créée dans `.data/pglite` (n'exécutez pas `db:migrate` pendant que `npm run dev` tourne).
- Sans `RESEND_API_KEY`, les emails (dont les liens de connexion) s'affichent dans le terminal.
- `npm test` : recette de non-régression (81 clients au 12/10/2026), lecture des exports, import en base.
- Après une modification de `src/db/schema.ts` : `npm run db:generate` pour créer la migration.

## Organisation du code

| Dossier | Rôle |
|---|---|
| `src/lib/metrics/` | Règles de calcul (santé, alertes, opportunités) — pures, testées, seuils dans `params.ts` |
| `src/lib/import/` | Lecture des extracts xlsx/csv (reconnaissance des colonnes, dates, montants, anomalies) |
| `src/lib/server/` | Authentification, imports (fusion / annulation), recalcul, emails, journal |
| `src/db/` | Schéma Drizzle et connexion (Neon ou PGlite) |
| `src/app/` | Écrans et routes API |
| `data/kit/` | Référentiel initial : critères, clients, règles et charte |
| `tests/` | Tests Vitest et fixtures (exports réels du 05/10 et du 12/10/2026) |
