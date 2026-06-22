const Post = require('../models/post.model');
const Comment = require('../models/comment.model');

// ─── GET /posts/:id/comments ──────────────────────────────────
exports.getComments = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const total = await Comment.countDocuments({ post_id: req.params.id, parent_comment_id: null });
    const comments = await Comment.find({ post_id: req.params.id, parent_comment_id: null })
        .sort({ created_at: 1 })
        .skip(skip)
        .limit(parseInt(limit));

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
  } catch (err) {
    console.error('[Comment] getComments error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── POST /posts/:id/comments ─────────────────────────────────
exports.createComment = async (req, res) => {
  try {
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
  } catch (err) {
    console.error('[Comment] createComment error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── PUT /posts/:id/comments/:commentId ───────────────────────
exports.updateComment = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { content } = req.body;

    if (!content || content.length > 280) {
        return res.status(400).json({ error: { code: 'INVALID_CONTENT' } });
    }

    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: { code: 'COMMENT_NOT_FOUND' } });
    if (comment.user_id !== userId) return res.status(403).json({ error: { code: 'FORBIDDEN' } });

    comment.content = content;
    await comment.save();
    return res.json(comment);
  } catch (err) {
    console.error('[Comment] updateComment error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── DELETE /posts/:id/comments/:commentId ────────────────────
exports.deleteComment = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const role = req.headers['x-user-role'];

    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: { code: 'COMMENT_NOT_FOUND' } });

    const canDelete = comment.user_id === userId || ['moderator', 'admin'].includes(role);
    if (!canDelete) return res.status(403).json({ error: { code: 'FORBIDDEN' } });

    await Comment.findByIdAndDelete(req.params.commentId);
    await Comment.deleteMany({ parent_comment_id: req.params.commentId });
    await Post.findByIdAndUpdate(req.params.id, { $inc: { comments_count: -1 } });

    return res.status(204).send();
  } catch (err) {
    console.error('[Comment] deleteComment error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── POST /posts/:id/comments/:commentId/replies ──────────────
exports.createReply = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const username = req.headers['x-user-username'];
    const { content } = req.body;

    if (!content || content.length > 280) {
        return res.status(400).json({ error: { code: 'INVALID_CONTENT' } });
    }

    const parentComment = await Comment.findById(req.params.commentId);
    if (!parentComment) return res.status(404).json({ error: { code: 'COMMENT_NOT_FOUND' } });

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

    await Post.findByIdAndUpdate(req.params.id, { $inc: { comments_count: 1 } });

    return res.status(201).json(reply);
  } catch (err) {
    console.error('[Comment] createReply error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};
