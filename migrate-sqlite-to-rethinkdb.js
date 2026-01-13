#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const r = require('rethinkdb');

// Configuration
const SQLITE_DB_PATH = './metrics.db';
const RETHINKDB_CONFIG = {
  host: process.env.RETHINKDB_HOST || 'localhost',
  port: process.env.RETHINKDB_PORT || 28015,
  db: 'metrics'
};

let dbConnection = null;

// Initialize RethinkDB connection and schema
async function initializeRethinkDB() {
  try {
    console.log('🔌 Connecting to RethinkDB...');
    dbConnection = await r.connect(RETHINKDB_CONFIG);
    console.log('✅ Connected to RethinkDB via WebSocket');

    // Create database if it doesn't exist
    const dbList = await r.dbList().run(dbConnection);
    if (!dbList.includes('metrics')) {
      await r.dbCreate('metrics').run(dbConnection);
      console.log('  ✅ Created database: metrics');
    }

    // Create tables if they don't exist
    const tableList = await r.db('metrics').tableList().run(dbConnection);

    if (!tableList.includes('metrics')) {
      await r.db('metrics').tableCreate('metrics').run(dbConnection);
      console.log('  ✅ Created table: metrics');

      // Create indexes for metrics table
      await r.db('metrics').table('metrics').indexCreate('timestamp').run(dbConnection);
      await r.db('metrics').table('metrics').indexCreate('name').run(dbConnection);
      console.log('  ✅ Created indexes for metrics table');
    }

    if (!tableList.includes('events')) {
      await r.db('metrics').tableCreate('events').run(dbConnection);
      console.log('  ✅ Created table: events');

      // Create indexes for events table
      await r.db('metrics').table('events').indexCreate('timestamp').run(dbConnection);
      await r.db('metrics').table('events').indexCreate('type').run(dbConnection);
      console.log('  ✅ Created indexes for events table');
    }

    console.log('✅ RethinkDB schema initialized\n');
    return dbConnection;
  } catch (err) {
    console.error('❌ Error initializing RethinkDB:', err);
    throw err;
  }
}

// Read all data from SQLite
function readFromSQLite() {
  return new Promise((resolve, reject) => {
    console.log('📖 Reading data from SQLite...');
    const db = new sqlite3.Database(SQLITE_DB_PATH, (err) => {
      if (err) {
        return reject(err);
      }
    });

    const data = { metrics: [], events: [] };

    // Read all metrics
    db.all('SELECT * FROM metrics ORDER BY timestamp ASC', (err, rows) => {
      if (err) {
        return reject(err);
      }

      data.metrics = rows.map(row => ({
        timestamp: row.timestamp,
        name: row.name,
        value: row.value,
        attributes: JSON.parse(row.attributes || '{}'),
        model: row.model
      }));

      console.log(`  ✅ Read ${data.metrics.length} metrics from SQLite`);

      // Read all events
      db.all('SELECT * FROM events ORDER BY timestamp ASC', (err, rows) => {
        if (err) {
          return reject(err);
        }

        data.events = rows.map(row => ({
          timestamp: row.timestamp,
          type: row.type,
          body: row.body,
          attributes: JSON.parse(row.attributes || '{}'),
          severity: row.severity
        }));

        console.log(`  ✅ Read ${data.events.length} events from SQLite\n`);

        db.close();
        resolve(data);
      });
    });
  });
}

// Insert data into RethinkDB
async function insertIntoRethinkDB(data) {
  console.log('📝 Inserting data into RethinkDB...');

  try {
    // Insert metrics in batches
    if (data.metrics.length > 0) {
      const batchSize = 100;
      let inserted = 0;

      for (let i = 0; i < data.metrics.length; i += batchSize) {
        const batch = data.metrics.slice(i, i + batchSize);
        await r.db('metrics').table('metrics').insert(batch).run(dbConnection);
        inserted += batch.length;
        process.stdout.write(`\r  Metrics: ${inserted}/${data.metrics.length}`);
      }
      console.log('\n  ✅ Inserted all metrics');
    }

    // Insert events in batches
    if (data.events.length > 0) {
      const batchSize = 100;
      let inserted = 0;

      for (let i = 0; i < data.events.length; i += batchSize) {
        const batch = data.events.slice(i, i + batchSize);
        await r.db('metrics').table('events').insert(batch).run(dbConnection);
        inserted += batch.length;
        process.stdout.write(`\r  Events: ${inserted}/${data.events.length}`);
      }
      console.log('\n  ✅ Inserted all events\n');
    }
  } catch (err) {
    console.error('❌ Error inserting data:', err);
    throw err;
  }
}

// Main migration function
async function migrate() {
  console.log('🚀 Starting migration from SQLite to RethinkDB\n');
  console.log('━'.repeat(60) + '\n');

  try {
    // Step 1: Initialize RethinkDB
    await initializeRethinkDB();

    // Step 2: Read data from SQLite
    const data = await readFromSQLite();

    // Step 3: Insert data into RethinkDB
    await insertIntoRethinkDB(data);

    console.log('━'.repeat(60));
    console.log('\n✅ Migration completed successfully!\n');
    console.log(`📊 Migrated:`);
    console.log(`   • ${data.metrics.length} metrics`);
    console.log(`   • ${data.events.length} events\n`);

    // Close connection
    if (dbConnection) {
      await dbConnection.close();
    }

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Migration failed:', err);
    if (dbConnection) {
      await dbConnection.close();
    }
    process.exit(1);
  }
}

// Run migration
migrate();
