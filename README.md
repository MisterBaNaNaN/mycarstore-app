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

## Sécurité — à faire avant un vrai lancement public

- Change le mot de passe admin par défaut dès la première connexion (bouton "Mot de passe" dans l'admin).
- Le cookie de session n'est marqué "Secure" qu'en production (`NODE_ENV=production`) — pense à définir cette variable d'environnement sur l'hébergeur, pour qu'il n'accepte le cookie que via HTTPS.
- Remplace le numéro de SMS de test (`0640658409`, dans `public/site.js`) par le vrai numéro mobile de l'atelier, ou retire ce bouton si l'atelier n'a pas de mobile dédié.
- Pense à sauvegarder régulièrement le fichier `data.sqlite` (c'est toute la base de données).
