const axios = require('axios');
const Post = require('../models/post.model');
const Like = require('../models/like.model');
const Comment = require('../models/comment.model');
const Repost = require('../models/repost.model');

const BOT_USERNAME = 'breezy_ai';
const BOT_USER_ID = 'a7af3029-cd8b-4cda-b827-aab8095cf800';

async function handleBotReply(post) {
    try {
        const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'openai/gpt-oss-20b:free',
            messages: [
                { role: 'system', content: 'Tu es Breezy AI, un assistant sympa sur un réseau social. Réponds en 280 caractères max, de manière concise et naturelle. Réponds dans la langue du message.' },
                { role: 'user', content: post.content }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        const reply = res.data.choices?.[0]?.message?.content;
        if (!reply) return;

        const trimmed = reply.substring(0, 280);

        await Comment.create({
            post_id: post._id,
            user_id: BOT_USER_ID,
            username: BOT_USERNAME,
            content: trimmed,
            parent_comment_id: null
        });
        await Post.findByIdAndUpdate(post._id, { $inc: { comments_count: 1 } });

        console.log(`[Bot] Réponse postée sur ${post._id}`);
    } catch (err) {
        console.warn('[Bot] Erreur:', err.message);
    }
}

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
                        await axios.post(`${process.env.PROFIL_SERVICE_URL}/api/notifications/internal`, {
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

    // --- BOT IA : répondre si @breezy-ai est mentionné ---
    if (content.toLowerCase().includes(`@${BOT_USERNAME}`)) {
        handleBotReply(post);
    }

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

    let followingIds = [];
    try {
        const response = await axios.get(
            `${process.env.USER_SERVICE_URL}/users/${userId}/following`,
            {
                headers: { 'x-user-id': userId },
                timeout: 3000
            }
        );
        followingIds = response.data.ids || response.data.data || [];
    } catch (err) {
        console.warn('[Post] Impossible de récupérer la liste des abonnements :', err.message);
    }

    const feedUserIds = [...new Set([userId, ...followingIds])];

    const total = await Post.countDocuments({ user_id: { $in: feedUserIds } });
    const posts = await Post.find({ user_id: { $in: feedUserIds } })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit));

    const postIds = posts.map(p => p._id);
    const [userLikes, userReposts] = await Promise.all([
      Like.find({ user_id: userId, post_id: { $in: postIds } }),
      Repost.find({ user_id: userId, post_id: { $in: postIds } }),
    ]);
    const likedSet = new Set(userLikes.map(l => l.post_id.toString()));
    const repostedSet = new Set(userReposts.map(r => r.post_id.toString()));

    const enriched = posts.map(p => ({
      ...p.toObject(),
      likedByMe: likedSet.has(p._id.toString()),
      repostedByMe: repostedSet.has(p._id.toString()),
    }));

    return res.json({
        data: enriched,
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
  try {
    const { q, tag, page = 1, limit = 20 } = req.query;
    const searchTerm = q || tag;
    if (!searchTerm) return res.status(400).json({ error: { code: 'MISSING_QUERY', message: 'Parametre q ou tag requis.' } });

    const skip = (page - 1) * limit;
    const filter = {
      $or: [
        { content: { $regex: searchTerm, $options: 'i' } },
        { tags: searchTerm.toLowerCase() },
        { username: { $regex: searchTerm, $options: 'i' } },
      ]
    };

    const total = await Post.countDocuments(filter);
    const posts = await Post.find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit));

    return res.json({
        data: posts,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + posts.length < total }
    });
  } catch (err) {
    console.error('[Post] search error:', err);
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
  try {
    const userId = req.headers['x-user-id'];
    const { content, tags = [], media_urls } = req.body;

    if (!content || content.length > 280) {
        return res.status(400).json({ error: { code: 'INVALID_CONTENT', message: 'Contenu invalide (1-280 caractères).' } });
    }
    if (tags.length > 5) {
        return res.status(400).json({ error: { code: 'TOO_MANY_TAGS', message: 'Maximum 5 tags.' } });
    }

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: { code: 'POST_NOT_FOUND' } });

    if (post.user_id !== userId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Vous ne pouvez modifier que vos propres posts.' } });
    }

    post.content = content;
    post.tags = tags;
    // Only update media_urls if explicitly provided (preserve existing photos otherwise)
    if (media_urls !== undefined) {
      post.media_urls = media_urls;
    }
    await post.save();

    return res.json(post);
  } catch (err) {
    console.error('[Post] update error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── GET /posts/user/:userId/media ────────────────────────────
exports.getUserMedia = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const filter = { user_id: req.params.userId, "media_urls.0": { $exists: true } };
    const total = await Post.countDocuments(filter);
    const posts = await Post.find(filter).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit));
    return res.json({ data: posts, pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + posts.length < total } });
  } catch (err) {
    console.error('[Post] getUserMedia error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── GET /posts/user/:userId/likes ────────────────────────────
exports.getUserLikes = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const likes = await Like.find({ user_id: req.params.userId }).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit));
    const postIds = likes.map(l => l.post_id);
    const posts = await Post.find({ _id: { $in: postIds } });
    const total = await Like.countDocuments({ user_id: req.params.userId });
    return res.json({ data: posts, pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + likes.length < total } });
  } catch (err) {
    console.error('[Post] getUserLikes error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── GET /posts/user/:userId/replies ──────────────────────────
exports.getUserReplies = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const total = await Comment.countDocuments({ user_id: req.params.userId });
    const replies = await Comment.find({ user_id: req.params.userId }).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit));
    return res.json({ data: replies, pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + replies.length < total } });
  } catch (err) {
    console.error('[Post] getUserReplies error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── POST /posts/:id/repost ───────────────────────────────────
exports.toggleRepost = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const postId = req.params.id;

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: { code: 'POST_NOT_FOUND' } });

    const existingRepost = await Repost.findOne({ post_id: postId, user_id: userId });

    if (existingRepost) {
        await Repost.findByIdAndDelete(existingRepost._id);
        const updated = await Post.findByIdAndUpdate(postId, { $inc: { reposts_count: -1 } }, { new: true });
        return res.json({ reposts_count: Math.max(0, updated.reposts_count), reposted: false });
    } else {
        await Repost.create({ post_id: postId, user_id: userId });
        const updated = await Post.findByIdAndUpdate(postId, { $inc: { reposts_count: 1 } }, { new: true });
        return res.json({ reposts_count: updated.reposts_count, reposted: true });
    }
  } catch (err) {
    console.error('[Post] toggleRepost error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── POST /upload ─────────────────────────────────────────────
exports.uploadMedia = async (req, res) => {
  try {
    // Erreurs multer (fichier trop gros, mauvais format) — multer les met dans req.fileValidationError
    // ou via l'error handler du middleware
    if (req.fileValidationError) {
      return res.status(400).json({ error: { code: 'INVALID_FILE', message: req.fileValidationError } });
    }
    if (!req.file) {
      return res.status(400).json({ error: { code: 'NO_FILE', message: 'Aucun fichier fourni.' } });
    }
    const url = `/api/uploads/${req.file.filename}`;
    return res.status(201).json({ url });
  } catch (err) {
    console.error('[Post] uploadMedia error:', err);
    return res.status(500).json({ error: { code: 'UPLOAD_ERROR', message: 'Erreur lors de l\'upload.' } });
  }
};

// Middleware de gestion des erreurs multer (fichier trop gros, mauvais type...)
exports.handleUploadError = (err, req, res, next) => {
  if (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'Image trop volumineuse (max 5 Mo).' } });
    }
    if (err.message === 'Seules les images sont autorisees') {
      return res.status(400).json({ error: { code: 'INVALID_FILE', message: 'Format non supporté. Seules les images sont autorisées.' } });
    }
    return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.message || 'Erreur lors de l\'upload.' } });
  }
  next();
};

// ─── GET /posts/user/:userId/reposts ──────────────────────────
exports.getUserReposts = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const reposts = await Repost.find({ user_id: req.params.userId }).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit));
    const postIds = reposts.map(r => r.post_id);
    const posts = await Post.find({ _id: { $in: postIds } });
    const total = await Repost.countDocuments({ user_id: req.params.userId });
    return res.json({ data: posts, pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + reposts.length < total } });
  } catch (err) {
    console.error('[Post] getUserReposts error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};