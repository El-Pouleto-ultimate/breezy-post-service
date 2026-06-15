const router = require('express').Router();
const postCtrl = require('../controllers/post.controller');
const likeCtrl = require('../controllers/like.controller');
const commentCtrl = require('../controllers/comment.controller');

// Feed et recherche (doivent être mis avant les routes avec ":id" pour éviter les conflits)
router.get('/posts/feed', postCtrl.getFeed);
router.get('/posts/search', postCtrl.searchByTag);
router.get('/posts/user/:userId', postCtrl.getByUser);

router.post('/posts', postCtrl.create);
router.get('/posts/:id', postCtrl.getById);
router.delete('/posts/:id', postCtrl.delete);
router.post('/posts/:id/report', postCtrl.report);

router.post('/posts/:id/like', likeCtrl.like);
router.delete('/posts/:id/like', likeCtrl.unlike);

router.get('/posts/:id/comments', commentCtrl.getComments);
router.post('/posts/:id/comments', commentCtrl.createComment);
router.post('/posts/:id/comments/:commentId/replies', commentCtrl.createReply);

module.exports = router;