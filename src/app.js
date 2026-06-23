const express = require('express');
const morgan = require('morgan');
const path = require('path');
const postRoutes = require('./routes/post.routes');

const app = express();

// --- Middlewares ---
// Permet au serveur de comprendre le JSON qu'on lui envoie
app.use(express.json({ limit: '5mb' }));
// Affiche un joli log dans la console à chaque requête reçue
app.use(morgan('dev'));

// --- Fichiers statiques (uploads) ---
// Sert les fichiers uploades via /api/uploads/nom_fichier
app.use('/api/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// --- Routes ---
// On dit au serveur : "Pour toutes les URL qui commencent par /api, va regarder dans postRoutes"
app.use('/api', postRoutes);

module.exports = app;