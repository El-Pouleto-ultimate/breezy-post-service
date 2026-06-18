# Breezy Post Service

Service gérant les publications, likes, et commentaires.

## Prérequis
- Node.js
- MongoDB
- Créer un fichier `.env` basé sur `.env.example`

## API Routes (Port par défaut : 4003)
*Note : Toutes les routes nécessitent généralement le header `x-user-id` provenant de l'API Gateway.*

### Posts
- `POST /api/posts` : Créer un post. (Body: `content`, `tags`, `media_urls`)
- `GET /api/posts/:id` : Lire un post.
- `DELETE /api/posts/:id` : Supprimer un post (Auteur ou Admin/Modo).
- `POST /api/posts/:id/report` : Signaler un post.

### Feed & Recherche
- `GET /api/posts/feed` : Flux d'actualité chronologique des abonnements.
- `GET /api/posts/user/:userId` : Récupère tous les posts d'un utilisateur.
- `GET /api/posts/search?tag=motcle` : Recherche par tag.

### Interactions
- `POST /api/posts/:id/like` : Liker un post.
- `DELETE /api/posts/:id/like` : Retirer son like.
- `GET /api/posts/:id/comments` : Récupérer les commentaires d'un post.
- `POST /api/posts/:id/comments` : Commenter un post. (Body: `content`)