const mongoose = require('mongoose');

const repostSchema = new mongoose.Schema({
    post_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
    user_id: { type: String, required: true },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: false }
});

// Pour empêcher un utilisateur de reposter 50 fois le même post
repostSchema.index({ post_id: 1, user_id: 1 }, { unique: true });

module.exports = mongoose.model('Repost', repostSchema);