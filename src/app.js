const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const postRoutes = require('./routes/post.routes');

const app = express();

// --- Middlewares ---
// CORS pour les requêtes cross-origin
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Id', 'X-User-Role', 'X-User-Username'],
  credentials: true,
}));
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

// --- Gestion globale des erreurs ---
app.use((err, req, res, next) => {
  console.error('[post-service] Erreur non gérée:', err.message);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Erreur serveur.'
    }
  });
});

module.exports = app;