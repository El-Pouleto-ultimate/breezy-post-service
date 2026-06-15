const axios = require('axios');
const Post = require('../models/post.model');
const Like = require('../models/like.model');

// ─── POST /posts/:id/like ─────────────────────────────────────
exports.like = async (req, res) => {
    const userId = req.headers['x-user-id'];
    const username = req.headers['x-user-username'];
    const postId = req.params.id;

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: { code: 'POST_NOT_FOUND' } });

    try {
        await Like.create({ post_id: postId, user_id: userId });
        // $inc est atomique : on évite les problèmes si deux personnes likent en même temps
        const updated = await Post.findByIdAndUpdate(
            postId,
            { $inc: { likes_count: 1 } },
            { new: true }
        );

        // Notification envoyée au profil-service
        try {
            await axios.post(`${process.env.PROFIL_SERVICE_URL}/notifications/internal`, {
                recipient_user_id: post.user_id,
                type: 'like',
                from_user_id: userId,
                from_username: username,
                post_id: postId,
            }, {
                headers: { 'x-internal-secret': process.env.INTERNAL_SECRET },
                timeout: 1000 // non bloquant, si ça fail, ça ne crash pas le like
            });
        } catch { /* Notification non critique */ }

        return res.json({ likes_count: updated.likes_count });
    } catch (err) {
        // Erreur 11000 = on a essayé de liker un truc qu'on a déjà liké
        if (err.code === 11000) {
            return res.status(409).json({ error: { code: 'ALREADY_LIKED', message: 'Vous avez déjà liké ce post.' } });
        }
        throw err;
    }
};

// ─── DELETE /posts/:id/like ───────────────────────────────────
exports.unlike = async (req, res) => {
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
    // Math.max(0, ...) permet d'être sûr que le compteur ne passe jamais sous 0
    return res.json({ likes_count: Math.max(0, updated.likes_count) });
};