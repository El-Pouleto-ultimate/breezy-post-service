const axios = require('axios');
const Post = require('../models/post.model');
const Like = require('../models/like.model');
const Comment = require('../models/comment.model');
const Repost = require('../models/repost.model');

// ─── POST /posts ──────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const username = req.headers['x-user-username'];
    const { content, tags = [], media_urls = [] } = req.body;

    if (!content || content.length > 280) {
        return res.status(400).json({ error: { code: 'INVALID_CONTENT', message: 'Contenu invalide (1-280 caractères).' } });
    }
    if (tags.length > 5) {
        return res.status(400).json({ error: { code: 'TOO_MANY_TAGS', message: 'Maximum 5 tags.' } });
    }

    const post = await Post.create({ user_id: userId, username, content, tags, media_urls });

    // --- DÉBUT LOGIQUE MENTIONS (Fx14) ---
    // On vérifie d'abord très vite s'il y a un '@' pour ne pas faire de calculs inutiles
    if (content.includes('@')) {
        // 1. Extraire tous les mots commençant par @ (ex: ["@arthur", "@lucas"])
        const mentionedUsernames = content.match(/@([a-zA-Z0-9_]+)/g);

        if (mentionedUsernames) {
            // 2. Nettoyer pour enlever le '@' (ex: ["arthur", "lucas"])
            const cleanUsernames = mentionedUsernames.map(m => m.substring(1));

            // 3. Pour chaque utilisateur mentionné...
            for (const mentionedName of cleanUsernames) {
                try {
                    // A. On demande au user-service quel est l'ID technique de cet utilisateur
                    // ⚠️ ATTENTION: Prévenez Arthur qu'il doit créer cette route GET !
                    const userRes = await axios.get(`${process.env.USER_SERVICE_URL}/users/by-username/${mentionedName}`, {
                        headers: { 'x-user-id': userId }
                    });
                    const recipientId = userRes.data.id;

                    // B. Si on a trouvé l'ID, on envoie la notification au profil-service
                    if (recipientId && recipientId !== userId) { // (On évite de s'auto-notifier)
                        await axios.post(`${process.env.PROFIL_SERVICE_URL}/notifications/internal`, {
                            recipient_user_id: recipientId,
                            type: 'mention',
                            from_user_id: userId,
                            from_username: username,
                            post_id: post._id
                        }, {
                            // On sécurise l'appel interne comme vous l'avez fait pour les likes
                            headers: { 'x-internal-secret': process.env.INTERNAL_SECRET },
                            timeout: 1000 // Timeout très court pour ne pas ralentir la réponse au client
                        });
                    }
                } catch (err) {
                    // Si le User Service ou le Profil Service crash, on ignore l'erreur
                    // pour que le post soit quand même publié avec succès !
                    console.warn(`[Mention] Impossible de notifier ${mentionedName}`);
                }
            }
        }
    }
    // --- FIN LOGIQUE MENTIONS ---

    return res.status(201).json(post);
  } catch (err) {
    console.error('[Post] create error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── GET /posts/:id ───────────────────────────────────────────
exports.getById = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: { code: 'POST_NOT_FOUND' } });
    return res.json(post);
  } catch (err) {
    console.error('[Post] getById error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── DELETE /posts/:id ────────────────────────────────────────
exports.delete = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const role = req.headers['x-user-role'];
    const post = await Post.findById(req.params.id);

    if (!post) return res.status(404).json({ error: { code: 'POST_NOT_FOUND' } });

    // Auteur OU modérateur/admin peuvent supprimer
    const canDelete = post.user_id === userId || ['moderator', 'admin'].includes(role);
    if (!canDelete) return res.status(403).json({ error: { code: 'FORBIDDEN' } });

    await Post.findByIdAndDelete(req.params.id);
    await Like.deleteMany({ post_id: req.params.id });
    await Comment.deleteMany({ post_id: req.params.id });

    return res.status(204).send();
  } catch (err) {
    console.error('[Post] delete error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── GET /posts/feed (Le flux principal) ──────────────────────
exports.getFeed = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // 1. Récupère les IDs des utilisateurs suivis via le user-service (développé par Arthur)
    let followingIds = [];
    try {
        const response = await axios.get(
            `${process.env.USER_SERVICE_URL}/users/${userId}/following`,
            {
                headers: { 'x-user-id': userId },
                timeout: 3000
            }
        );
        followingIds = response.data.data || [];
    } catch (err) {
        console.warn('[Post] Impossible de récupérer la liste des abonnements :', err.message);
        // On renvoie un feed vide plutôt qu'une erreur 500 pour ne pas tout bloquer
        return res.json({ data: [], pagination: { page: 1, limit, total: 0, hasNext: false } });
    }

    if (followingIds.length === 0) {
        return res.json({ data: [], pagination: { page: 1, limit, total: 0, hasNext: false } });
    }

    // 2. Récupère les posts des gens qu'on suit
    const total = await Post.countDocuments({ user_id: { $in: followingIds } });
    const posts = await Post.find({ user_id: { $in: followingIds } })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit));

    return res.json({
        data: posts,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + posts.length < total }
    });
  } catch (err) {
    console.error('[Post] getFeed error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── GET /posts/user/:userId ──────────────────────────────────
exports.getByUser = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const total = await Post.countDocuments({ user_id: req.params.userId });
    const posts = await Post.find({ user_id: req.params.userId })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit));

    return res.json({
        data: posts,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + posts.length < total }
    });
  } catch (err) {
    console.error('[Post] getByUser error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── GET /posts/search?q=xxx ou ?tag=xxx ────────────────────────────────
exports.searchByTag = async (req, res) => {
    const { tag, page = 1, limit = 20 } = req.query;
    if (!tag) return res.status(400).json({ error: { code: 'MISSING_TAG' } });

    const skip = (page - 1) * limit;
    // On cherche le tag correspondant en minuscules
    const total = await Post.countDocuments({ tags: searchQuery.toLowerCase() });
    const posts = await Post.find({ tags: searchQuery.toLowerCase() })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit));

    return res.json({
        data: posts,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + posts.length < total }
    });
  } catch (err) {
    console.error('[Post] searchByTag error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── POST /posts/:id/report ───────────────────────────────────
exports.report = async (req, res) => {
  try {
    await Post.findByIdAndUpdate(req.params.id, { is_reported: true });
    return res.json({ message: 'Post signalé.' });
  } catch (err) {
    console.error('[Post] report error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── PUT /posts/:id ───────────────────────────────────────────
exports.update = async (req, res) => {
    const userId = req.headers['x-user-id'];
    const { content, tags = [], media_urls = [] } = req.body;

    // 1. Vérification de base
    if (!content || content.length > 280) {
        return res.status(400).json({ error: { code: 'INVALID_CONTENT', message: 'Contenu invalide (1-280 caractères).' } });
    }
    if (tags.length > 5) {
        return res.status(400).json({ error: { code: 'TOO_MANY_TAGS', message: 'Maximum 5 tags.' } });
    }

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: { code: 'POST_NOT_FOUND' } });

    // 2. Sécurité : seul l'auteur peut modifier son post
    if (post.user_id !== userId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Vous ne pouvez modifier que vos propres posts.' } });
    }

    // 3. Mise à jour
    post.content = content;
    post.tags = tags;
    post.media_urls = media_urls;
    await post.save();

    return res.json(post);
};

// ─── GET /posts/user/:userId/media ────────────────────────────
exports.getUserMedia = async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // Astuce MongoDB : "media_urls.0": { $exists: true } vérifie que le tableau contient au moins 1 élément
    const filter = { user_id: req.params.userId, "media_urls.0": { $exists: true } };

    const total = await Post.countDocuments(filter);
    const posts = await Post.find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit));

    return res.json({
        data: posts,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + posts.length < total }
    });
};

// ─── GET /posts/user/:userId/likes ────────────────────────────
exports.getUserLikes = async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // 1. On cherche d'abord dans la table des Likes
    const likes = await Like.find({ user_id: req.params.userId })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit));

    // 2. On extrait uniquement les IDs des posts likés
    const postIds = likes.map(l => l.post_id);

    // 3. On demande à MongoDB de nous sortir tous ces posts d'un coup
    const posts = await Post.find({ _id: { $in: postIds } });

    const total = await Like.countDocuments({ user_id: req.params.userId });

    return res.json({
        data: posts,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + likes.length < total }
    });
};

// ─── GET /posts/user/:userId/replies ──────────────────────────
exports.getUserReplies = async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const total = await Comment.countDocuments({ user_id: req.params.userId });
    // Ici on interroge la table Comment au lieu de Post
    const replies = await Comment.find({ user_id: req.params.userId })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit));

    return res.json({
        data: replies,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + replies.length < total }
    });
};

// ─── POST /posts/:id/repost ───────────────────────────────────
exports.toggleRepost = async (req, res) => {
    const userId = req.headers['x-user-id'];
    const postId = req.params.id;

    const existingRepost = await Repost.findOne({ post_id: postId, user_id: userId });

    if (existingRepost) {
        // Déjà reposté : on supprime (un-repost)
        await Repost.findByIdAndDelete(existingRepost._id);
        const updated = await Post.findByIdAndUpdate(postId, { $inc: { reposts_count: -1 } }, { new: true });
        return res.json({ reposts_count: Math.max(0, updated.reposts_count), reposted: false });
    } else {
        // Pas encore reposté : on le crée
        await Repost.create({ post_id: postId, user_id: userId });
        const updated = await Post.findByIdAndUpdate(postId, { $inc: { reposts_count: 1 } }, { new: true });
        return res.json({ reposts_count: updated.reposts_count, reposted: true });
    }
};

// ─── GET /posts/user/:userId/reposts ──────────────────────────
exports.getUserReposts = async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const reposts = await Repost.find({ user_id: req.params.userId })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit));

    const postIds = reposts.map(r => r.post_id);
    const posts = await Post.find({ _id: { $in: postIds } });
    const total = await Repost.countDocuments({ user_id: req.params.userId });

    return res.json({
        data: posts,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + reposts.length < total }
    });
};