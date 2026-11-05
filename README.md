# Breezy: post service

Posts for [Breezy](https://github.com/El-Pouleto-ultimate/breezy-infra), a Twitter-like social network built as
microservices: posts with images, the home feed, search, user timelines, likes, reposts, comments and replies,
reports and @mentions. Likes, comments, replies and mentions notify the people concerned through the profil
service, and mentioning `@breezy_ai` makes a bot reply with a model served through OpenRouter (gpt-oss-20b).

Team project at CESI École d'Ingénieurs (distributed applications, June 2026).

Stack: Node.js 20, Express 5, Mongoose 9 on MongoDB, multer for uploads, axios.

## API

All routes are under `/api`. Through the gateway, every route except `/api/uploads/*` requires a signed-in
user; the service reads the `x-user-id` and `x-user-role` headers the gateway sets.

| Area | Routes |
|---|---|
| Posts | `POST /posts`, `GET /posts/:id`, `PUT /posts/:id`, `DELETE /posts/:id`, `POST /posts/:id/report` |
| Feed and search | `GET /posts/feed`, `GET /posts/search` |
| Timelines | `GET /posts/user/:userId`, plus `/media`, `/likes`, `/replies` and `/reposts` |
| Likes and reposts | `POST /posts/:id/like`, `DELETE /posts/:id/like`, `POST /posts/:id/repost` |
| Comments | `GET /posts/:id/comments`, `POST /posts/:id/comments`, `PUT` and `DELETE /posts/:id/comments/:commentId`, `POST /posts/:id/comments/:commentId/replies` |
| Uploads | `POST /upload` |

Only the author can edit a post or a comment; the author, moderators and admins can delete them.

## Configuration

Copy `.env.example` to `.env`. Variables: `PORT`, `MONGO_URI`, `USER_SERVICE_URL`, `PROFIL_SERVICE_URL`,
`INTERNAL_SECRET`, `CORS_ORIGIN`, and `OPENROUTER_API_KEY`, which is optional and only needed for the bot.

## Run

The whole stack runs with Docker Compose from [breezy-infra](https://github.com/El-Pouleto-ultimate/breezy-infra).
On its own: `npm install`, then `npm run dev` or `npm start`. There are no automated tests yet.
[WIKI.md](WIKI.md), in French, walks through the code: architecture, entry point, models and controllers.

## Team

[Estebge](https://github.com/Estebge), [haguetm](https://github.com/haguetm),
[Jessica14112005](https://github.com/Jessica14112005), [Tuture57](https://github.com/Tuture57).
