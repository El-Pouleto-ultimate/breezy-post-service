# Wiki : Post Service (Breezy)

Ce document est le Wiki officiel du **Post Service**. Il explique en détail le fonctionnement interne de ce microservice, de l'architecture jusqu'aux lignes de code. Ce document est idéal pour réviser avant une soutenance ou pour accueillir un nouveau développeur dans l'équipe.

---

## 1. Architecture Globale

Ce service est un **microservice** indépendant. Contrairement à une application monolithique où tout le code est mélangé, ce service ne s'occupe **que d'une seule chose** : les publications (posts), les commentaires et les likes. 

### L'API Gateway et la Sécurité
Ce service n'est pas exposé directement à l'utilisateur final. Il se trouve derrière une **API Gateway** (gérée par `breezy-infra`).
1. L'utilisateur se connecte au Frontend (React/Next).
2. Le Frontend envoie une requête avec un token de sécurité (JWT).
3. L'API Gateway intercepte la requête, vérifie que le token est valide, et en extrait l'identité de l'utilisateur.
4. L'API Gateway transfère la requête au **Post Service** en y ajoutant un header spécifique : `x-user-id`.

**Conséquence dans le code** : Le Post Service n'a **aucune logique de vérification de mot de passe ou de token JWT**. Il fait une confiance aveugle à l'API Gateway. Pour savoir qui fait une action, le Post Service lit simplement `req.headers['x-user-id']`.

---

## 2. Le Point d'Entrée (Démarrage)

Le démarrage de l'application est scindé en deux fichiers pour séparer la configuration du serveur web (Express) et le lancement réel.

### `src/app.js` (La configuration Express)
Ce fichier initialise le serveur web. Il utilise des **middlewares** :
- `express.json()` : Permet à notre serveur de comprendre les données envoyées au format JSON.
- `morgan('dev')` : Un outil qui affiche un log sympa dans la console à chaque fois qu'une requête est reçue (utile pour débugger).
Enfin, il rattache toutes les routes de l'API sous le préfixe `/api` (`app.use('/api', postRoutes)`).

### `index.js` (Le lancement)
C'est le fichier principal exécuté par Node.js (via `npm start`). 
1. Il charge les variables d'environnement (via `dotenv`).
2. Il se connecte à la base de données MongoDB.
3. Si la base de données répond, il demande au serveur Express (`app.js`) de commencer à écouter sur le port (par défaut 4003).

---

## 3. Les Modèles (Base de données MongoDB)

Le dossier `src/models/` définit la structure des données stockées dans MongoDB grâce à la librairie **Mongoose**. Mongoose permet d'imposer des règles strictes sur ce qu'on a le droit de sauvegarder.

### `post.model.js`
Le cœur du service. Il stocke :
- `user_id` (String) : L'ID de l'auteur.
- `content` (String) : Le texte du post. Il a une validation Mongoose stricte (`maxlength: 280`) pour respecter la contrainte façon Twitter/X.
- `tags` : Un tableau de strings pour la Fx12.
- `timestamps: true` : Demande à Mongoose d'ajouter automatiquement `created_at` et `updated_at`.

### `like.model.js`
Pour savoir qui a liké quoi.
- Il contient un `user_id` et un `post_id`.
- **Astuce technique** : Il possède un index composé unique (`likeSchema.index({ user_id: 1, post_id: 1 }, { unique: true });`). Cela garantit au niveau de la base de données qu'un utilisateur ne peut pas liker deux fois le même post. C'est extrêmement robuste.

### `comment.model.js`
Structure hiérarchique pour les commentaires et les réponses (Fx7 et Fx8).
- `parent_comment_id` : Si ce champ est vide, c'est un commentaire direct sur le post. S'il est rempli, c'est une réponse à un autre commentaire.

---

## 4. La Logique Métier (Les Contrôleurs)

Le dossier `src/controllers/` contient le "cerveau" de l'application. Chaque fonction correspond à une action précise. 

### Exemple : `post.controller.js` -> `create`
Quand un utilisateur veut créer un post :
1. On récupère son identité : `const userId = req.headers['x-user-id'];`.
2. On récupère le contenu du post : `const { content, tags } = req.body;`.
3. **Vérification** : Si le texte est vide ou dépasse 280 caractères, le contrôleur refuse de le sauvegarder et renvoie une erreur 400 (`Bad Request`).
4. Si tout est bon, on le sauvegarde via Mongoose : `await Post.create(...)` et on renvoie une réponse 201 (`Created`).

### Cas Complexe : Le Feed Chronologique (`getFeed`)
C'est la Fx5. Comment récupérer les posts des gens qu'on suit, sachant que la notion de "suivi" est gérée par un autre service ?
1. Le contrôleur fait une requête HTTP (via `axios`) vers l'URL du User Service (`process.env.USER_SERVICE_URL`).
2. Il demande : "Donne-moi la liste des IDs des personnes que l'utilisateur X suit".
3. Le User Service lui répond avec une liste d'IDs (ex: `['id1', 'id2']`).
4. Le Post Service demande alors à MongoDB : "Donne-moi tous les posts dont le `user_id` est dans cette liste (`$in: followingIds`)", triés du plus récent au plus ancien (`sort({ created_at: -1 })`).

---

## 5. Le Routage (Les Routes)

Le dossier `src/routes/` fait le pont entre une URL appelée par le Front-end et le cerveau (Contrôleur).

Dans `post.routes.js`, on utilise `express.Router()`.
On associe des **verbes HTTP** (GET, POST, DELETE) et des **URLs** à des fonctions du contrôleur.

*Exemple* : `router.post('/posts', postCtrl.create);`
Si quelqu'un fait une requête `POST` sur l'URL `http://localhost:4003/api/posts`, alors Express exécutera la fonction `create` du fichier `post.controller.js`.

> [!TIP]
> **Ordre des routes** : Dans le code, les routes "statiques" comme `/posts/feed` sont déclarées **avant** les routes dynamiques avec paramètres comme `/posts/:id`. Si ce n'était pas le cas, Express aurait cru que le mot "feed" était un ID de post et le système aurait crashé.

---

## Conclusion
Ce service est un parfait exemple d'architecture microservices : il est spécialisé, il ne s'occupe pas de la sécurité complexe (déléguée à la Gateway), et il communique intelligemment avec les autres services (le User Service) pour des fonctionnalités croisées comme le fil d'actualité.
