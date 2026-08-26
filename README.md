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

1. Crée un compte sur [railway.app](https://railway.app) (gratuit pour commencer).
2. Crée un nouveau projet, "Deploy from GitHub repo" (il faut d'abord pousser ce dossier sur un dépôt GitHub — demande-moi si tu veux de l'aide pour ça), ou utilise la CLI Railway (`railway up`) directement depuis ce dossier.
3. Railway détecte automatiquement `package.json` et lance `npm start`.
4. Dans les paramètres du service, ajoute un **volume persistant** monté sur le dossier du projet (pour que `data.sqlite` survive aux redéploiements — c'est important, sans ça la base serait effacée à chaque déploiement).
5. Une fois déployé, ouvre un terminal Railway (ou lance une tâche "one-off") et exécute `npm run seed` pour créer le premier compte admin sur le serveur en ligne.
6. Railway te donne une URL du type `mycarstore.up.railway.app` — utilisable telle quelle, ou tu peux y attacher un nom de domaine personnalisé (ex. mycarstore.fr) depuis les paramètres du projet une fois que tu l'auras acheté.

## Sécurité — à faire avant un vrai lancement public

- Change le mot de passe admin par défaut dès la première connexion (bouton "Mot de passe" dans l'admin).
- Le cookie de session n'est marqué "Secure" qu'en production (`NODE_ENV=production`) — pense à définir cette variable d'environnement sur l'hébergeur, pour qu'il n'accepte le cookie que via HTTPS.
- Remplace le numéro de SMS de test (`0640658409`, dans `public/site.js`) par le vrai numéro mobile de l'atelier, ou retire ce bouton si l'atelier n'a pas de mobile dédié.
- Pense à sauvegarder régulièrement le fichier `data.sqlite` (c'est toute la base de données).
