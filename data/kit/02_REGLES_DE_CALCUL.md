# Règles de calcul — plateforme d'audit CSM Speedmedia

Ce fichier décrit les indicateurs et les scores à reproduire. Ce sont exactement ceux du cockpit portefeuille déjà en service. Tous les seuils doivent être **paramétrables** dans un écran d'administration : les valeurs ci-dessous sont les valeurs de départ.

---

## 1. Données sources

### Export dossiers SpeedResa
Il correspond à l'onglet « 3. Métriques mensuelles » du fichier `CSM - Score de maturité numérique (1).xlsx`. Une ligne = un dossier.

| Colonne | Usage |
|---|---|
| `IDagence` | **Clé client unique** dans toute l'application (ex. `S25`) |
| `Dossier Producteur` | oui / non |
| `IDresa` | Identifiant du dossier |
| `Voyage`, `Nom du fournisseur` | Libellés |
| `Nom de l'agence` | Nom affiché (peut varier : ne jamais l'utiliser comme clé) |
| `Date de réservation`, `Heure de réservation` | Date du dossier |
| `Nombre de paxs` | Passagers |
| `Statut du dossier` | Validée, Enregistrée, En Cours, Attente règlement, Devis, Demande de réservation, En demande, Abandonnée, Pas de disponibilité, Annulée par l'agence, Annulée par le client |
| `Statut d'origine du dossier` | Commande, Demande de réservation, RésaLive |
| `Total du dossier` | Montant en € |
| `Total encaissé` | Montant encaissé en € |
| `Erreur RésaLive` | Oui / Non |

Points à respecter :
- Les agences de démo (`D01`, `D10`) sont exclues.
- La **date de référence** est la date du dossier le plus récent de l'export (et non la date du jour). Pour l'export fourni, c'est le 12/10/2026.

### Trafic mensuel
Il correspond à l'onglet « 4. Métriques GTM » : nom du client et visites par mois. L'import est manuel pour l'instant. Il permet de calculer le taux de conversion.

### Volume d'affaires global estimé
Il correspond à l'onglet « VA annualisé » : SIREN, modèle de distribution, estimation du volume d'affaires total de l'entreprise. Plusieurs comptes d'un même groupe partagent une seule estimation (Quartier Libre, Visit Europe, ResaReva, NewTour, APAS-BTP). **Cette estimation ne doit être comptée qu'une fois par groupe** dans les totaux.

---

## 2. Définitions

| Indicateur | Définition |
|---|---|
| **Volume d'affaires** (« GTV ») | Somme de `Total du dossier` hors statuts « Annulée par l'agence » et « Annulée par le client ». Les devis et demandes sont inclus, comme dans la GTV du Cockpit d'origine. |
| **VA confirmé** | Somme de `Total du dossier` pour les statuts Validée, Enregistrée, En Cours, Attente règlement. |
| **Transformation** | Dossiers confirmés ÷ dossiers créés sur 12 mois. |
| **Taux d'erreur RésaLive** | Dossiers avec `Erreur RésaLive = Oui` ÷ dossiers d'origine RésaLive sur 12 mois. |
| **Taux d'annulation** | Annulés ÷ (confirmés + annulés) sur 12 mois. |
| **Évolution 90 j** | (Volume des 90 j avant la date de référence − même fenêtre N-1) ÷ fenêtre N-1. On compare d'une année sur l'autre pour neutraliser la saisonnalité, très forte dans le voyage. |
| **Évolution 30 j** | Volume des 30 derniers jours vs moyenne mensuelle des 90 jours précédents. |
| **Jours sans dossier** | Date de référence − date du dernier dossier. |
| **Part du potentiel captée** | Volume 12 mois ÷ VA global estimé. |
| **Usage de l'outil** | « Réservation en ligne » si la transformation est ≥ 20 %. « Demandes / devis » sinon : la vente se conclut hors de l'outil et le vrai chiffre du client nous échappe. « Inactif » si aucun dossier sur 12 mois. |

---

## 3. Score santé /100

Ce score est calculé **uniquement à partir des données**, sans l'audit.

| Composante | Points | Calcul |
|---|---|---|
| Dynamique | 25 | Évolution 90 j : −50 % → 0 pt, +50 % → 25 pts, linéaire entre les deux. Un client nouveau (pas de N-1) reçoit 60 % des points. |
| | 10 | Évolution 30 j : même échelle. S'il n'y a aucune base mais une activité, 60 % des points. |
| Activité | 15 | Récence : ≤ 7 j → 15 pts, ≥ 60 j → 0 pt, linéaire entre les deux. |
| | 10 | Dossiers sur 90 j : 30 dossiers ou plus → 10 pts, linéaire en dessous. |
| Usage | 20 | Transformation : 50 % ou plus → 20 pts, linéaire en dessous. |
| Qualité | 10 | Erreurs RésaLive : 0 % → 10 pts, 10 % ou plus → 0 pt. |
| | 10 | Annulations : 0 % → 10 pts, 25 % ou plus → 0 pt. |

Un client sans aucun dossier sur 12 mois reçoit 0.

**Segments** :
- Champion : ≥ 65
- À activer : 45 à 64
- À risque : < 45
- Fantôme : aucun dossier sur 12 mois

---

## 4. Alertes de départ (churn)

🔴 **Critiques** :
- aucun dossier depuis 30 jours ou plus ;
- volume 90 j en baisse de 40 % ou plus sur un an, si le volume N-1 de la fenêtre était ≥ 20 k€ ;
- aucun dossier sur 12 mois ;
- **module SpeedResa absent du site** ou solution concurrente détectée (critère TECH-06 du scan) ;
- *(à ajouter quand la donnée sera disponible)* aucune connexion au back-office depuis 30 jours, ou échéance de contrat dans moins de 90 jours sans RDV planifié.

🟠 **À surveiller** :
- volume 90 j en baisse de 20 % ou plus, si le volume N-1 de la fenêtre était ≥ 5 k€ ;
- 30 derniers jours à moins de 70 % de la moyenne des 3 mois précédents (moyenne ≥ 5 k€) ;
- volume 12 mois < 10 k€ alors que le client est actif ;
- erreurs RésaLive ≥ 5 % (sur au moins 30 dossiers RésaLive) ;
- annulations ≥ 15 % (sur au moins 20 dossiers) ;
- *(issues de l'audit)* score de maturité en baisse de plus de 10 points entre deux audits, ou critère légal à NON.

**Niveau du client** : Critique si au moins une alerte rouge, À surveiller si au moins une alerte orange, Sain sinon.

---

## 5. Opportunités

| Type | Règle |
|---|---|
| Potentiel non capté | VA global estimé ≥ 1 M€ et part captée < 5 % |
| Usage à faire évoluer | ≥ 30 dossiers sur 12 mois et transformation < 10 % : proposer la réservation instantanée et le paiement en ligne |
| Conversion | ≥ 100 devis sur 12 mois et transformation < 35 % : proposer la relance des paniers et le paiement fractionné |
| Croissance | Évolution 90 j ≥ +30 % et volume 90 j ≥ 20 k€ : moment idéal pour un nouveau projet |
| Donnée à vérifier | Volume réel supérieur à l'estimation globale : mettre l'estimation à jour |
| **Issues de l'audit** | Chaque critère à NON ou PARTIELLEMENT génère son « offre si NON » (fichier `03_criteres.json`), priorisée par impact × effort (§ 7) |

---

## 6. Score de maturité (audit) /100

- **Points par statut** :
  - OUI = 100 % des points ;
  - PARTIELLEMENT = 50 % ;
  - NON = 0 ;
  - CORRIGÉ = 0 dans le score actuel, 100 % dans le **score après action** ;
  - N.A. = exclu du calcul.
- **Score** = points obtenus ÷ points des critères évalués × 100, par pilier et au global.
- **Couverture** = critères évalués ÷ critères applicables. Un score n'est « fiable » qu'à partir de 70 % de couverture. Il faut toujours afficher la couverture à côté du score.
- Pour chaque critère, on retient la **dernière évaluation**. L'historique complet est conservé.
- **Critères à seuil** : le statut se calcule à partir de la valeur mesurée et des seuils (`sens` ↑ : valeur ≥ seuil plein → OUI, ≥ seuil 50 % → PARTIELLEMENT, sinon NON ; `sens` ↓ : inverse). Un statut saisi à la main l'emporte toujours, avec un commentaire obligatoire.
- **Statuts de maturité** (repris de la grille d'origine : 100/300 et 220/300 ramenés sur 100) :
  - < 35 : 🔴 Fantôme / Risque churn
  - 35 à 72 : 🚙 Formule 1 pilotée en 4L
  - ≥ 73 : 🏎️ Formule 1 (Top performer)

---

## 7. Relier la maturité à la performance

C'est le cœur de la valeur de l'outil. Chaque critère est rattaché à un ou plusieurs **leviers de performance** :

| Indicateur de performance en retard | Critères à examiner en premier |
|---|---|
| Volume en baisse / peu de trafic | VIS-01 à VIS-08, PROD-08, PROD-09, INN-01 |
| Transformation faible (demandes non confirmées) | PERF-12, SOC-07, PERF-14, PERF-13, PERF-01, PERF-03, SOC-03 |
| Taux de conversion faible | PERF-10, PERF-11, PROD-03, PROD-04, PERF-02, PERF-14, TECH-05 |
| Abandon panier élevé | PERF-07, PERF-13, PERF-14, LEG-07 |
| Panier moyen / upsell faible | PROD-06, PROD-07, PERF-01, PERF-08 |
| Erreurs RésaLive / annulations | RES-05, SOC-04, SOC-06, PERF-03 |
| Pilotage impossible (pas de données fiables) | TRK-01 à TRK-05, SOC-07, LEG-01 |
| Risque légal | Tous les critères LEG-* (une alerte client est générée) |

**Sur la fiche client**, il faut afficher un bloc « Pourquoi ce client sous-performe ». Il croise les indicateurs en retard (§ 2 à 4) avec les critères à NON de ces leviers. Ensuite, Claude rédige 3 à 5 phrases d'explication et un **plan d'action sur 30 jours**. Ce plan reprend les blocs « Priority roadmap / Next 30-day focus » de l'ancien dashboard.

**Priorisation des actions** : impact = points du critère × poids du levier en retard ; effort = estimation par offre (paramétrable : faible / moyen / fort).

**Benchmark** (« How top performers win ») : pour chaque critère, comparer le taux de OUI chez les Champions et chez les autres segments. Afficher les 5 écarts les plus marqués.

**Manque à gagner estimé** (bloc « Missed revenue » de l'ancien dashboard) : (taux de conversion médian des Champions − taux du client) × trafic du mois × panier moyen confirmé du client. À n'afficher que si le trafic est connu, et toujours étiqueté « estimation ».

**Au niveau du portefeuille** :
- nuage de points maturité × évolution 90 j ;
- pour chaque critère, évolution moyenne des clients OUI vs NON. Afficher l'effectif et un avertissement « corrélation, pas causalité » si n < 10 dans un groupe.
