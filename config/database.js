/**
 * Shared Database Configuration Module
 *
 * Provides centralized RethinkDB connection configuration and helper functions
 * used across server.js, setup-db.js, and recalc-stats.js
 */

const r = require('rethinkdb');

// Database configuration
const dbConfig = {
  host: process.env.RETHINKDB_HOST || 'localhost',
  port: parseInt(process.env.RETHINKDB_PORT || '28015', 10),
  db: process.env.RETHINKDB_DB || 'metrics',
};

/**
 * Creates a connection to RethinkDB
 * @returns {Promise<Connection>} RethinkDB connection object
 * @throws {Error} If connection fails
 */
async function connect() {
  try {
    const connection = await r.connect(dbConfig);
    return connection;
  } catch (err) {
    console.error('Failed to connect to RethinkDB:', err.message);
    throw err;
  }
}

module.exports = {
  r,
  dbConfig,
  connect
};
