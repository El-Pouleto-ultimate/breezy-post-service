const axios = require('axios');
const Post = require('../models/post.model');
const Like = require('../models/like.model');
const Comment = require('../models/comment.model');

// ─── POST /posts ──────────────────────────────────────────────
exports.create = async (req, res) => {
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
    return res.status(201).json(post);
};

// ─── GET /posts/:id ───────────────────────────────────────────
exports.getById = async (req, res) => {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: { code: 'POST_NOT_FOUND' } });
    return res.json(post);
};

// ─── DELETE /posts/:id ────────────────────────────────────────
exports.delete = async (req, res) => {
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
};

// ─── GET /posts/feed (Le flux principal) ──────────────────────
exports.getFeed = async (req, res) => {
    const userId = req.headers['x-user-id'];
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // 1. Récupère les IDs des utilisateurs suivis via le user-service (développé par Arthur)
    let followingIds = [];
    try {
        const response = await axios.get(
            `${process.env.USER_SERVICE_URL}/users/${userId}/following`,
            { timeout: 3000 }
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
};

// ─── GET /posts/user/:userId ──────────────────────────────────
exports.getByUser = async (req, res) => {
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
};

// ─── GET /posts/search?tag=xxx ────────────────────────────────
exports.searchByTag = async (req, res) => {
    const { tag, page = 1, limit = 20 } = req.query;
    if (!tag) return res.status(400).json({ error: { code: 'MISSING_TAG' } });

    const skip = (page - 1) * limit;
    const total = await Post.countDocuments({ tags: tag.toLowerCase() });
    const posts = await Post.find({ tags: tag.toLowerCase() })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit));

    return res.json({
        data: posts,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + posts.length < total }
    });
};

// ─── POST /posts/:id/report ───────────────────────────────────
exports.report = async (req, res) => {
    await Post.findByIdAndUpdate(req.params.id, { is_reported: true });
    return res.json({ message: 'Post signalé.' });
};