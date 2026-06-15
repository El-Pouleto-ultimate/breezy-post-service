const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    post_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
    user_id: { type: String, required: true },
    username: { type: String, required: true },
    content: { type: String, required: true, maxlength: 280 },
    parent_comment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

commentSchema.index({ post_id: 1, created_at: 1 });
commentSchema.index({ parent_comment_id: 1 });

module.exports = mongoose.model('Comment', commentSchema);