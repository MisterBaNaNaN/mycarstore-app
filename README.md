# MyCarStore — site + admin

Site vitrine et espace admin (agenda, rendez-vous, fiches clients, devis/factures PDF, statut ouvert/fermé) pour le garage MyCarStore, à Morvillars.

Stack : Node.js + Express + SQLite (module natif `node:sqlite`, aucune dépendance de base de données à installer). Aucun compte externe requis pour faire tourner l'application elle-même.

## Lancer en local

```bash
npm install
npm run seed      # crée le compte admin (une seule fois)
npm start
```

Le site est sur http://localhost:3000, l'admin sur http://localhost:3000/admin.

## Déployer en ligne (Railway)

Le dépôt GitHub est déjà prêt : [github.com/MisterBaNaNaN/mycarstore-app](https://github.com/MisterBaNaNaN/mycarstore-app).

1. Crée un compte sur [railway.app](https://railway.app) — le plus simple est "Login with GitHub" (même compte que celui qui héberge le dépôt).
2. **New Project** → **Deploy from GitHub repo** → sélectionne `mycarstore-app`. Railway détecte `package.json` et lance `npm start` automatiquement.
3. Dans les **Settings** du service → **Variables**, ajoute :
   - `DB_PATH` = `/data/data.sqlite`
   - `NODE_ENV` = `production`
4. Dans **Settings** → **Volumes**, ajoute un volume monté sur `/data` (obligatoire — sans ça, la base serait effacée à chaque redéploiement).
5. Une fois déployé, ouvre l'onglet **Shell** du service (ou une commande "one-off") et lance `npm run seed` pour créer le premier compte admin en ligne — il affichera un identifiant/mot de passe, à noter.
6. Railway donne une URL du type `mycarstore-app.up.railway.app`, utilisable telle quelle. Un nom de domaine personnalisé (ex. mycarstore.fr) peut être attaché plus tard depuis les paramètres du projet, une fois acheté.

## Notifications automatiques au client (e-mail + SMS)

Dès qu'un rendez-vous est confirmé, annulé, remis en attente ou modifié depuis l'admin, le client reçoit automatiquement un e-mail et/ou un SMS. Tant que les clés ci-dessous ne sont pas configurées, cette fonctionnalité reste silencieuse (aucune erreur, juste rien n'est envoyé) — le reste de l'admin fonctionne normalement.

### E-mail (Resend)

1. Crée un compte sur [resend.com](https://resend.com) (gratuit jusqu'à 3000 e-mails/mois).
2. Dans **Domains**, ajoute `mycarstore.fr` et suis les instructions pour ajouter les enregistrements DNS (SPF/DKIM) chez ton hébergeur de domaine — Resend vérifie automatiquement une fois les enregistrements propagés (quelques minutes à quelques heures).
   - Sans domaine vérifié, Resend n'autorise l'envoi qu'à l'adresse e-mail de ton propre compte — utile pour tester, pas pour de vrais clients.
3. Dans **API Keys**, crée une clé.
4. Sur Railway (Variables du service) :
   - `RESEND_API_KEY` = la clé créée
   - `FROM_EMAIL` = `MyCarStore <contact@mycarstore.fr>` (une fois le domaine vérifié — sinon garde la valeur par défaut de test)

### SMS (Twilio)

1. Crée un compte sur [twilio.com](https://www.twilio.com) (carte bancaire requise, un crédit d'essai est offert).
2. Achète un numéro Twilio pouvant envoyer des SMS internationaux (un numéro français ou américain fonctionne pour envoyer vers la France).
3. Note ton **Account SID** et ton **Auth Token** (page d'accueil de la console Twilio).
4. Sur Railway (Variables du service) :
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_FROM_NUMBER` = le numéro Twilio, format international (ex. `+33755501234`)

⚠️ Avec un numéro Twilio standard, le client verra un numéro inconnu comme expéditeur, pas "MyCarStore". Pour un nom d'expéditeur professionnel en France, Twilio propose l'enregistrement d'un **Alphanumeric Sender ID**, une démarche de vérification d'identité pro supplémentaire (voir leur documentation) — pas nécessaire pour que ça fonctionne, mais plus crédible pour les clients.

## Avis Google intégrés au site

En plus des avis laissés directement sur le site (modérés depuis l'onglet "Avis" de l'admin), le site peut afficher automatiquement la note et quelques avis récents de la fiche Google Business de l'atelier. Tant que ce n'est pas configuré, ce bloc reste simplement invisible sur le site — rien ne casse.

1. Crée une clé API sur [console.cloud.google.com](https://console.cloud.google.com) : nouveau projet → **APIs & Services** → active **"Places API"** → **Credentials** → crée une clé API.
   - Un compte de facturation Google Cloud doit être rattaché au projet, mais l'usage d'un petit site (une requête mise en cache 1h) reste largement dans le crédit gratuit mensuel de Google.
2. Trouve l'identifiant **Place ID** de l'atelier avec l'outil officiel [Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id) (cherche "MyCarStore Morvillars" sur la carte).
3. Sur Railway (Variables du service) :
   - `GOOGLE_PLACES_API_KEY` = la clé créée
   - `GOOGLE_PLACE_ID` = l'identifiant trouvé à l'étape 2

## Sécurité — à faire avant un vrai lancement public

- Change le mot de passe admin par défaut dès la première connexion (bouton "Mot de passe" dans l'admin).
- Le cookie de session n'est marqué "Secure" qu'en production (`NODE_ENV=production`) — pense à définir cette variable d'environnement sur l'hébergeur, pour qu'il n'accepte le cookie que via HTTPS.
- Pense à sauvegarder régulièrement le fichier `data.sqlite` (c'est toute la base de données).
