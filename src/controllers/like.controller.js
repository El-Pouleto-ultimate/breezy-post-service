const axios = require('axios');
const Post = require('../models/post.model');
const Like = require('../models/like.model');

// ─── POST /posts/:id/like ─────────────────────────────────────
exports.like = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const username = req.headers['x-user-username'];
    const postId = req.params.id;

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: { code: 'POST_NOT_FOUND' } });

    await Like.create({ post_id: postId, user_id: userId });
    const updated = await Post.findByIdAndUpdate(
        postId,
        { $inc: { likes_count: 1 } },
        { new: true }
    );

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
    } catch { /* Notification non critique */ }

    return res.json({ likes_count: updated.likes_count });
  } catch (err) {
    if (err.code === 11000) {
        return res.status(409).json({ error: { code: 'ALREADY_LIKED', message: 'Vous avez déjà liké ce post.' } });
    }
    console.error('[Like] like error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── DELETE /posts/:id/like ───────────────────────────────────
exports.unlike = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const postId = req.params.id;

    const deleted = await Like.findOneAndDelete({ post_id: postId, user_id: userId });
    if (!deleted) {
        return res.status(404).json({ error: { code: 'LIKE_NOT_FOUND' } });
    }
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
