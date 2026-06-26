// Import de Mongoose (ODM pour MongoDB)
const mongoose = require('mongoose');

// Fonction asynchrone qui établit la connexion à MongoDB
const connectDB = async () => {
    // Utilise l'URI de connexion stockée dans la variable d'environnement MONGO_URI
    // serverSelectionTimeoutMS définit le délai maximal (ms) pour trouver/joindre un serveur
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
    });

    // Message de log indiquant que la connexion a réussi
    console.log('[Post DB] Connexion MongoDB OK');
};

// Export de la fonction pour l'utiliser depuis d'autres modules
module.exports = connectDB;