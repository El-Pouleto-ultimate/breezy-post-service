const express = require('express');
const morgan = require('morgan');
const postRoutes = require('./routes/post.routes');

const app = express();

// --- Middlewares ---
// Permet au serveur de comprendre le JSON qu'on lui envoie
app.use(express.json({ limit: '5mb' }));
// Affiche un joli log dans la console à chaque requête reçue
app.use(morgan('dev'));

// --- Routes ---
// On dit au serveur : "Pour toutes les URL qui commencent par /api, va regarder dans postRoutes"
app.use('/api', postRoutes);

module.exports = app;