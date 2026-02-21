#!/usr/bin/env node

/**
 * RethinkDB Database Setup Script
 *
 * Standalone script to initialize the RethinkDB database schema.
 * Can be run manually with: npm run setup
 *
 * This script is also automatically run when the server starts for the first time.
 */

const { setupDatabase } = require('./db-setup');
const { r, dbConfig, connect } = require('./config/database');

async function main() {
  console.log('🚀 RethinkDB Database Setup\n');
  console.log(`Configuration:`);
  console.log(`  Host: ${dbConfig.host}`);
  console.log(`  Port: ${dbConfig.port}`);
  console.log(`  Database: ${dbConfig.db}\n`);

  let connection;

  try {
    // Connect to RethinkDB
    console.log(`🔌 Connecting to RethinkDB at ${dbConfig.host}:${dbConfig.port}...`);
    connection = await connect();
    console.log('✅ Connected to RethinkDB\n');

    // Run database setup
    console.log('📦 Setting up database schema...\n');
    await setupDatabase(connection);

    console.log('\n✨ Database setup complete!');
    console.log('   You can now start the server with: npm start');
    console.log('   Or access RethinkDB admin UI at: http://localhost:8081\n');

    process.exit(0);

  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error('\n❌ ERROR: Cannot connect to RethinkDB\n');
      console.error('RethinkDB is not running. Please start it first:\n');
      console.error('  Option 1 (Local):');
      console.error('    rethinkdb\n');
      console.error('  Option 2 (Docker):');
      console.error('    docker run -d --name rethinkdb -p 28015:28015 -p 8081:8080 rethinkdb\n');
      console.error('After starting RethinkDB, run this script again: npm run setup\n');
      process.exit(1);
    } else if (error.code === 'ETIMEDOUT' || error.code === 'EHOSTUNREACH') {
      console.error('\n❌ ERROR: Cannot reach RethinkDB server\n');
      console.error('Network issue or incorrect host/port configuration.\n');
      console.error(`  Current configuration: ${dbConfig.host}:${dbConfig.port}\n`);
      console.error('  Set RETHINKDB_HOST and RETHINKDB_PORT environment variables if needed.\n');
      process.exit(1);
    } else {
      console.error('\n❌ Setup failed:', error.message);
      console.error('\nStack trace:');
      console.error(error.stack);
      console.error('\nPlease check:');
      console.error('  - RethinkDB is running and accessible');
      console.error('  - You have permissions to create databases and tables');
      console.error('  - RethinkDB admin UI for more details: http://localhost:8081\n');
      process.exit(1);
    }
  } finally {
    // Close connection
    if (connection) {
      try {
        await connection.close();
        console.log('🔌 Connection closed');
      } catch (closeError) {
        // Ignore close errors
      }
    }
  }
}

// Run main function
main();
