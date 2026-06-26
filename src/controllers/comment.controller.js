const Post = require('../models/post.model');
const Comment = require('../models/comment.model');

// ─── GET /posts/:id/comments ──────────────────────────────────
// Récupère la liste paginée des commentaires d'un post donné.
// Gère également la récupération des réponses de niveau 2 (replies).
exports.getComments = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // 1. Compte total des commentaires de niveau 1 (parent_comment_id est null)
    const total = await Comment.countDocuments({ post_id: req.params.id, parent_comment_id: null });
    
    // 2. Recherche paginée des commentaires de niveau 1 triés par ordre chronologique
    const comments = await Comment.find({ post_id: req.params.id, parent_comment_id: null })
        .sort({ created_at: 1 })
        .skip(skip)
        .limit(parseInt(limit));

    // 3. Pour chaque commentaire récupéré, on va chercher ses réponses de niveau 2
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
// Crée un nouveau commentaire de niveau 1 sous un post.
exports.createComment = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const username = req.headers['x-user-username'];
    const { content } = req.body;

    // 1. Validation de la longueur
    if (!content || content.length > 280) {
        return res.status(400).json({ error: { code: 'INVALID_CONTENT' } });
    }

    // 2. Vérification que le post ciblé existe
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: { code: 'POST_NOT_FOUND' } });

    // 3. Enregistrement en base de données
    const comment = await Comment.create({
        post_id: req.params.id, user_id: userId, username, content, parent_comment_id: null
    });

    // 4. Incrémentation du compteur global de commentaires sur le post parent
    await Post.findByIdAndUpdate(req.params.id, { $inc: { comments_count: 1 } });

    return res.status(201).json(comment);
  } catch (err) {
    console.error('[Comment] createComment error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── PUT /posts/:id/comments/:commentId ───────────────────────
// Met à jour le contenu textuel d'un commentaire.
exports.updateComment = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { content } = req.body;

    if (!content || content.length > 280) {
        return res.status(400).json({ error: { code: 'INVALID_CONTENT' } });
    }

    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: { code: 'COMMENT_NOT_FOUND' } });
    
    // Sécurité : Seul l'auteur du commentaire peut le modifier
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
// Supprime un commentaire et ses réponses associées.
exports.deleteComment = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const role = req.headers['x-user-role'];

    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ error: { code: 'COMMENT_NOT_FOUND' } });

    // Sécurité : L'auteur OU un modérateur/admin peut effectuer la suppression
    const canDelete = comment.user_id === userId || ['moderator', 'admin'].includes(role);
    if (!canDelete) return res.status(403).json({ error: { code: 'FORBIDDEN' } });

    // Suppression du commentaire principal et de toutes ses réponses enfants (niveau 2)
    await Comment.findByIdAndDelete(req.params.commentId);
    await Comment.deleteMany({ parent_comment_id: req.params.commentId });
    
    // Décrémentation du compteur de commentaires sur le post parent
    await Post.findByIdAndUpdate(req.params.id, { $inc: { comments_count: -1 } });

    return res.status(204).send();
  } catch (err) {
    console.error('[Comment] deleteComment error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── POST /posts/:id/comments/:commentId/replies ──────────────
// Crée une réponse à un commentaire existant (niveau 2).
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

    // Règle métier : On ne peut pas répondre à un commentaire de niveau 2 (profondeur max = 2)
    if (parentComment.parent_comment_id) {
        return res.status(400).json({ error: { code: 'MAX_DEPTH', message: 'Réponse à une réponse non autorisée.' } });
    }

    // Création de la réponse en base (en y associant le parent_comment_id)
    const reply = await Comment.create({
        post_id: req.params.id,
        user_id: userId,
        username,
        content,
        parent_comment_id: req.params.commentId
    });

    // Incrémentation globale sur le post
    await Post.findByIdAndUpdate(req.params.id, { $inc: { comments_count: 1 } });

    return res.status(201).json(reply);
  } catch (err) {
    console.error('[Comment] createReply error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};
