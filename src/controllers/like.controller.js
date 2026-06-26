const axios = require('axios');
const Post = require('../models/post.model');
const Like = require('../models/like.model');

// ─── POST /posts/:id/like ─────────────────────────────────────
// Ajoute un like sur un post et notifie l'auteur.
exports.like = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const username = req.headers['x-user-username'];
    const postId = req.params.id;

    // 1. Vérifier l'existence du post ciblé
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: { code: 'POST_NOT_FOUND' } });

    // 2. Créer l'enregistrement dans la table/collection des likes (index unique composé empêchant les doublons)
    await Like.create({ post_id: postId, user_id: userId });

    // 3. Incrémenter atomiquement le compteur de likes sur le post cible
    const updated = await Post.findByIdAndUpdate(
        postId,
        { $inc: { likes_count: 1 } },
        { new: true } // Renvoie le post mis à jour
    );

    // 4. Notification asynchrone (non bloquante)
    try {
        // Récupérer le rôle de l'auteur du post pour respecter la matrice des permissions
        // (les modérateurs et admins ne reçoivent pas de notification de like — Fx15)
        let recipientRole = null;
        try {
            const userResp = await axios.get(`${process.env.USER_SERVICE_URL}/users/${post.user_id}`, {
                headers: { 'x-user-id': post.user_id },
                timeout: 1000
            });
            recipientRole = userResp.data?.role;
        } catch { /* Si on ne peut pas récupérer le rôle, on envoie quand même la notif */ }

        // Appel inter-services vers le profil-service
        await axios.post(`${process.env.PROFIL_SERVICE_URL}/api/notifications/internal`, {
            recipient_user_id: post.user_id,
            type: 'like',
            from_user_id: userId,
            from_username: username,
            post_id: postId,
            recipient_role: recipientRole,
        }, {
            headers: { 'x-internal-secret': process.env.INTERNAL_SECRET },
            timeout: 1000
        });
    } catch { /* Notification non critique : si elle échoue, on ne crash pas la requête de l'utilisateur */ }

    return res.json({ likes_count: updated.likes_count });
  } catch (err) {
    // Si code 11000 : erreur d'index unique MongoDB (déjà liké)
    if (err.code === 11000) {
        return res.status(409).json({ error: { code: 'ALREADY_LIKED', message: 'Vous avez déjà liké ce post.' } });
    }
    console.error('[Like] like error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── DELETE /posts/:id/like ───────────────────────────────────
// Retire un like sur un post.
exports.unlike = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const postId = req.params.id;

    // 1. Rechercher et supprimer l'association de like
    const deleted = await Like.findOneAndDelete({ post_id: postId, user_id: userId });
    if (!deleted) {
        return res.status(404).json({ error: { code: 'LIKE_NOT_FOUND' } });
    }

    // 2. Décrémenter atomiquement le compteur de likes sur le post cible
    const updated = await Post.findByIdAndUpdate(
        postId,
        { $inc: { likes_count: -1 } },
        { new: true }
    );
    return res.json({ likes_count: Math.max(0, updated.likes_count) });
  } catch (err) {
    console.error('[Like] unlike error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};
