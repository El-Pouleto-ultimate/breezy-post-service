const Post = require('../models/post.model');
const Comment = require('../models/comment.model');

// ─── GET /posts/:id/comments ──────────────────────────────────
exports.getComments = async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // Récupère les commentaires principaux (ceux qui ne sont pas des réponses)
    const total = await Comment.countDocuments({ post_id: req.params.id, parent_comment_id: null });
    const comments = await Comment.find({ post_id: req.params.id, parent_comment_id: null })
        .sort({ created_at: 1 })
        .skip(skip)
        .limit(parseInt(limit));

    // Pour chaque commentaire, on va aussi chercher les réponses associées
    const commentsWithReplies = await Promise.all(
        comments.map(async (comment) => {
            const replies = await Comment.find({ parent_comment_id: comment._id }).sort({ created_at: 1 });
            return { ...comment.toObject(), replies };
        })
    );

    return res.json({
        data: commentsWithReplies,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + comments.length < total }
    });
};

// ─── POST /posts/:id/comments ─────────────────────────────────
exports.createComment = async (req, res) => {
    const userId = req.headers['x-user-id'];
    const username = req.headers['x-user-username'];
    const { content } = req.body;

    if (!content || content.length > 280) {
        return res.status(400).json({ error: { code: 'INVALID_CONTENT' } });
    }

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: { code: 'POST_NOT_FOUND' } });

    const comment = await Comment.create({
        post_id: req.params.id, user_id: userId, username, content, parent_comment_id: null
    });

    await Post.findByIdAndUpdate(req.params.id, { $inc: { comments_count: 1 } });

    return res.status(201).json(comment);
};

// ─── POST /posts/:id/comments/:commentId/replies ──────────────
exports.createReply = async (req, res) => {
    const userId = req.headers['x-user-id'];
    const username = req.headers['x-user-username'];
    const { content } = req.body;

    const parentComment = await Comment.findById(req.params.commentId);
    if (!parentComment) return res.status(404).json({ error: { code: 'COMMENT_NOT_FOUND' } });

    // Interdit de répondre à une réponse (pour éviter l'effet "poupée russe" infini)
    if (parentComment.parent_comment_id) {
        return res.status(400).json({ error: { code: 'MAX_DEPTH', message: 'Réponse à une réponse non autorisée.' } });
    }

    const reply = await Comment.create({
        post_id: req.params.id,
        user_id: userId,
        username,
        content,
        parent_comment_id: req.params.commentId
    });

    return res.status(201).json(reply);
};