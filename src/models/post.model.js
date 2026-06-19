const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
    user_id: { type: String, required: true, index: true },
    username: { type: String, required: true },
    content: { type: String, required: true, maxlength: 280 },
    tags: [{ type: String, maxlength: 30 }],
    media_urls: [String],
    likes_count: { type: Number, default: 0, min: 0 },
    comments_count: { type: Number, default: 0, min: 0 },
    reposts_count: { type: Number, default: 0, min: 0 },
    is_reported: { type: Boolean, default: false },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

postSchema.index({ user_id: 1, created_at: -1 });
postSchema.index({ tags: 1 });
postSchema.index({ created_at: -1 });

module.exports = mongoose.model('Post', postSchema);