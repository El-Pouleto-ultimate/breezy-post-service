const axios = require('axios');
const Post = require('../models/post.model');
const Like = require('../models/like.model');
const Comment = require('../models/comment.model');
const Repost = require('../models/repost.model');

const BOT_USERNAME = 'breezy_ai';
const BOT_USER_ID = 'a7af3029-cd8b-4cda-b827-aab8095cf800';

// 🤖 Fonction interne gérant la réponse automatique de Breezy AI
async function handleBotReply(post) {
    try {
        // 1. Appel HTTP externe vers l'API OpenRouter (utilisation d'un modèle gratuit)
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

        // Tronquer à 280 caractères par sécurité
        const trimmed = reply.substring(0, 280);

        // 2. Écrit le commentaire de l'IA dans MongoDB sous le post de l'utilisateur
        await Comment.create({
            post_id: post._id,
            user_id: BOT_USER_ID,
            username: BOT_USERNAME,
            content: trimmed,
            parent_comment_id: null
        });

        // 3. Incrémente le compteur global de commentaires du post
        await Post.findByIdAndUpdate(post._id, { $inc: { comments_count: 1 } });

        console.log(`[Bot] Réponse postée sur ${post._id}`);
    } catch (err) {
        console.warn('[Bot] Erreur:', err.message);
    }
}

// ─── POST /posts ──────────────────────────────────────────────
// Crée un nouveau post, gère les mentions (@) et appelle le bot IA si mentionné.
exports.create = async (req, res) => {
  try {
    const userId = req.headers['x-user-id']; // Identité injectée par la Gateway
    const username = req.headers['x-user-username'];
    const { content, tags = [], media_urls = [] } = req.body;

    // Validation des limites métiers
    if (!content || content.length > 280) {
        return res.status(400).json({ error: { code: 'INVALID_CONTENT', message: 'Contenu invalide (1-280 caractères).' } });
    }
    if (tags.length > 5) {
        return res.status(400).json({ error: { code: 'TOO_MANY_TAGS', message: 'Maximum 5 tags.' } });
    }

    // 1. Enregistrement en base de données MongoDB
    const post = await Post.create({ user_id: userId, username, content, tags, media_urls });

    // --- LOGIQUE MENTIONS (Fx14) ---
    if (content.includes('@')) {
        // A. Extraction des mots commençant par @
        const mentionedUsernames = content.match(/@([a-zA-Z0-9_]+)/g);

        if (mentionedUsernames) {
            // Nettoyage du préfixe '@'
            const cleanUsernames = mentionedUsernames.map(m => m.substring(1));

            for (const mentionedName of cleanUsernames) {
                try {
                    // B. Appel HTTP au user-service pour obtenir l'ID de l'utilisateur mentionné par son pseudo
                    const userRes = await axios.get(`${process.env.USER_SERVICE_URL}/users/by-username/${mentionedName}`, {
                        headers: { 'x-user-id': userId }
                    });
                    const recipientId = userRes.data.id;

                    // C. Envoi d'une notification de type 'mention' au profil-service (si ce n'est pas une auto-mention)
                    if (recipientId && recipientId !== userId) {
                        await axios.post(`${process.env.PROFIL_SERVICE_URL}/api/notifications/internal`, {
                            recipient_user_id: recipientId,
                            type: 'mention',
                            from_user_id: userId,
                            from_username: username,
                            post_id: post._id
                        }, {
                            headers: { 'x-internal-secret': process.env.INTERNAL_SECRET },
                            timeout: 1000 // Timeout court (1s) pour ne pas bloquer l'utilisateur principal en cas de lenteur du service de notifs
                        });
                    }
                } catch (err) {
                    console.warn(`[Mention] Impossible de notifier ${mentionedName} :`, err.message);
                }
            }
        }
    }

    // --- APPEL DU BOT IA (BREEZY AI) ---
    if (content.toLowerCase().includes(`@${BOT_USERNAME}`)) {
        handleBotReply(post); // Appel asynchrone non bloquant pour le client
    }

    return res.status(201).json(post);
  } catch (err) {
    console.error('[Post] create error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── GET /posts/:id ───────────────────────────────────────────
// Récupère un post par son identifiant unique MongoDB (_id).
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
// Supprime un post, ses likes associés et ses commentaires.
exports.delete = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const role = req.headers['x-user-role'];
    const post = await Post.findById(req.params.id);

    if (!post) return res.status(404).json({ error: { code: 'POST_NOT_FOUND' } });

    // Règle de sécurité : Seul l'auteur du post OU un modérateur/admin peut le supprimer
    const canDelete = post.user_id === userId || ['moderator', 'admin'].includes(role);
    if (!canDelete) return res.status(403).json({ error: { code: 'FORBIDDEN' } });

    // Nettoyage en cascade dans MongoDB
    await Post.findByIdAndDelete(req.params.id);
    await Like.deleteMany({ post_id: req.params.id });
    await Comment.deleteMany({ post_id: req.params.id });

    return res.status(204).send();
  } catch (err) {
    console.error('[Post] delete error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── GET /posts/feed ──────────────────────────────────────────
// Récupère le fil d'actualité personnalisé (les posts de l'utilisateur + ceux de ses abonnements).
exports.getFeed = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // 1. Appel HTTP au user-service pour obtenir la liste des identifiants des personnes suivies
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

    // On combine l'utilisateur connecté et ses abonnements dans un tableau unique sans doublons
    const feedUserIds = [...new Set([userId, ...followingIds])];

    // 2. Récupération des posts paginés correspondants dans MongoDB
    const total = await Post.countDocuments({ user_id: { $in: feedUserIds } });
    const posts = await Post.find({ user_id: { $in: feedUserIds } })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit));

    // 3. Récupération en parallèle des likes et reposts pour enrichir le retour vers le front (éviter de multiples requêtes)
    const postIds = posts.map(p => p._id);
    const [userLikes, userReposts] = await Promise.all([
      Like.find({ user_id: userId, post_id: { $in: postIds } }),
      Repost.find({ user_id: userId, post_id: { $in: postIds } }),
    ]);
    const likedSet = new Set(userLikes.map(l => l.post_id.toString()));
    const repostedSet = new Set(userReposts.map(r => r.post_id.toString()));

    // Ajout des drapeaux booléens likedByMe et repostedByMe
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
// Récupère les posts écrits par un utilisateur spécifique.
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
// Recherche des posts par mots-clés ou tags (insensible à la casse via regex MongoDB).
exports.searchByTag = async (req, res) => {
  try {
    const { q, tag, page = 1, limit = 20 } = req.query;
    const searchTerm = q || tag;
    if (!searchTerm) return res.status(400).json({ error: { code: 'MISSING_QUERY', message: 'Parametre q ou tag requis.' } });

    const skip = (page - 1) * limit;
    // Recherche par regex sur le contenu, le tag exact ou le pseudo
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
// Signale un post inapproprié en changeant sa valeur is_reported.
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
// Modifie le contenu d'un post existant.
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

    // Sécurité : Seul l'auteur du post peut le modifier
    if (post.user_id !== userId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Vous ne pouvez modifier que vos propres posts.' } });
    }

    post.content = content;
    post.tags = tags;
    // On met à jour la liste des images uniquement si elle est explicitement fournie
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
// Récupère uniquement les posts contenant des images d'un utilisateur donné.
exports.getUserMedia = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    // Filtre : posts de l'auteur contenant au moins 1 élément dans media_urls
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
// Récupère les posts aimés par un utilisateur.
exports.getUserLikes = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    // Récupère les liaisons de likes
    const likes = await Like.find({ user_id: req.params.userId }).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit));
    const postIds = likes.map(l => l.post_id);
    // Récupère les objets posts associés
    const posts = await Post.find({ _id: { $in: postIds } });
    const total = await Like.countDocuments({ user_id: req.params.userId });
    return res.json({ data: posts, pagination: { page: parseInt(page), limit: parseInt(limit), total, hasNext: skip + likes.length < total } });
  } catch (err) {
    console.error('[Post] getUserLikes error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur.' } });
  }
};

// ─── GET /posts/user/:userId/replies ──────────────────────────
// Récupère tous les commentaires et réponses écrits par un utilisateur.
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
// Permet de reposter ou d'annuler un repost sur un message (bouton bascule).
exports.toggleRepost = async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const postId = req.params.id;

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: { code: 'POST_NOT_FOUND' } });

    const existingRepost = await Repost.findOne({ post_id: postId, user_id: userId });

    if (existingRepost) {
        // Déjà reposté -> on supprime le repost et on décrémente le compteur
        await Repost.findByIdAndDelete(existingRepost._id);
        const updated = await Post.findByIdAndUpdate(postId, { $inc: { reposts_count: -1 } }, { new: true });
        return res.json({ reposts_count: Math.max(0, updated.reposts_count), reposted: false });
    } else {
        // Non reposté -> on crée le repost et on incrémente le compteur
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
// Point d'entrée pour l'upload d'un fichier média.
exports.uploadMedia = async (req, res) => {
  try {
    if (req.fileValidationError) {
      return res.status(400).json({ error: { code: 'INVALID_FILE', message: req.fileValidationError } });
    }
    if (!req.file) {
      return res.status(400).json({ error: { code: 'NO_FILE', message: 'Aucun fichier fourni.' } });
    }
    // Génère l'URL publique locale relative
    const url = `/api/uploads/${req.file.filename}`;
    return res.status(201).json({ url });
  } catch (err) {
    console.error('[Post] uploadMedia error:', err);
    return res.status(500).json({ error: { code: 'UPLOAD_ERROR', message: 'Erreur lors de l\'upload.' } });
  }
};

// Middleware d'interception et de formatage des erreurs Multer (fichier trop gros, etc.)
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
// Récupère la liste de tous les messages repostés par un utilisateur.
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