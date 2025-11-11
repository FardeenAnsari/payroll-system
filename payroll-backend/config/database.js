const { Sequelize } = require('sequelize');
require('dotenv').config();

// Log the target DB host (redacted) so we can confirm which DATABASE_URL is used at runtime.
if (process.env.DATABASE_URL) {
  try {
    const url = process.env.DATABASE_URL;
    // Show everything after the '@' (host:port/db) but avoid printing the password
    const afterAt = url.includes('@') ? url.split('@')[1] : url;
    console.log('Using DATABASE host:', afterAt);
  } catch (e) {
    // ignore logging errors
  }
} else {
  console.log('DATABASE_URL is not set in environment');
}

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false, // For Supabase SSL
    },
  },
});

// Test the connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connection to the database has been established successfully.');
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
  }
};

module.exports = { sequelize, testConnection };
