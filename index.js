require('dotenv').config(); // Charge les variables du fichier .env
const app = require('./src/app');
const connectDB = require('./src/config/database');

const PORT = process.env.PORT || 3003; // Le post-service tournera sur le port 3003 pour correspondre à l'infrastructure Docker

// On se connecte d'abord à la base de données...
connectDB().then(() => {
    // ... puis on lance le serveur web
    app.listen(PORT, () => {
        console.log(`[Post Service] Serveur démarré sur http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('[Post Service] Erreur fatale de connexion DB:', err);
    process.exit(1);
});