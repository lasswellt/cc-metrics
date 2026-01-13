/**
 * Database Setup Module
 *
 * Provides reusable database schema initialization for RethinkDB.
 * Used by both the main server and standalone setup script.
 */

const r = require('rethinkdb');

/**
 * Sets up the RethinkDB database schema
 * Creates database, tables, and indexes if they don't exist
 *
 * @param {Object} connection - Active RethinkDB connection
 * @returns {Promise<void>}
 */
async function setupDatabase(connection) {
  try {
    // Create database if it doesn't exist
    const dbList = await r.dbList().run(connection);
    if (!dbList.includes('metrics')) {
      await r.dbCreate('metrics').run(connection);
      console.log('  ✅ Created database: metrics');
    } else {
      console.log('  ℹ️  Database already exists: metrics');
    }

    // Create tables if they don't exist
    const tableList = await r.db('metrics').tableList().run(connection);

    // Metrics table
    if (!tableList.includes('metrics')) {
      await r.db('metrics').tableCreate('metrics').run(connection);
      console.log('  ✅ Created table: metrics');

      // Create indexes for metrics table
      await r.db('metrics').table('metrics').indexCreate('timestamp').run(connection);
      await r.db('metrics').table('metrics').indexCreate('name').run(connection);
      console.log('  ✅ Created indexes for metrics table');
    } else {
      console.log('  ℹ️  Table already exists: metrics');
    }

    // Events table
    if (!tableList.includes('events')) {
      await r.db('metrics').tableCreate('events').run(connection);
      console.log('  ✅ Created table: events');

      // Create indexes for events table
      await r.db('metrics').table('events').indexCreate('timestamp').run(connection);
      await r.db('metrics').table('events').indexCreate('type').run(connection);
      console.log('  ✅ Created indexes for events table');
    } else {
      console.log('  ℹ️  Table already exists: events');
    }

    // Sessions table
    if (!tableList.includes('sessions')) {
      await r.db('metrics').tableCreate('sessions').run(connection);
      console.log('  ✅ Created table: sessions');

      // Create indexes for sessions table
      await r.db('metrics').table('sessions').indexCreate('sessionId').run(connection);
      await r.db('metrics').table('sessions').indexCreate('lastSeen').run(connection);
      await r.db('metrics').table('sessions').indexCreate('terminalType').run(connection);
      console.log('  ✅ Created indexes for sessions table');
    } else {
      console.log('  ℹ️  Table already exists: sessions');
    }

    // Metric buckets table
    if (!tableList.includes('metric_buckets')) {
      await r.db('metrics').tableCreate('metric_buckets').run(connection);
      console.log('  ✅ Created table: metric_buckets');

      // Create indexes for metric_buckets table
      await r.db('metrics').table('metric_buckets').indexCreate('bucketTime').run(connection);
      await r.db('metrics').table('metric_buckets').indexCreate('lastUpdated').run(connection);
      console.log('  ✅ Created indexes for metric_buckets table');
    } else {
      console.log('  ℹ️  Table already exists: metric_buckets');
    }

    // Aggregated stats table
    if (!tableList.includes('aggregated_stats')) {
      await r.db('metrics').tableCreate('aggregated_stats').run(connection);
      console.log('  ✅ Created table: aggregated_stats');

      // Initialize with empty stats record
      await r.db('metrics').table('aggregated_stats').insert({
        id: 'current',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalCost: 0,
        activeTimeCLI: 0,
        activeTimePlanning: 0,
        activeTimeUser: 0,
        linesOfCode: 0,
        commandsBlocked: 0,
        gitFailures: 0,
        filesModified: 0,
        toolCalls: 0,
        byModel: {},
        lastUpdated: Date.now()
      }).run(connection);
      console.log('  ✅ Initialized aggregated_stats table');
    } else {
      console.log('  ℹ️  Table already exists: aggregated_stats');
    }

    // Claude usage history table
    if (!tableList.includes('claude_usage_history')) {
      await r.db('metrics').tableCreate('claude_usage_history').run(connection);
      console.log('  ✅ Created table: claude_usage_history');

      // Create indexes for claude_usage_history table
      await r.db('metrics').table('claude_usage_history').indexCreate('timestamp').run(connection);
      console.log('  ✅ Created indexes for claude_usage_history table');
    } else {
      console.log('  ℹ️  Table already exists: claude_usage_history');
    }

    console.log('✅ Database schema initialized');
  } catch (err) {
    console.error('❌ Error setting up database schema:', err.message);
    throw err;
  }
}

module.exports = {
  setupDatabase
};
