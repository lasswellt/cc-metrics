const express = require('express');
const cors = require('cors');
const path = require('path');
const r = require('rethinkdb');
const axios = require('axios');
const { Browser, Curl, impersonate } = require('node-libcurl-ja3');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const OTLP_PORT = 4318;
const DASHBOARD_PORT = 3000;

// Debug mode flag
const DEBUG = process.env.DEBUG === 'true';

// Debug logging helper
function debugLog(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ type: 'application/x-protobuf', limit: '50mb' }));

// RethinkDB Database Setup (WebSocket connection)
let dbConnection = null;

// RethinkDB connection configuration
const dbConfig = {
  host: process.env.RETHINKDB_HOST || 'localhost',
  port: process.env.RETHINKDB_PORT || 28015,
  db: 'metrics'
};

// Initialize RethinkDB connection and schema
async function initializeDatabase() {
  try {
    // Connect to RethinkDB (uses WebSocket by default)
    console.log(`🔌 Connecting to RethinkDB at ${dbConfig.host}:${dbConfig.port}...`);
    dbConnection = await r.connect(dbConfig);
    console.log('📦 Connected to RethinkDB via WebSocket (native RethinkDB protocol)');
    console.log(`   Connection type: TCP with WebSocket-like protocol on port ${dbConfig.port}`);
    console.log(`   Database: ${dbConfig.db}`);

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

    if (!tableList.includes('sessions')) {
      await r.db('metrics').tableCreate('sessions').run(dbConnection);
      console.log('  ✅ Created table: sessions');

      // Create indexes for sessions table
      await r.db('metrics').table('sessions').indexCreate('sessionId').run(dbConnection);
      await r.db('metrics').table('sessions').indexCreate('lastSeen').run(dbConnection);
      await r.db('metrics').table('sessions').indexCreate('terminalType').run(dbConnection);
      console.log('  ✅ Created indexes for sessions table');
    }

    if (!tableList.includes('metric_buckets')) {
      await r.db('metrics').tableCreate('metric_buckets').run(dbConnection);
      console.log('  ✅ Created table: metric_buckets');

      // Create indexes for metric_buckets table
      await r.db('metrics').table('metric_buckets').indexCreate('bucketTime').run(dbConnection);
      await r.db('metrics').table('metric_buckets').indexCreate('lastUpdated').run(dbConnection);
      console.log('  ✅ Created indexes for metric_buckets table');
    }

    if (!tableList.includes('aggregated_stats')) {
      await r.db('metrics').tableCreate('aggregated_stats').run(dbConnection);
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
      }).run(dbConnection);
      console.log('  ✅ Initialized aggregated_stats table');
    }

    console.log('✅ Database schema initialized');
    return dbConnection;
  } catch (err) {
    console.error('Error initializing database:', err);
    throw err;
  }
}

// Helper functions for time periods
function getWeekStart() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const diff = day === 0 ? 6 : day - 1; // Days since Monday
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - diff);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart.getTime();
}

function getDayStart() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

function getTimeUntilReset(type) {
  const now = Date.now();
  if (type === 'daily') {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime() - now;
  } else if (type === 'weekly') {
    const nextMonday = new Date();
    const day = nextMonday.getDay();
    const daysUntilMonday = day === 0 ? 1 : 8 - day;
    nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
    nextMonday.setHours(0, 0, 0, 0);
    return nextMonday.getTime() - now;
  }
  return 0;
}

// Convert timeframe string to milliseconds
function getTimeframeCutoff(timeframe) {
  const now = Date.now();
  switch (timeframe) {
    case '1h':
      return now - (1 * 60 * 60 * 1000);
    case '2h':
      return now - (2 * 60 * 60 * 1000);
    case '3h':
      return now - (3 * 60 * 60 * 1000);
    case '6h':
      return now - (6 * 60 * 60 * 1000);
    case '24h':
      return now - (24 * 60 * 60 * 1000);
    case '7d':
      return now - (7 * 24 * 60 * 60 * 1000);
    case '30d':
      return now - (30 * 24 * 60 * 60 * 1000);
    case 'all':
    default:
      return 0; // No filtering
  }
}

function formatTimeUntilReset(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m`;
  } else {
    return `${seconds}s`;
  }
}

// Check and reset daily/weekly stats if needed
function checkAndResetStats() {
  const now = Date.now();
  
  // Check daily reset
  if (now >= storage.dailyStats.dayStart + 86400000) { // 24 hours
    console.log('🔄 Resetting daily stats');
    storage.dailyStats = {
      dayStart: getDayStart(),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      byModel: {}
    };
  }
  
  // Check weekly reset
  if (now >= storage.weeklyStats.weekStart + 604800000) { // 7 days
    console.log('🔄 Resetting weekly stats');
    storage.weeklyStats = {
      weekStart: getWeekStart(),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      byModel: {}
    };
  }
}

// In-memory storage
const storage = {
  metrics: [],
  events: [],
  
  // Current session tracking (resets on server restart)
  currentSession: {
    startTime: Date.now(),
    sessionCount: 0,
    commonModeCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    costPer1kOutput: 0,
    activeTimeCLI: 0,
    activeTimePlanning: 0,
    activeTimeUser: 0,
    linesOfCode: 0,
    commandsBlocked: 0,
    gitFailures: 0,
    filesModified: 0,
    toolCalls: 0,
    byModel: {}
  },
  
  // Usage limits and weekly tracking
  usageLimits: {
    dailyTokenLimit: 0, // 0 = no limit, set via API
    weeklyTokenLimit: 0, // 0 = no limit
    dailyCostLimit: 0, // 0 = no limit
    weeklyCostLimit: 0, // 0 = no limit
    enabled: false
  },
  
  // Weekly stats (resets every Monday at midnight)
  weeklyStats: {
    weekStart: getWeekStart(),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    byModel: {}
  },
  
  // Daily stats (resets every day at midnight)
  dailyStats: {
    dayStart: getDayStart(),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    byModel: {}
  },
  
  // Terminal sessions tracking (by session.id)
  sessions: {}, // { sessionId: { sessionId, terminalType, startTime, lastSeen, inputTokens, ... } }

  aggregated: {
    // Session stats
    sessionCount: 0,
    commonModeCount: 0,

    // Token stats
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,

    // Cost stats
    totalCost: 0,
    costPer1kOutput: 0,

    // Time stats (in seconds)
    activeTimeCLI: 0,
    activeTimePlanning: 0,
    activeTimeUser: 0,

    // Code stats
    linesOfCode: 0,

    // Hook metrics
    commandsBlocked: 0,
    gitFailures: 0,

    // Tool metrics
    filesModified: 0,
    toolCalls: 0,

    // By model tracking
    byModel: {}, // { model: { input, output, cacheRead, cacheCreation, cost } }

    // History for charts
    tokenHistory: [],
    costHistory: [],
    tokensByTypeHistory: [],
    eventCounts: {}
  }
};

// WebSocket connection tracking
const connectedClients = new Set();

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('🔌 WebSocket client connected');
  connectedClients.add(ws);

  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
    connectedClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    connectedClients.delete(ws);
  });

  // Send initial data on connection
  ws.send(JSON.stringify({ type: 'connected', message: 'Connected to metrics stream' }));

  // Send cached active sessions to new client
  if (activeSessions.size > 0) {
    const sessionsArray = Array.from(activeSessions.values());
    ws.send(JSON.stringify({
      type: 'sessions_snapshot',
      timestamp: Date.now(),
      data: sessionsArray
    }));
    console.log('📊 Sent', activeSessions.size, 'active sessions to new client');
  }

  // Send cached aggregated stats to new client
  if (aggregatedStatsCache) {
    ws.send(JSON.stringify({
      type: 'aggregated_update',
      timestamp: Date.now(),
      data: aggregatedStatsCache
    }));
    console.log('📊 Sent aggregated stats to new client');
  }

  // Send cached metric buckets to new client
  if (metricBucketsCache.size > 0) {
    const bucketsArray = Array.from(metricBucketsCache.values());
    ws.send(JSON.stringify({
      type: 'buckets_snapshot',
      timestamp: Date.now(),
      data: bucketsArray
    }));
    console.log('📊 Sent', metricBucketsCache.size, 'metric buckets to new client');
  }
});

// Broadcast update to all connected WebSocket clients
function broadcastUpdate(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });

  connectedClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        console.error('Error broadcasting to client:', error);
        connectedClients.delete(client);
      }
    }
  });
}

// Helper function to extract metric value
function extractMetricValue(dataPoint) {
  if (dataPoint.asInt !== undefined) return parseInt(dataPoint.asInt);
  if (dataPoint.asDouble !== undefined) return parseFloat(dataPoint.asDouble);
  if (dataPoint.sum !== undefined) return parseFloat(dataPoint.sum);
  if (dataPoint.gauge !== undefined) return parseFloat(dataPoint.gauge);
  return 0;
}

// Helper function to process attributes
function processAttributes(attributes = []) {
  const result = {};
  attributes.forEach(attr => {
    const key = attr.key;
    const value = attr.value?.stringValue || attr.value?.intValue || attr.value?.doubleValue || attr.value?.boolValue;
    result[key] = value;
  });
  return result;
}

// Database helper functions
async function saveMetricToDB(timestamp, name, value, attributes) {
  const model = attributes.model || 'unknown';

  try {
    await r.db('metrics').table('metrics').insert({
      timestamp: timestamp,
      name: name,
      value: value,
      attributes: attributes,
      model: model
    }).run(dbConnection);
  } catch (err) {
    console.error('Error saving metric to DB:', err);
  }
}

async function saveEventToDB(timestamp, type, body, attributes, severity) {
  try {
    await r.db('metrics').table('events').insert({
      timestamp: timestamp,
      type: type,
      body: body,
      attributes: attributes,
      severity: severity
    }).run(dbConnection);
  } catch (err) {
    console.error('Error saving event to DB:', err);
  }
}

async function upsertSession(sessionId, terminalType, metricName, value, model, timestamp, attributes) {
  if (!sessionId || !dbConnection) return;

  try {
    // Determine what fields to update based on metric type
    let fieldUpdates = {};
    let byModelUpdates = {};

    switch (metricName) {
      case 'claude_code.token.usage':
        const tokenType = attributes.type;
        if (tokenType === 'input') {
          fieldUpdates.inputTokens = value;
          byModelUpdates.inputTokens = value;
        } else if (tokenType === 'output') {
          fieldUpdates.outputTokens = value;
          byModelUpdates.outputTokens = value;
        } else if (tokenType === 'cacheRead') {
          fieldUpdates.cacheReadTokens = value;
          byModelUpdates.cacheReadTokens = value;
        } else if (tokenType === 'cacheCreation') {
          fieldUpdates.cacheCreationTokens = value;
          byModelUpdates.cacheCreationTokens = value;
        }
        break;
      case 'claude_code.cost.usage':
        fieldUpdates.totalCost = value;
        byModelUpdates.cost = value;
        break;
      case 'claude_code.active_time.total':
        const timeType = attributes.type;
        if (timeType === 'cli') {
          fieldUpdates.activeTimeCLI = value / 1000; // Convert ms to seconds
        } else if (timeType === 'planning') {
          fieldUpdates.activeTimePlanning = value / 1000;
        } else if (timeType === 'user') {
          fieldUpdates.activeTimeUser = value / 1000;
        }
        break;
      case 'claude_code.lines_of_code.count':
        fieldUpdates.linesOfCode = value;
        break;
      case 'claude_code.session.common_mode':
        fieldUpdates.commonModeCount = value;
        break;
    }

    // Debug logging for active time metrics
    if (fieldUpdates.activeTimeCLI || fieldUpdates.activeTimePlanning || fieldUpdates.activeTimeUser) {
      console.log(`📊 Active time update for session ${sessionId}:`, {
        cli: fieldUpdates.activeTimeCLI,
        planning: fieldUpdates.activeTimePlanning,
        user: fieldUpdates.activeTimeUser
      });
    }

    // Perform upsert using get().replace()
    await r.db('metrics').table('sessions')
      .get(sessionId)
      .replace(function(session) {
        return r.branch(
          session,
          // Update existing session - increment values
          session.merge({
            lastSeen: timestamp,
            updatedAt: r.now(),
            inputTokens: session('inputTokens').default(0).add(fieldUpdates.inputTokens || 0),
            outputTokens: session('outputTokens').default(0).add(fieldUpdates.outputTokens || 0),
            cacheReadTokens: session('cacheReadTokens').default(0).add(fieldUpdates.cacheReadTokens || 0),
            cacheCreationTokens: session('cacheCreationTokens').default(0).add(fieldUpdates.cacheCreationTokens || 0),
            totalTokens: session('inputTokens').default(0).add(fieldUpdates.inputTokens || 0)
              .add(session('outputTokens').default(0)).add(fieldUpdates.outputTokens || 0)
              .add(session('cacheReadTokens').default(0)).add(fieldUpdates.cacheReadTokens || 0)
              .add(session('cacheCreationTokens').default(0)).add(fieldUpdates.cacheCreationTokens || 0),
            totalCost: session('totalCost').default(0).add(fieldUpdates.totalCost || 0),
            activeTimeCLI: session('activeTimeCLI').default(0).add(fieldUpdates.activeTimeCLI || 0),
            activeTimePlanning: session('activeTimePlanning').default(0).add(fieldUpdates.activeTimePlanning || 0),
            activeTimeUser: session('activeTimeUser').default(0).add(fieldUpdates.activeTimeUser || 0),
            linesOfCode: session('linesOfCode').default(0).add(fieldUpdates.linesOfCode || 0),
            commonModeCount: session('commonModeCount').default(0).add(fieldUpdates.commonModeCount || 0),
            byModel: session('byModel').default({}).merge(
              r.object(model,
                session('byModel').default({}).bracket(model).default({}).merge({
                  inputTokens: session('byModel').default({}).bracket(model).default({}).bracket('inputTokens').default(0).add(byModelUpdates.inputTokens || 0),
                  outputTokens: session('byModel').default({}).bracket(model).default({}).bracket('outputTokens').default(0).add(byModelUpdates.outputTokens || 0),
                  cacheReadTokens: session('byModel').default({}).bracket(model).default({}).bracket('cacheReadTokens').default(0).add(byModelUpdates.cacheReadTokens || 0),
                  cacheCreationTokens: session('byModel').default({}).bracket(model).default({}).bracket('cacheCreationTokens').default(0).add(byModelUpdates.cacheCreationTokens || 0),
                  cost: session('byModel').default({}).bracket(model).default({}).bracket('cost').default(0).add(byModelUpdates.cost || 0)
                })
              )
            )
          }),
          // Create new session
          {
            id: sessionId,
            sessionId: sessionId,
            terminalType: terminalType || 'unknown',
            startTime: timestamp,
            lastSeen: timestamp,
            inputTokens: fieldUpdates.inputTokens || 0,
            outputTokens: fieldUpdates.outputTokens || 0,
            cacheReadTokens: fieldUpdates.cacheReadTokens || 0,
            cacheCreationTokens: fieldUpdates.cacheCreationTokens || 0,
            totalTokens: (fieldUpdates.inputTokens || 0) + (fieldUpdates.outputTokens || 0) +
                        (fieldUpdates.cacheReadTokens || 0) + (fieldUpdates.cacheCreationTokens || 0),
            totalCost: fieldUpdates.totalCost || 0,
            activeTimeCLI: fieldUpdates.activeTimeCLI || 0,
            activeTimePlanning: fieldUpdates.activeTimePlanning || 0,
            activeTimeUser: fieldUpdates.activeTimeUser || 0,
            linesOfCode: fieldUpdates.linesOfCode || 0,
            commonModeCount: fieldUpdates.commonModeCount || 0,
            byModel: r.object(model, {
              inputTokens: byModelUpdates.inputTokens || 0,
              outputTokens: byModelUpdates.outputTokens || 0,
              cacheReadTokens: byModelUpdates.cacheReadTokens || 0,
              cacheCreationTokens: byModelUpdates.cacheCreationTokens || 0,
              cost: byModelUpdates.cost || 0
            }),
            updatedAt: r.now()
          }
        );
      }, { nonAtomic: true, returnChanges: false })
      .run(dbConnection);
  } catch (err) {
    console.error('Error upserting session to DB:', err);
  }
}

// Update metric bucket (1-minute time bucket aggregates)
async function updateMetricBucket(timestamp, metricName, value, attributes) {
  if (!dbConnection) return;

  try {
    const bucketTime = Math.floor(timestamp / 60000) * 60000; // Floor to 1-min bucket
    const model = attributes.model || 'unknown';

    // Determine which fields to update based on metric type
    let fieldUpdates = {};
    let byModelUpdates = {};

    if (metricName === 'claude_code.token.usage') {
      const tokenType = attributes.type;
      if (tokenType === 'input') {
        fieldUpdates.inputTokens = value;
        byModelUpdates.inputTokens = value;
      } else if (tokenType === 'output') {
        fieldUpdates.outputTokens = value;
        byModelUpdates.outputTokens = value;
      } else if (tokenType === 'cacheRead') {
        fieldUpdates.cacheReadTokens = value;
        byModelUpdates.cacheReadTokens = value;
      } else if (tokenType === 'cacheCreation') {
        fieldUpdates.cacheCreationTokens = value;
        byModelUpdates.cacheCreationTokens = value;
      }
    } else if (metricName === 'claude_code.cost.usage') {
      fieldUpdates.totalCost = value;
      byModelUpdates.cost = value;
    } else if (metricName === 'claude_code.active_time.total') {
      const timeType = attributes.type;
      if (timeType === 'cli') {
        fieldUpdates.activeTimeCLI = value / 1000; // Convert ms to seconds
      } else if (timeType === 'planning') {
        fieldUpdates.activeTimePlanning = value / 1000; // Convert ms to seconds
      } else if (timeType === 'user') {
        fieldUpdates.activeTimeUser = value / 1000; // Convert ms to seconds
      }
    } else if (metricName === 'claude_code.lines_of_code.count') {
      fieldUpdates.linesOfCode = value;
    } else if (metricName === 'claude_code.hook.commands_blocked') {
      fieldUpdates.commandsBlocked = value;
    } else if (metricName === 'claude_code.hook.git_failures') {
      fieldUpdates.gitFailures = value;
    } else if (metricName === 'claude_code.tool.files_modified') {
      fieldUpdates.filesModified = value;
    } else if (metricName === 'claude_code.tool.calls') {
      fieldUpdates.toolCalls = value;
    }

    // Upsert bucket (increment values)
    await r.db('metrics').table('metric_buckets')
      .get(bucketTime)
      .replace(function(bucket) {
        return r.branch(
          bucket,
          // Update existing bucket
          bucket.merge({
            inputTokens: bucket('inputTokens').default(0).add(fieldUpdates.inputTokens || 0),
            outputTokens: bucket('outputTokens').default(0).add(fieldUpdates.outputTokens || 0),
            cacheReadTokens: bucket('cacheReadTokens').default(0).add(fieldUpdates.cacheReadTokens || 0),
            cacheCreationTokens: bucket('cacheCreationTokens').default(0).add(fieldUpdates.cacheCreationTokens || 0),
            totalCost: bucket('totalCost').default(0).add(fieldUpdates.totalCost || 0),
            activeTimeCLI: bucket('activeTimeCLI').default(0).add(fieldUpdates.activeTimeCLI || 0),
            activeTimePlanning: bucket('activeTimePlanning').default(0).add(fieldUpdates.activeTimePlanning || 0),
            activeTimeUser: bucket('activeTimeUser').default(0).add(fieldUpdates.activeTimeUser || 0),
            linesOfCode: bucket('linesOfCode').default(0).add(fieldUpdates.linesOfCode || 0),
            commandsBlocked: bucket('commandsBlocked').default(0).add(fieldUpdates.commandsBlocked || 0),
            gitFailures: bucket('gitFailures').default(0).add(fieldUpdates.gitFailures || 0),
            filesModified: bucket('filesModified').default(0).add(fieldUpdates.filesModified || 0),
            toolCalls: bucket('toolCalls').default(0).add(fieldUpdates.toolCalls || 0),
            byModel: bucket('byModel').default({}).merge(
              r.branch(
                Object.keys(byModelUpdates).length > 0,
                r.object(model,
                  bucket('byModel')(model).default({}).merge({
                    inputTokens: bucket('byModel')(model)('inputTokens').default(0).add(byModelUpdates.inputTokens || 0),
                    outputTokens: bucket('byModel')(model)('outputTokens').default(0).add(byModelUpdates.outputTokens || 0),
                    cacheReadTokens: bucket('byModel')(model)('cacheReadTokens').default(0).add(byModelUpdates.cacheReadTokens || 0),
                    cacheCreationTokens: bucket('byModel')(model)('cacheCreationTokens').default(0).add(byModelUpdates.cacheCreationTokens || 0),
                    cost: bucket('byModel')(model)('cost').default(0).add(byModelUpdates.cost || 0)
                  })
                ),
                {}
              )
            ),
            lastUpdated: r.now().toEpochTime().mul(1000)
          }),
          // Create new bucket
          {
            id: bucketTime,
            bucketTime: bucketTime,
            bucketSize: '1min',
            inputTokens: fieldUpdates.inputTokens || 0,
            outputTokens: fieldUpdates.outputTokens || 0,
            cacheReadTokens: fieldUpdates.cacheReadTokens || 0,
            cacheCreationTokens: fieldUpdates.cacheCreationTokens || 0,
            totalCost: fieldUpdates.totalCost || 0,
            activeTimeCLI: fieldUpdates.activeTimeCLI || 0,
            activeTimePlanning: fieldUpdates.activeTimePlanning || 0,
            activeTimeUser: fieldUpdates.activeTimeUser || 0,
            linesOfCode: fieldUpdates.linesOfCode || 0,
            commandsBlocked: fieldUpdates.commandsBlocked || 0,
            gitFailures: fieldUpdates.gitFailures || 0,
            filesModified: fieldUpdates.filesModified || 0,
            toolCalls: fieldUpdates.toolCalls || 0,
            byModel: Object.keys(byModelUpdates).length > 0
              ? r.object(model, {
                  inputTokens: byModelUpdates.inputTokens || 0,
                  outputTokens: byModelUpdates.outputTokens || 0,
                  cacheReadTokens: byModelUpdates.cacheReadTokens || 0,
                  cacheCreationTokens: byModelUpdates.cacheCreationTokens || 0,
                  cost: byModelUpdates.cost || 0
                })
              : {},
            lastUpdated: r.now().toEpochTime().mul(1000)
          }
        );
      }, { nonAtomic: true })
      .run(dbConnection);
  } catch (err) {
    console.error('Error updating metric bucket:', err);
  }
}

// Update aggregated stats (all-time totals)
async function updateAggregatedStats(metricName, value, attributes) {
  if (!dbConnection) return;

  try {
    const model = attributes.model || 'unknown';

    // Determine which fields to update based on metric type
    let fieldUpdates = {};
    let byModelUpdates = {};

    if (metricName === 'claude_code.token.usage') {
      const tokenType = attributes.type;
      if (tokenType === 'input') {
        fieldUpdates.inputTokens = value;
        byModelUpdates.inputTokens = value;
      } else if (tokenType === 'output') {
        fieldUpdates.outputTokens = value;
        byModelUpdates.outputTokens = value;
      } else if (tokenType === 'cacheRead') {
        fieldUpdates.cacheReadTokens = value;
        byModelUpdates.cacheReadTokens = value;
      } else if (tokenType === 'cacheCreation') {
        fieldUpdates.cacheCreationTokens = value;
        byModelUpdates.cacheCreationTokens = value;
      }
    } else if (metricName === 'claude_code.cost.usage') {
      fieldUpdates.totalCost = value;
      byModelUpdates.cost = value;
    } else if (metricName === 'claude_code.active_time.total') {
      const timeType = attributes.type;
      if (timeType === 'cli') {
        fieldUpdates.activeTimeCLI = value / 1000; // Convert ms to seconds
      } else if (timeType === 'planning') {
        fieldUpdates.activeTimePlanning = value / 1000; // Convert ms to seconds
      } else if (timeType === 'user') {
        fieldUpdates.activeTimeUser = value / 1000; // Convert ms to seconds
      }
    } else if (metricName === 'claude_code.lines_of_code.count') {
      fieldUpdates.linesOfCode = value;
    } else if (metricName === 'claude_code.hook.commands_blocked') {
      fieldUpdates.commandsBlocked = value;
    } else if (metricName === 'claude_code.hook.git_failures') {
      fieldUpdates.gitFailures = value;
    } else if (metricName === 'claude_code.tool.files_modified') {
      fieldUpdates.filesModified = value;
    } else if (metricName === 'claude_code.tool.calls') {
      fieldUpdates.toolCalls = value;
    }

    // Update aggregated stats (increment all-time totals)
    await r.db('metrics').table('aggregated_stats')
      .get('current')
      .update(function(row) {
        return {
          inputTokens: row('inputTokens').default(0).add(fieldUpdates.inputTokens || 0),
          outputTokens: row('outputTokens').default(0).add(fieldUpdates.outputTokens || 0),
          cacheReadTokens: row('cacheReadTokens').default(0).add(fieldUpdates.cacheReadTokens || 0),
          cacheCreationTokens: row('cacheCreationTokens').default(0).add(fieldUpdates.cacheCreationTokens || 0),
          totalCost: row('totalCost').default(0).add(fieldUpdates.totalCost || 0),
          activeTimeCLI: row('activeTimeCLI').default(0).add(fieldUpdates.activeTimeCLI || 0),
          activeTimePlanning: row('activeTimePlanning').default(0).add(fieldUpdates.activeTimePlanning || 0),
          activeTimeUser: row('activeTimeUser').default(0).add(fieldUpdates.activeTimeUser || 0),
          linesOfCode: row('linesOfCode').default(0).add(fieldUpdates.linesOfCode || 0),
          commandsBlocked: row('commandsBlocked').default(0).add(fieldUpdates.commandsBlocked || 0),
          gitFailures: row('gitFailures').default(0).add(fieldUpdates.gitFailures || 0),
          filesModified: row('filesModified').default(0).add(fieldUpdates.filesModified || 0),
          toolCalls: row('toolCalls').default(0).add(fieldUpdates.toolCalls || 0),
          byModel: r.branch(
            Object.keys(byModelUpdates).length > 0,
            row('byModel').default({}).merge(
              r.object(model,
                row('byModel')(model).default({}).merge({
                  inputTokens: row('byModel')(model)('inputTokens').default(0).add(byModelUpdates.inputTokens || 0),
                  outputTokens: row('byModel')(model)('outputTokens').default(0).add(byModelUpdates.outputTokens || 0),
                  cacheReadTokens: row('byModel')(model)('cacheReadTokens').default(0).add(byModelUpdates.cacheReadTokens || 0),
                  cacheCreationTokens: row('byModel')(model)('cacheCreationTokens').default(0).add(byModelUpdates.cacheCreationTokens || 0),
                  cost: row('byModel')(model)('cost').default(0).add(byModelUpdates.cost || 0)
                })
              )
            ),
            row('byModel')
          ),
          lastUpdated: r.now().toEpochTime().mul(1000)
        };
      })
      .run(dbConnection);
  } catch (err) {
    console.error('Error updating aggregated stats:', err);
  }
}

// OTLP Metrics endpoint
app.post('/v1/metrics', (req, res) => {
  debugLog('📊 Received metrics data');

  try {
    const data = req.body;

    if (data.resourceMetrics) {
      data.resourceMetrics.forEach(rm => {
        rm.scopeMetrics?.forEach(sm => {
          sm.metrics?.forEach(metric => {
            const metricName = metric.name;

            // Process different metric types
            const dataPoints = metric.gauge?.dataPoints ||
                             metric.sum?.dataPoints ||
                             metric.histogram?.dataPoints ||
                             [];

            dataPoints.forEach(dp => {
              const value = extractMetricValue(dp);
              const attributes = processAttributes(dp.attributes);
              const timestamp = Date.now();

              // Store metric in-memory
              storage.metrics.push({
                timestamp,
                name: metricName,
                value,
                attributes
              });

              // Persist to SQLite
              saveMetricToDB(timestamp, metricName, value, attributes);

              const model = attributes.model || 'unknown';
              const sessionId = attributes['session.id'];
              const terminalType = attributes['terminal.type'] || 'unknown';

              // Track terminal sessions
              if (sessionId && !storage.sessions[sessionId]) {
                storage.sessions[sessionId] = {
                  sessionId,
                  terminalType,
                  startTime: timestamp,
                  lastSeen: timestamp,
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheReadTokens: 0,
                  cacheCreationTokens: 0,
                  totalTokens: 0,
                  totalCost: 0,
                  activeTimeCLI: 0,
                  activeTimePlanning: 0,
                  activeTimeUser: 0,
                  linesOfCode: 0,
                  commonModeCount: 0,
                  byModel: {}
                };
              }

              // Update last seen time
              if (sessionId && storage.sessions[sessionId]) {
                storage.sessions[sessionId].lastSeen = timestamp;

                // Initialize model tracking for this session
                if (!storage.sessions[sessionId].byModel[model]) {
                  storage.sessions[sessionId].byModel[model] = {
                    inputTokens: 0,
                    outputTokens: 0,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                    cost: 0
                  };
                }
              }

              // Check and reset stats if needed
              checkAndResetStats();
              
              // Initialize model tracking if needed for all stat objects
              if (!storage.aggregated.byModel[model]) {
                storage.aggregated.byModel[model] = {
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheReadTokens: 0,
                  cacheCreationTokens: 0,
                  cost: 0
                };
              }
              if (!storage.currentSession.byModel[model]) {
                storage.currentSession.byModel[model] = {
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheReadTokens: 0,
                  cacheCreationTokens: 0,
                  cost: 0
                };
              }
              if (!storage.dailyStats.byModel[model]) {
                storage.dailyStats.byModel[model] = {
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheReadTokens: 0,
                  cacheCreationTokens: 0,
                  cost: 0
                };
              }
              if (!storage.weeklyStats.byModel[model]) {
                storage.weeklyStats.byModel[model] = {
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheReadTokens: 0,
                  cacheCreationTokens: 0,
                  cost: 0
                };
              }

              // Helper function to update all stat objects
              const updateStats = (metric, value) => {
                switch (metric) {
                  case 'inputTokens':
                    storage.aggregated.inputTokens += value;
                    storage.currentSession.inputTokens += value;
                    storage.dailyStats.inputTokens += value;
                    storage.weeklyStats.inputTokens += value;
                    storage.aggregated.byModel[model].inputTokens += value;
                    storage.currentSession.byModel[model].inputTokens += value;
                    storage.dailyStats.byModel[model].inputTokens += value;
                    storage.weeklyStats.byModel[model].inputTokens += value;
                    if (sessionId && storage.sessions[sessionId]) {
                      storage.sessions[sessionId].inputTokens += value;
                      storage.sessions[sessionId].byModel[model].inputTokens += value;
                    }
                    break;
                  case 'outputTokens':
                    storage.aggregated.outputTokens += value;
                    storage.currentSession.outputTokens += value;
                    storage.dailyStats.outputTokens += value;
                    storage.weeklyStats.outputTokens += value;
                    storage.aggregated.byModel[model].outputTokens += value;
                    storage.currentSession.byModel[model].outputTokens += value;
                    storage.dailyStats.byModel[model].outputTokens += value;
                    storage.weeklyStats.byModel[model].outputTokens += value;
                    if (sessionId && storage.sessions[sessionId]) {
                      storage.sessions[sessionId].outputTokens += value;
                      storage.sessions[sessionId].byModel[model].outputTokens += value;
                    }
                    break;
                  case 'cacheReadTokens':
                    storage.aggregated.cacheReadTokens += value;
                    storage.currentSession.cacheReadTokens += value;
                    storage.dailyStats.cacheReadTokens += value;
                    storage.weeklyStats.cacheReadTokens += value;
                    storage.aggregated.byModel[model].cacheReadTokens += value;
                    storage.currentSession.byModel[model].cacheReadTokens += value;
                    storage.dailyStats.byModel[model].cacheReadTokens += value;
                    storage.weeklyStats.byModel[model].cacheReadTokens += value;
                    if (sessionId && storage.sessions[sessionId]) {
                      storage.sessions[sessionId].cacheReadTokens += value;
                      storage.sessions[sessionId].byModel[model].cacheReadTokens += value;
                    }
                    break;
                  case 'cacheCreationTokens':
                    storage.aggregated.cacheCreationTokens += value;
                    storage.currentSession.cacheCreationTokens += value;
                    storage.dailyStats.cacheCreationTokens += value;
                    storage.weeklyStats.cacheCreationTokens += value;
                    storage.aggregated.byModel[model].cacheCreationTokens += value;
                    storage.currentSession.byModel[model].cacheCreationTokens += value;
                    storage.dailyStats.byModel[model].cacheCreationTokens += value;
                    storage.weeklyStats.byModel[model].cacheCreationTokens += value;
                    if (sessionId && storage.sessions[sessionId]) {
                      storage.sessions[sessionId].cacheCreationTokens += value;
                      storage.sessions[sessionId].byModel[model].cacheCreationTokens += value;
                    }
                    break;
                  case 'cost':
                    storage.aggregated.totalCost += value;
                    storage.currentSession.totalCost += value;
                    storage.dailyStats.totalCost += value;
                    storage.weeklyStats.totalCost += value;
                    storage.aggregated.byModel[model].cost += value;
                    storage.currentSession.byModel[model].cost += value;
                    storage.dailyStats.byModel[model].cost += value;
                    storage.weeklyStats.byModel[model].cost += value;
                    storage.aggregated.costHistory.push({ time: timestamp, value: storage.aggregated.totalCost });
                    if (sessionId && storage.sessions[sessionId]) {
                      storage.sessions[sessionId].totalCost += value;
                      storage.sessions[sessionId].byModel[model].cost += value;
                    }
                    break;
                }
              };

              // Process specific metrics
              switch (metricName) {
                // Token metrics - check attributes.type for the token type
                case 'claude_code.token.usage':
                  const tokenType = attributes.type;
                  if (tokenType === 'input') {
                    updateStats('inputTokens', value);
                  } else if (tokenType === 'output') {
                    updateStats('outputTokens', value);
                  } else if (tokenType === 'cacheRead') {
                    updateStats('cacheReadTokens', value);
                  } else if (tokenType === 'cacheCreation') {
                    updateStats('cacheCreationTokens', value);
                  }
                  break;

                // Cost metrics
                case 'claude_code.cost.usage':
                  updateStats('cost', value);
                  break;

                // Session metrics
                case 'claude_code.session.count':
                  storage.aggregated.sessionCount += value;
                  storage.currentSession.sessionCount += value;
                  break;

                case 'claude_code.session.common_mode':
                  storage.aggregated.commonModeCount += value;
                  storage.currentSession.commonModeCount += value;
                  if (sessionId && storage.sessions[sessionId]) {
                    storage.sessions[sessionId].commonModeCount += value;
                  }
                  break;

                // Time metrics - check attributes.type for time type (assuming in milliseconds, convert to seconds)
                case 'claude_code.active_time.total':
                  const timeType = attributes.type;
                  if (timeType === 'cli') {
                    storage.aggregated.activeTimeCLI += value / 1000;
                    storage.currentSession.activeTimeCLI += value / 1000;
                    if (sessionId && storage.sessions[sessionId]) {
                      storage.sessions[sessionId].activeTimeCLI += value / 1000;
                    }
                  } else if (timeType === 'planning') {
                    storage.aggregated.activeTimePlanning += value / 1000;
                    storage.currentSession.activeTimePlanning += value / 1000;
                    if (sessionId && storage.sessions[sessionId]) {
                      storage.sessions[sessionId].activeTimePlanning += value / 1000;
                    }
                  } else if (timeType === 'user') {
                    storage.aggregated.activeTimeUser += value / 1000;
                    storage.currentSession.activeTimeUser += value / 1000;
                    if (sessionId && storage.sessions[sessionId]) {
                      storage.sessions[sessionId].activeTimeUser += value / 1000;
                    }
                  }
                  break;

                // Code metrics
                case 'claude_code.lines_of_code.count':
                  storage.aggregated.linesOfCode += value;
                  storage.currentSession.linesOfCode += value;
                  if (sessionId && storage.sessions[sessionId]) {
                    storage.sessions[sessionId].linesOfCode += value;
                  }
                  break;

                // Hook metrics
                case 'claude_code.hook.commands_blocked':
                  storage.aggregated.commandsBlocked += value;
                  storage.currentSession.commandsBlocked += value;
                  break;

                case 'claude_code.hook.git_failures':
                  storage.aggregated.gitFailures += value;
                  storage.currentSession.gitFailures += value;
                  break;

                // Tool metrics
                case 'claude_code.tool.files_modified':
                  storage.aggregated.filesModified += value;
                  storage.currentSession.filesModified += value;
                  break;

                case 'claude_code.tool.calls':
                  storage.aggregated.toolCalls += value;
                  storage.currentSession.toolCalls += value;
                  break;
              }

              // Upsert session to database (async, don't await)
              if (sessionId) {
                upsertSession(sessionId, terminalType, metricName, value, model, timestamp, attributes)
                  .catch(err => console.error('Error upserting session:', err));
              }

              // Update metric buckets and aggregated stats (async, don't await)
              updateMetricBucket(timestamp, metricName, value, attributes)
                .catch(err => console.error('Error updating metric bucket:', err));
              updateAggregatedStats(metricName, value, attributes)
                .catch(err => console.error('Error updating aggregated stats:', err));

              // Update total tokens for all stat objects
              storage.aggregated.totalTokens =
                storage.aggregated.inputTokens +
                storage.aggregated.outputTokens +
                storage.aggregated.cacheReadTokens +
                storage.aggregated.cacheCreationTokens;
              
              storage.currentSession.totalTokens =
                storage.currentSession.inputTokens +
                storage.currentSession.outputTokens +
                storage.currentSession.cacheReadTokens +
                storage.currentSession.cacheCreationTokens;
              
              storage.dailyStats.totalTokens =
                storage.dailyStats.inputTokens +
                storage.dailyStats.outputTokens +
                storage.dailyStats.cacheReadTokens +
                storage.dailyStats.cacheCreationTokens;
              
              storage.weeklyStats.totalTokens =
                storage.weeklyStats.inputTokens +
                storage.weeklyStats.outputTokens +
                storage.weeklyStats.cacheReadTokens +
                storage.weeklyStats.cacheCreationTokens;

              // Update total tokens for this session
              if (sessionId && storage.sessions[sessionId]) {
                storage.sessions[sessionId].totalTokens =
                  storage.sessions[sessionId].inputTokens +
                  storage.sessions[sessionId].outputTokens +
                  storage.sessions[sessionId].cacheReadTokens +
                  storage.sessions[sessionId].cacheCreationTokens;
              }

              // Calculate cache efficiency (aggregated)
              const totalCacheTokens = storage.aggregated.cacheReadTokens + storage.aggregated.cacheCreationTokens;
              if (totalCacheTokens > 0) {
                storage.aggregated.cacheEfficiency =
                  (storage.aggregated.cacheReadTokens / totalCacheTokens * 100).toFixed(2);
              }
              
              // Calculate cache efficiency (current session)
              const sessionCacheTokens = storage.currentSession.cacheReadTokens + storage.currentSession.cacheCreationTokens;
              if (sessionCacheTokens > 0) {
                storage.currentSession.cacheEfficiency =
                  (storage.currentSession.cacheReadTokens / sessionCacheTokens * 100).toFixed(2);
              }

              // Calculate cost per 1K output (aggregated)
              if (storage.aggregated.outputTokens > 0) {
                storage.aggregated.costPer1kOutput =
                  (storage.aggregated.totalCost / storage.aggregated.outputTokens * 1000).toFixed(4);
              }
              
              // Calculate cost per 1K output (current session)
              if (storage.currentSession.outputTokens > 0) {
                storage.currentSession.costPer1kOutput =
                  (storage.currentSession.totalCost / storage.currentSession.outputTokens * 1000).toFixed(4);
              }

              // Calculate productivity ratio (output tokens per second of active time)
              const totalActiveTime = storage.aggregated.activeTimeCLI +
                                     storage.aggregated.activeTimePlanning +
                                     storage.aggregated.activeTimeUser;
              if (totalActiveTime > 0) {
                storage.aggregated.productivityRatio =
                  Math.round(storage.aggregated.outputTokens / totalActiveTime);
              }
              
              const sessionActiveTime = storage.currentSession.activeTimeCLI +
                                       storage.currentSession.activeTimePlanning +
                                       storage.currentSession.activeTimeUser;
              if (sessionActiveTime > 0) {
                storage.currentSession.productivityRatio =
                  Math.round(storage.currentSession.outputTokens / sessionActiveTime);
              }
            });
          });
        });
      });

      // Record token history snapshot
      const timestamp = Date.now();
      storage.aggregated.tokensByTypeHistory.push({
        time: timestamp,
        input: storage.aggregated.inputTokens,
        output: storage.aggregated.outputTokens,
        cacheRead: storage.aggregated.cacheReadTokens,
        cacheCreation: storage.aggregated.cacheCreationTokens
      });
    }

    // Broadcast update to WebSocket clients
    broadcastUpdate('metrics', {
      inputTokens: storage.aggregated.inputTokens,
      outputTokens: storage.aggregated.outputTokens,
      cacheReadTokens: storage.aggregated.cacheReadTokens,
      cacheCreationTokens: storage.aggregated.cacheCreationTokens,
      totalTokens: storage.aggregated.totalTokens,
      totalCost: storage.aggregated.totalCost
    });

    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Error processing metrics:', error);
    res.status(200).json({ status: 'accepted' });
  }
});

// OTLP Logs endpoint
app.post('/v1/logs', (req, res) => {
  debugLog('📝 Received logs/events data');

  try {
    const data = req.body;

    if (data.resourceLogs) {
      data.resourceLogs.forEach(rl => {
        rl.scopeLogs?.forEach(sl => {
          sl.logRecords?.forEach(log => {
            const timestamp = Date.now();
            const body = log.body?.stringValue || JSON.stringify(log.body);
            const attributes = processAttributes(log.attributes);

            // Extract event type - try multiple sources
            let eventType = attributes.event_type || attributes.name;

            // If not in attributes, try to extract from body
            if (!eventType && body.startsWith('claude_code.')) {
              // Extract event name from body like "claude_code.api_request"
              const match = body.match(/^(claude_code\.\w+)/);
              if (match) {
                eventType = match[1];
              }
            }

            // Fallback to 'unknown'
            if (!eventType) {
              eventType = 'unknown';
            }

            // Store event in-memory
            storage.events.push({
              timestamp,
              type: eventType,
              body,
              attributes,
              severity: log.severityText || 'INFO'
            });

            // Persist to SQLite
            saveEventToDB(timestamp, eventType, body, attributes, log.severityText || 'INFO');

            // Update event counts
            storage.aggregated.eventCounts[eventType] =
              (storage.aggregated.eventCounts[eventType] || 0) + 1;
          });
        });
      });
    }

    // Broadcast event update to WebSocket clients
    broadcastUpdate('events', { eventCount: storage.events.length });

    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Error processing logs:', error);
    res.status(200).json({ status: 'accepted' });
  }
});

// Debug endpoint to see what metrics are being received
app.get('/api/debug/metrics', (req, res) => {
  const uniqueMetrics = [...new Set(storage.metrics.map(m => m.name))].sort();
  const metricCounts = {};
  storage.metrics.forEach(m => {
    metricCounts[m.name] = (metricCounts[m.name] || 0) + 1;
  });
  
  res.json({
    uniqueMetrics,
    metricCounts,
    sampleMetrics: storage.metrics.slice(-10),
    aggregated: {
      inputTokens: storage.aggregated.inputTokens,
      outputTokens: storage.aggregated.outputTokens,
      cacheReadTokens: storage.aggregated.cacheReadTokens,
      cacheCreationTokens: storage.aggregated.cacheCreationTokens,
      totalTokens: storage.aggregated.totalTokens
    }
  });
});

// Debug endpoint to compare data sources
app.get('/api/debug/stats-comparison', async (req, res) => {
  try {
    // Get sessions total
    const sessions = await r.db('metrics').table('sessions').run(dbConnection);
    const sessionsArray = await sessions.toArray();

    const sessionTotals = {
      linesOfCode: sessionsArray.reduce((sum, s) => sum + (s.linesOfCode || 0), 0),
      totalCost: sessionsArray.reduce((sum, s) => sum + (s.totalCost || 0), 0),
      activeTimeCLI: sessionsArray.reduce((sum, s) => sum + (s.activeTimeCLI || 0), 0),
      activeTimePlanning: sessionsArray.reduce((sum, s) => sum + (s.activeTimePlanning || 0), 0),
      activeTimeUser: sessionsArray.reduce((sum, s) => sum + (s.activeTimeUser || 0), 0),
      inputTokens: sessionsArray.reduce((sum, s) => sum + (s.inputTokens || 0), 0),
      outputTokens: sessionsArray.reduce((sum, s) => sum + (s.outputTokens || 0), 0),
    };

    // Get aggregated stats
    const aggregated = await r.db('metrics').table('aggregated_stats').get('current').run(dbConnection);

    res.json({
      sessionTotals,
      aggregatedStats: {
        linesOfCode: aggregated.linesOfCode,
        totalCost: aggregated.totalCost,
        activeTimeCLI: aggregated.activeTimeCLI,
        activeTimePlanning: aggregated.activeTimePlanning,
        activeTimeUser: aggregated.activeTimeUser,
        inputTokens: aggregated.inputTokens,
        outputTokens: aggregated.outputTokens,
      },
      discrepancy: {
        linesOfCode: sessionTotals.linesOfCode - (aggregated.linesOfCode || 0),
        totalCost: sessionTotals.totalCost - (aggregated.totalCost || 0),
        activeTimeCLI: sessionTotals.activeTimeCLI - (aggregated.activeTimeCLI || 0),
        activeTimePlanning: sessionTotals.activeTimePlanning - (aggregated.activeTimePlanning || 0),
        activeTimeUser: sessionTotals.activeTimeUser - (aggregated.activeTimeUser || 0),
        inputTokens: sessionTotals.inputTokens - (aggregated.inputTokens || 0),
        outputTokens: sessionTotals.outputTokens - (aggregated.outputTokens || 0),
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API endpoint for dashboard - get metrics
app.get('/api/metrics', async (req, res) => {
  console.log('📊 API /api/metrics called');

  // Get timeframe parameter
  const timeframe = req.query.timeframe || 'all';
  const cutoffTime = getTimeframeCutoff(timeframe);

  console.log(`   Timeframe: ${timeframe}, cutoff: ${new Date(cutoffTime).toISOString()}`);

  try {
    console.log('   Querying database...');
    // Query metrics from RethinkDB within timeframe
    const metricsCursor = await r.db('metrics')
      .table('metrics')
      .filter(r.row('timestamp').ge(cutoffTime))
      .orderBy('timestamp')
      .run(dbConnection);

    console.log('   Database query complete, converting to array...');

    const filteredMetrics = await metricsCursor.toArray();

    debugLog(`   Found ${filteredMetrics.length} metrics in database for timeframe: ${timeframe}`);

    // Aggregate stats from filtered metrics
    let filteredInputTokens = 0;
    let filteredOutputTokens = 0;
    let filteredCacheReadTokens = 0;
    let filteredCacheCreationTokens = 0;
    let filteredTotalCost = 0;
    let filteredLinesOfCode = 0;
    let filteredCommandsBlocked = 0;
    let filteredGitFailures = 0;
    let filteredFilesModified = 0;
    let filteredToolCalls = 0;
    let filteredActiveTimeCLI = 0;
    let filteredActiveTimePlanning = 0;
    let filteredActiveTimeUser = 0;
    let filteredSessionCount = 0;
    let filteredCommonModeCount = 0;
    const filteredByModel = {};

    filteredMetrics.forEach(metric => {
      const model = metric.attributes?.model || 'unknown';

      if (!filteredByModel[model]) {
        filteredByModel[model] = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          totalTokens: 0,
          totalCost: 0
        };
      }

      switch (metric.name) {
        case 'claude_code.token.usage':
          const tokenType = metric.attributes.type;
          const value = metric.value;

          if (tokenType === 'input') {
            filteredInputTokens += value;
            filteredByModel[model].inputTokens += value;
          } else if (tokenType === 'output') {
            filteredOutputTokens += value;
            filteredByModel[model].outputTokens += value;
          } else if (tokenType === 'cacheRead') {
            filteredCacheReadTokens += value;
            filteredByModel[model].cacheReadTokens += value;
          } else if (tokenType === 'cacheCreation') {
            filteredCacheCreationTokens += value;
            filteredByModel[model].cacheCreationTokens += value;
          }
          break;

        case 'claude_code.cost.usage':
          filteredTotalCost += metric.value;
          filteredByModel[model].totalCost += metric.value;
          break;

        case 'claude_code.lines_of_code.count':
          filteredLinesOfCode += metric.value;
          break;

        case 'claude_code.hook.commands_blocked':
          filteredCommandsBlocked += metric.value;
          break;

        case 'claude_code.hook.git_failures':
          filteredGitFailures += metric.value;
          break;

        case 'claude_code.tool.files_modified':
          filteredFilesModified += metric.value;
          break;

        case 'claude_code.tool.calls':
          filteredToolCalls += metric.value;
          break;

        case 'claude_code.active_time.total':
          const timeType = metric.attributes.type;
          if (timeType === 'cli') {
            filteredActiveTimeCLI += metric.value / 1000;
          } else if (timeType === 'planning') {
            filteredActiveTimePlanning += metric.value / 1000;
          } else if (timeType === 'user') {
            filteredActiveTimeUser += metric.value / 1000;
          }
          break;

        case 'claude_code.session.count':
          filteredSessionCount += metric.value;
          break;

        case 'claude_code.session.common_mode':
          filteredCommonModeCount += metric.value;
          break;
      }
    });

    // Calculate totals for filtered data
    const filteredTotalTokens = filteredInputTokens + filteredOutputTokens + filteredCacheReadTokens + filteredCacheCreationTokens;

    Object.keys(filteredByModel).forEach(model => {
      filteredByModel[model].totalTokens =
        filteredByModel[model].inputTokens +
        filteredByModel[model].outputTokens +
        filteredByModel[model].cacheReadTokens +
        filteredByModel[model].cacheCreationTokens;
    });

    // Format time in minutes
    const formatMinutes = (seconds) => {
      if (seconds < 60) return `${seconds.toFixed(1)}s`;
      return `${(seconds / 60).toFixed(1)}m`;
    };

    // Build stats object from database query results
    const statsToUse = {
      sessionCount: filteredSessionCount,
      commonModeCount: filteredCommonModeCount,
      inputTokens: filteredInputTokens,
      outputTokens: filteredOutputTokens,
      cacheReadTokens: filteredCacheReadTokens,
      cacheCreationTokens: filteredCacheCreationTokens,
      totalTokens: filteredTotalTokens,
      totalCost: filteredTotalCost,
      activeTimeCLI: filteredActiveTimeCLI,
      activeTimePlanning: filteredActiveTimePlanning,
      activeTimeUser: filteredActiveTimeUser,
      linesOfCode: filteredLinesOfCode,
      commandsBlocked: filteredCommandsBlocked,
      gitFailures: filteredGitFailures,
      filesModified: filteredFilesModified,
      toolCalls: filteredToolCalls,
      byModel: filteredByModel
    };

    // Calculate derived metrics
    const costPer1kOutput = statsToUse.outputTokens > 0
      ? ((statsToUse.totalCost / statsToUse.outputTokens) * 1000).toFixed(4)
      : '0.0000';

    const cacheEfficiency = (statsToUse.cacheReadTokens + statsToUse.inputTokens) > 0
      ? ((statsToUse.cacheReadTokens / (statsToUse.cacheReadTokens + statsToUse.inputTokens)) * 100).toFixed(2)
      : '0.00';

    const productivityRatio = statsToUse.linesOfCode > 0
      ? (statsToUse.linesOfCode / (statsToUse.totalTokens / 1000)).toFixed(2)
      : 0;

    // Calculate cost history and token history for graphs (sampled to keep response size reasonable)
    const costHistory = [];
    const tokensByTypeHistory = [];

    // Group cost metrics by 5-minute buckets for smoother graphs
    const bucketSize = 5 * 60 * 1000; // 5 minutes
    const costBuckets = new Map();
    const tokenBuckets = new Map();

    filteredMetrics.forEach(metric => {
      const bucketTime = Math.floor(metric.timestamp / bucketSize) * bucketSize;

      if (metric.name === 'claude_code.cost.usage') {
        if (!costBuckets.has(bucketTime)) {
          costBuckets.set(bucketTime, 0);
        }
        costBuckets.set(bucketTime, costBuckets.get(bucketTime) + metric.value);
      }

      if (metric.name === 'claude_code.token.usage') {
        if (!tokenBuckets.has(bucketTime)) {
          tokenBuckets.set(bucketTime, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
        }
        const bucket = tokenBuckets.get(bucketTime);
        const tokenType = metric.attributes.type;
        if (tokenType === 'input') bucket.input += metric.value;
        else if (tokenType === 'output') bucket.output += metric.value;
        else if (tokenType === 'cacheRead') bucket.cacheRead += metric.value;
        else if (tokenType === 'cacheCreation') bucket.cacheCreation += metric.value;
      }
    });

    // Convert buckets to arrays for charts
    let runningCost = 0;
    [...costBuckets.keys()].sort().forEach(time => {
      runningCost += costBuckets.get(time);
      costHistory.push({ time, value: runningCost });
    });

    [...tokenBuckets.keys()].sort().forEach(time => {
      const bucket = tokenBuckets.get(time);
      tokensByTypeHistory.push({
        time,
        input: bucket.input,
        output: bucket.output,
        cacheRead: bucket.cacheRead,
        cacheCreation: bucket.cacheCreation
      });
    });

    // Calculate session duration
    const sessionDuration = Date.now() - storage.currentSession.startTime;

    res.json({
      // Stats for selected timeframe
      sessionCount: statsToUse.sessionCount,
      commonModeCount: statsToUse.commonModeCount,
      inputTokens: statsToUse.inputTokens,
      outputTokens: statsToUse.outputTokens,
      cacheReadTokens: statsToUse.cacheReadTokens,
      cacheCreationTokens: statsToUse.cacheCreationTokens,
      totalTokens: statsToUse.totalTokens,
      totalCost: statsToUse.totalCost.toFixed(4),
      costPer1kOutput: costPer1kOutput,
      cacheEfficiency: cacheEfficiency,
      activeTimeCLI: formatMinutes(statsToUse.activeTimeCLI),
      activeTimePlanning: formatMinutes(statsToUse.activeTimePlanning),
      activeTimeUser: formatMinutes(statsToUse.activeTimeUser),
      linesOfCode: statsToUse.linesOfCode,
      commandsBlocked: statsToUse.commandsBlocked,
      gitFailures: statsToUse.gitFailures,
      filesModified: statsToUse.filesModified,
      toolCalls: statsToUse.toolCalls,
      productivityRatio: productivityRatio,
      byModel: statsToUse.byModel,
      costHistory: costHistory,
      tokensByTypeHistory: tokensByTypeHistory,
      recentMetrics: filteredMetrics.slice(-20),

      // Current session stats
      currentSession: {
        startTime: storage.currentSession.startTime,
        duration: sessionDuration,
        sessionCount: storage.currentSession.sessionCount,
        commonModeCount: storage.currentSession.commonModeCount,
        inputTokens: storage.currentSession.inputTokens,
        outputTokens: storage.currentSession.outputTokens,
        cacheReadTokens: storage.currentSession.cacheReadTokens,
        cacheCreationTokens: storage.currentSession.cacheCreationTokens,
        totalTokens: storage.currentSession.totalTokens,
        totalCost: storage.currentSession.totalCost.toFixed(4),
        costPer1kOutput: storage.currentSession.costPer1kOutput || '0.0000',
        cacheEfficiency: storage.currentSession.cacheEfficiency || '0.00',
        activeTimeCLI: formatMinutes(storage.currentSession.activeTimeCLI),
        activeTimePlanning: formatMinutes(storage.currentSession.activeTimePlanning),
        activeTimeUser: formatMinutes(storage.currentSession.activeTimeUser),
        linesOfCode: storage.currentSession.linesOfCode,
        commandsBlocked: storage.currentSession.commandsBlocked,
        gitFailures: storage.currentSession.gitFailures,
        filesModified: storage.currentSession.filesModified,
        toolCalls: storage.currentSession.toolCalls,
        productivityRatio: storage.currentSession.productivityRatio || 0,
        byModel: storage.currentSession.byModel
      },

      // Daily stats
      dailyStats: {
        dayStart: storage.dailyStats.dayStart,
        inputTokens: storage.dailyStats.inputTokens,
        outputTokens: storage.dailyStats.outputTokens,
        cacheReadTokens: storage.dailyStats.cacheReadTokens,
        cacheCreationTokens: storage.dailyStats.cacheCreationTokens,
        totalTokens: storage.dailyStats.totalTokens,
        totalCost: storage.dailyStats.totalCost.toFixed(4),
        byModel: storage.dailyStats.byModel,
        timeUntilReset: getTimeUntilReset('daily'),
        timeUntilResetFormatted: formatTimeUntilReset(getTimeUntilReset('daily'))
      },

      // Weekly stats
      weeklyStats: {
        weekStart: storage.weeklyStats.weekStart,
        inputTokens: storage.weeklyStats.inputTokens,
        outputTokens: storage.weeklyStats.outputTokens,
        cacheReadTokens: storage.weeklyStats.cacheReadTokens,
        cacheCreationTokens: storage.weeklyStats.cacheCreationTokens,
        totalTokens: storage.weeklyStats.totalTokens,
        totalCost: storage.weeklyStats.totalCost.toFixed(4),
        byModel: storage.weeklyStats.byModel,
        timeUntilReset: getTimeUntilReset('weekly'),
        timeUntilResetFormatted: formatTimeUntilReset(getTimeUntilReset('weekly'))
      },

      // Usage limits
      usageLimits: storage.usageLimits
    });
  } catch (err) {
    console.error('Error querying metrics from database:', err);
    res.status(500).json({ error: 'Failed to query metrics from database' });
  }
});

// API endpoint for dashboard - get events
app.get('/api/events', (req, res) => {
  // Get timeframe parameter
  const timeframe = req.query.timeframe || 'all';
  const cutoffTime = getTimeframeCutoff(timeframe);

  // Keep only last 500 events
  if (storage.events.length > 500) {
    storage.events = storage.events.slice(-500);
  }

  // Filter events by timeframe
  const filteredEvents = storage.events.filter(e => e.timestamp >= cutoffTime);

  res.json({
    events: filteredEvents.slice(-100).reverse(),
    eventCounts: storage.aggregated.eventCounts
  });
});

// API endpoint for terminal sessions
app.get('/api/sessions', (req, res) => {
  const now = Date.now();
  const formatMinutes = (seconds) => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    return `${(seconds / 60).toFixed(1)}m`;
  };

  // Convert sessions object to array and add computed properties
  const sessionsArray = Object.values(storage.sessions)
    .filter(session => {
      // Only show sessions active in the last 5 minutes
      return (now - session.lastSeen) < 300000; // 5 minutes = 300000ms
    })
    .map(session => {
      const duration = now - session.startTime;
      const totalActiveTime = session.activeTimeCLI + session.activeTimePlanning + session.activeTimeUser;
      const isActive = (now - session.lastSeen) < 60000; // Active if seen in last minute

      return {
        sessionId: session.sessionId,
        terminalType: session.terminalType,
        startTime: session.startTime,
        lastSeen: session.lastSeen,
        duration,
        isActive,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        cacheReadTokens: session.cacheReadTokens,
        cacheCreationTokens: session.cacheCreationTokens,
        totalTokens: session.totalTokens,
        totalCost: session.totalCost.toFixed(4),
        activeTimeCLI: formatMinutes(session.activeTimeCLI),
        activeTimePlanning: formatMinutes(session.activeTimePlanning),
        activeTimeUser: formatMinutes(session.activeTimeUser),
        totalActiveTime: formatMinutes(totalActiveTime),
        linesOfCode: session.linesOfCode,
        commonModeCount: session.commonModeCount || 0,
        byModel: session.byModel
      };
    });

  // Sort by last seen (most recent first)
  sessionsArray.sort((a, b) => b.lastSeen - a.lastSeen);

  res.json({
    sessions: sessionsArray,
    totalSessions: sessionsArray.length,
    activeSessions: sessionsArray.filter(s => s.isActive).length
  });
});

// API endpoint to get session count for a timeframe (from database)
app.get('/api/sessions/count', async (req, res) => {
  try {
    const timeframe = req.query.timeframe || 'all';
    const cutoffTime = getTimeframeCutoff(timeframe);

    // Query all sessions from database
    const sessionsCursor = await r.db('metrics')
      .table('sessions')
      .run(dbConnection);

    const allSessions = await sessionsCursor.toArray();

    // Filter sessions based on their last activity
    const sessionsInTimeframe = allSessions.filter(session =>
      session.lastSeen >= cutoffTime
    );

    const commonModeCount = sessionsInTimeframe.reduce((sum, s) =>
      sum + (s.commonModeCount || 0), 0
    );

    res.json({
      sessionCount: sessionsInTimeframe.length,
      commonModeCount: commonModeCount,
      timeframe: timeframe,
      cutoffTime: cutoffTime
    });
  } catch (err) {
    console.error('Error querying session count:', err);
    res.status(500).json({ error: err.message });
  }
});

// API endpoint to update usage limits
app.post('/api/usage-limits', (req, res) => {
  try {
    const { dailyTokenLimit, weeklyTokenLimit, dailyCostLimit, weeklyCostLimit, enabled } = req.body;
    
    if (dailyTokenLimit !== undefined) storage.usageLimits.dailyTokenLimit = dailyTokenLimit;
    if (weeklyTokenLimit !== undefined) storage.usageLimits.weeklyTokenLimit = weeklyTokenLimit;
    if (dailyCostLimit !== undefined) storage.usageLimits.dailyCostLimit = dailyCostLimit;
    if (weeklyCostLimit !== undefined) storage.usageLimits.weeklyCostLimit = weeklyCostLimit;
    if (enabled !== undefined) storage.usageLimits.enabled = enabled;
    
    res.json({
      success: true,
      usageLimits: storage.usageLimits
    });
  } catch (error) {
    console.error('Error updating usage limits:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API endpoint to reset current session
app.post('/api/reset-session', (req, res) => {
  try {
    storage.currentSession = {
      startTime: Date.now(),
      sessionCount: 0,
      commonModeCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      costPer1kOutput: 0,
      activeTimeCLI: 0,
      activeTimePlanning: 0,
      activeTimeUser: 0,
      linesOfCode: 0,
      commandsBlocked: 0,
      gitFailures: 0,
      filesModified: 0,
      toolCalls: 0,
      byModel: {}
    };
    
    res.json({
      success: true,
      message: 'Current session has been reset'
    });
  } catch (error) {
    console.error('Error resetting session:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test endpoint to verify session key
app.post('/api/test-claude-session', async (req, res) => {
  try {
    const { sessionKey, userAgent } = req.body;
    
    // Parse cookies
    const cookies = parseCookieString(sessionKey);
    
    console.log('🧪 Testing cookies...');
    console.log('   Total cookies:', Object.keys(cookies).length);
    console.log('   sessionKey:', cookies.sessionKey ? `${cookies.sessionKey.substring(0, 20)}...` : 'MISSING');
    console.log('   cf_clearance:', cookies.cf_clearance ? 'PRESENT ✅' : 'MISSING ❌');
    console.log('   anthropic-device-id:', cookies['anthropic-device-id'] ? 'PRESENT ✅' : 'MISSING ❌');
    console.log('   User-Agent:', userAgent || 'default');
    
    if (!cookies.sessionKey) {
      return res.json({
        success: false,
        error: 'No sessionKey found in cookie string'
      });
    }
    
    if (!cookies.cf_clearance) {
      console.warn('⚠️  WARNING: Missing cf_clearance - Cloudflare will likely block this request');
    }
    
    // Build complete cookie string
    const cookieString = Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    
    // Try a request with curl-impersonate (bypasses Cloudflare TLS fingerprinting)
    console.log('🚀 Using curl-impersonate to bypass Cloudflare...');
    const testResponse = await curlImpersonate('https://claude.ai/api/organizations', {
      headers: {
        'Cookie': cookieString,
        'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'anthropic-client-platform': 'web_claude_ai',
        'anthropic-client-version': '1.0.0',
        'anthropic-client-sha': '2ce3bc5e37166a5da90a698bae76fdfa0cbcbd11',
        'anthropic-device-id': cookies['anthropic-device-id'] || 'unknown',
        'anthropic-anonymous-id': cookies['ajs_anonymous_id'] || 'unknown',
        'Referer': 'https://claude.ai/settings/usage',
        'Origin': 'https://claude.ai',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Connection': 'keep-alive'
      },
      timeout: 10
    });
    
    console.log('📥 Test response status:', testResponse.status);
    console.log('📥 Test response headers:', JSON.stringify(testResponse.headers).substring(0, 200));
    console.log('📥 Test response data:', JSON.stringify(testResponse.data).substring(0, 200));
    
    res.json({
      success: testResponse.status === 200,
      status: testResponse.status,
      headers: testResponse.headers,
      data: testResponse.data
    });
  } catch (error) {
    console.error('❌ Test error:', error.message);
    res.json({
      success: false,
      error: error.message,
      details: error.response ? {
        status: error.response.status,
        data: error.response.data
      } : null
    });
  }
});

// Helper function to parse cookie string
function parseCookieString(cookieString) {
  const cookies = {};
  if (!cookieString) return cookies;
  
  // Split by semicolon and parse each cookie
  cookieString.split(';').forEach(cookie => {
    const parts = cookie.trim().split('=');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const value = parts.slice(1).join('=').trim(); // Handle = in value
      cookies[name] = value;
    }
  });
  
  return cookies;
}

// Helper function to make requests with curl-impersonate (bypasses Cloudflare)
function curlImpersonate(url, options = {}) {
  return new Promise((resolve, reject) => {
    // Impersonate Chrome browser to bypass Cloudflare TLS fingerprinting
    const curl = Curl.impersonate(Browser.Chrome);
    
    curl.setOpt('URL', url);
    
    // Set headers
    if (options.headers) {
      const headerArray = Object.entries(options.headers).map(([key, value]) => `${key}: ${value}`);
      curl.setOpt('HTTPHEADER', headerArray);
    }
    
    // Set method
    if (options.method === 'POST') {
      curl.setOpt('POST', true);
      if (options.body) {
        curl.setOpt('POSTFIELDS', options.body);
      }
    }
    
    // Follow redirects
    curl.setOpt('FOLLOWLOCATION', true);
    
    // SSL/TLS options
    curl.setOpt('SSL_VERIFYPEER', true);
    curl.setOpt('SSL_VERIFYHOST', 2);
    
    // Timeout
    curl.setOpt('TIMEOUT', options.timeout || 10);
    
    // Handle response
    curl.on('end', function (statusCode, data, headers) {
      curl.close();
      
      try {
        const responseData = typeof data === 'string' ? JSON.parse(data) : data;
        resolve({
          status: statusCode,
          data: responseData,
          headers: headers
        });
      } catch (e) {
        // If JSON parse fails, return raw data
        resolve({
          status: statusCode,
          data: data,
          headers: headers
        });
      }
    });
    
    curl.on('error', function (error) {
      curl.close();
      reject(error);
    });
    
    curl.perform();
  });
}

// Claude.ai usage polling endpoint (proxy)
app.post('/api/claude-usage', async (req, res) => {
  try {
    const { sessionKey, userAgent, language, platform } = req.body;
    
    // Parse the cookie string to extract all cookies
    const cookies = parseCookieString(sessionKey);
    
    console.log('🔐 Cookies received:', Object.keys(cookies).length, 'cookies');
    console.log('   sessionKey:', cookies.sessionKey ? `${cookies.sessionKey.substring(0, 15)}...` : 'MISSING');
    console.log('   cf_clearance:', cookies.cf_clearance ? 'present' : 'MISSING');
    console.log('   anthropic-device-id:', cookies['anthropic-device-id'] || 'MISSING');
    console.log('🖥️  User-Agent:', userAgent || 'default');
    console.log('🌍 Language:', language || 'en-US');
    console.log('💻 Platform:', platform || 'unknown');

    if (!sessionKey || !cookies.sessionKey) {
      return res.json({
        success: false,
        data: null,
        error: {
          code: 'MISSING_SESSION_KEY',
          message: 'Cookies string is required (paste from document.cookie)'
        }
      });
    }
    
    // Warn if cf_clearance is missing (Cloudflare challenge cookie)
    if (!cookies.cf_clearance) {
      console.warn('⚠️  WARNING: cf_clearance cookie missing - request will likely be blocked by Cloudflare');
    }

    // Step 1: Fetch organizations to get the org ID
    console.log('🔍 Step 1: Fetching organizations...');
    
    // Use the actual browser's user agent and platform info
    const actualUserAgent = userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
    const actualLanguage = language || 'en-US,en;q=0.9';
    const actualPlatform = platform || 'Windows';
    
    // Extract Chrome version from user agent for sec-ch-ua header
    const chromeMatch = actualUserAgent.match(/Chrome\/(\d+)/);
    const chromeVersion = chromeMatch ? chromeMatch[1] : '143';
    
    // Build the complete cookie string from all cookies
    const cookieString = Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    
    // Get required IDs from cookies
    const deviceId = cookies['anthropic-device-id'] || 'unknown-device';
    const anonymousId = cookies['ajs_anonymous_id'] || 'unknown-anonymous';
    
    const commonHeaders = {
      'Cookie': cookieString,
      'User-Agent': actualUserAgent,
      'Accept': '*/*',
      'Accept-Language': actualLanguage,
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'anthropic-client-platform': 'web_claude_ai',
      'anthropic-client-version': '1.0.0',
      'anthropic-client-sha': '2ce3bc5e37166a5da90a698bae76fdfa0cbcbd11',
      'anthropic-device-id': deviceId,
      'anthropic-anonymous-id': anonymousId,
      'baggage': 'sentry-environment=production,sentry-release=2ce3bc5e37166a5da90a698bae76fdfa0cbcbd11,sentry-public_key=58e9b9d0fc244061a1b54fe288b0e483,sentry-trace_id=f31b4ce870ad422785e88b9e026b4b38,sentry-org_id=1158394',
      'sentry-trace': 'f31b4ce870ad422785e88b9e026b4b38-af21a8c4be3f5bc4',
      'content-type': 'application/json',
      'Referer': 'https://claude.ai/settings/usage',
      'Origin': 'https://claude.ai',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'sec-ch-ua': `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not A(Brand";v="24"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': `"${actualPlatform}"`,
      'priority': 'u=1, i'
    };
    
    console.log('🚀 Using curl-impersonate to bypass Cloudflare...');
    const orgResponse = await curlImpersonate('https://claude.ai/api/organizations', {
      headers: commonHeaders,
      timeout: 10
    });
    
    console.log('📥 Organizations response status:', orgResponse.status);
    
    // Check if authentication failed
    if (orgResponse.status === 401 || orgResponse.status === 403) {
      console.error('❌ Authentication failed - session key invalid or expired');
      return res.json({
        success: false,
        data: null,
        error: {
          code: 'COOKIE_EXPIRED',
          message: 'Session cookie has expired or is invalid. Please get a fresh session key from claude.ai',
          details: {
            status: orgResponse.status,
            data: orgResponse.data
          }
        }
      });
    }
    
    // Check for other error status codes
    if (orgResponse.status >= 400) {
      console.error('❌ Claude.ai API returned error status:', orgResponse.status);
      return res.json({
        success: false,
        data: null,
        error: {
          code: 'API_ERROR',
          message: `Claude.ai API error: ${orgResponse.status}`,
          details: {
            status: orgResponse.status,
            data: orgResponse.data
          }
        }
      });
    }
    
    // Get organization ID
    const orgs = orgResponse.data;
    if (!Array.isArray(orgs) || orgs.length === 0) {
      console.error('❌ No organizations found');
      return res.json({
        success: false,
        data: null,
        error: {
          code: 'NO_ORG',
          message: 'No organizations found for this account'
        }
      });
    }
    
    const orgId = orgs[0].uuid;
    console.log('✅ Found organization:', orgId);
    
    // Step 2: Fetch usage data for the organization
    console.log('🔍 Step 2: Fetching usage data...');
    
    const usageResponse = await curlImpersonate(`https://claude.ai/api/organizations/${orgId}/usage`, {
      headers: commonHeaders,
      timeout: 10
    });
    
    console.log('📥 Usage response status:', usageResponse.status);
    console.log('📥 Usage data:', JSON.stringify(usageResponse.data).substring(0, 300));
    
    if (usageResponse.status >= 400) {
      console.error('❌ Failed to fetch usage data:', usageResponse.status);
      return res.json({
        success: false,
        data: null,
        error: {
          code: 'USAGE_ERROR',
          message: `Failed to fetch usage data: ${usageResponse.status}`
        }
      });
    }

    // Try to extract usage data from response
    const data = usageResponse.data;

    // Parse the response and extract usage metrics
    // Data structure: { five_hour: {...}, seven_day: {...}, seven_day_sonnet: {...}, etc. }
    console.log('✅ Successfully fetched usage data');
    
    const usageData = {
      // 5-hour window (Claude's short-term rate limit)
      fiveHour: data.five_hour ? {
        utilization: data.five_hour.utilization || 0,
        resetsAt: data.five_hour.resets_at,
        resetsIn: data.five_hour.resets_at ? new Date(data.five_hour.resets_at).getTime() - Date.now() : 0
      } : null,
      
      // 7-day window (weekly limit)
      sevenDay: data.seven_day ? {
        utilization: data.seven_day.utilization || 0,
        resetsAt: data.seven_day.resets_at,
        resetsIn: data.seven_day.resets_at ? new Date(data.seven_day.resets_at).getTime() - Date.now() : 0
      } : null,
      
      // Model-specific limits
      byModel: {
        sonnet: data.seven_day_sonnet ? {
          utilization: data.seven_day_sonnet.utilization || 0,
          resetsAt: data.seven_day_sonnet.resets_at,
          resetsIn: data.seven_day_sonnet.resets_at ? new Date(data.seven_day_sonnet.resets_at).getTime() - Date.now() : 0
        } : null,
        opus: data.seven_day_opus ? {
          utilization: data.seven_day_opus.utilization || 0,
          resetsAt: data.seven_day_opus.resets_at,
          resetsIn: data.seven_day_opus.resets_at ? new Date(data.seven_day_opus.resets_at).getTime() - Date.now() : 0
        } : null
      },
      
      lastUpdated: Date.now(),
      rawData: data // Include raw data for debugging
    };

    res.json({
      success: true,
      data: usageData,
      error: null
    });

  } catch (error) {
    // Handle different error types
    console.error('❌ Claude.ai API Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data).substring(0, 200));
    }
    
    let errorResponse = {
      success: false,
      data: null,
      error: {
        code: 'UNKNOWN_ERROR',
        message: error.message,
        details: error.response ? {
          status: error.response.status,
          data: error.response.data
        } : null
      }
    };

    if (error.response) {
      // HTTP error from claude.ai
      if (error.response.status === 401 || error.response.status === 403) {
        errorResponse.error.code = 'COOKIE_EXPIRED';
        errorResponse.error.message = 'Session cookie has expired. Please refresh.';
      } else {
        errorResponse.error.code = 'API_ERROR';
        errorResponse.error.message = `Claude.ai API error: ${error.response.status}`;
      }
    } else if (error.code === 'ECONNABORTED') {
      errorResponse.error.code = 'TIMEOUT';
      errorResponse.error.message = 'Request to Claude.ai timed out';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      errorResponse.error.code = 'NETWORK_ERROR';
      errorResponse.error.message = 'Cannot connect to Claude.ai';
    }

    res.json(errorResponse);
  }
});

// Serve static dashboard files AFTER API routes
app.use(express.static(path.join(__dirname, 'public')));

// Load recent data from database on startup
async function loadRecentDataFromDB() {
  console.log('📚 Loading recent data from database...');

  try {
    // Load last 1000 metrics
    const metricsCursor = await r.db('metrics')
      .table('metrics')
      .orderBy({ index: r.desc('timestamp') })
      .limit(1000)
      .run(dbConnection);

    const metricsRows = await metricsCursor.toArray();

    storage.metrics = metricsRows.map(row => ({
      timestamp: row.timestamp,
      name: row.name,
      value: row.value,
      attributes: row.attributes
    })).reverse(); // Reverse to maintain chronological order

    console.log(`  ✅ Loaded ${metricsRows.length} metrics`);

    // Load last 500 events
    const eventsCursor = await r.db('metrics')
      .table('events')
      .orderBy({ index: r.desc('timestamp') })
      .limit(500)
      .run(dbConnection);

    const eventsRows = await eventsCursor.toArray();

    storage.events = eventsRows.map(row => ({
      timestamp: row.timestamp,
      type: row.type,
      body: row.body,
      attributes: row.attributes,
      severity: row.severity
    })).reverse(); // Reverse to maintain chronological order

    console.log(`  ✅ Loaded ${eventsRows.length} events`);

    // Recalculate aggregated stats from loaded metrics
    recalculateAggregatedStats();
  } catch (err) {
    console.error('Error loading data from database:', err);
  }
}

// Recalculate aggregated statistics from in-memory metrics
function recalculateAggregatedStats() {
  console.log('🔄 Recalculating aggregated statistics...');
  
  // Reset aggregated stats
  storage.aggregated = {
    sessionCount: 0,
    commonModeCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    costPer1kOutput: 0,
    activeTimeCLI: 0,
    activeTimePlanning: 0,
    activeTimeUser: 0,
    linesOfCode: 0,
    commandsBlocked: 0,
    gitFailures: 0,
    filesModified: 0,
    toolCalls: 0,
    byModel: {},
    tokenHistory: [],
    costHistory: [],
    tokensByTypeHistory: [],
    eventCounts: {}
  };
  
  // Replay metrics to rebuild aggregated stats
  storage.metrics.forEach(metric => {
    const { name: metricName, value, attributes, timestamp } = metric;
    const model = attributes.model || 'unknown';
    
    if (!storage.aggregated.byModel[model]) {
      storage.aggregated.byModel[model] = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cost: 0
      };
    }
    
    switch (metricName) {
      case 'claude_code.token.usage':
        const tokenType = attributes.type;
        if (tokenType === 'input') {
          storage.aggregated.inputTokens += value;
          storage.aggregated.byModel[model].inputTokens += value;
        } else if (tokenType === 'output') {
          storage.aggregated.outputTokens += value;
          storage.aggregated.byModel[model].outputTokens += value;
        } else if (tokenType === 'cacheRead') {
          storage.aggregated.cacheReadTokens += value;
          storage.aggregated.byModel[model].cacheReadTokens += value;
        } else if (tokenType === 'cacheCreation') {
          storage.aggregated.cacheCreationTokens += value;
          storage.aggregated.byModel[model].cacheCreationTokens += value;
        }
        break;
      case 'claude_code.cost.usage':
        storage.aggregated.totalCost += value;
        storage.aggregated.byModel[model].cost += value;
        storage.aggregated.costHistory.push({ time: timestamp, value: storage.aggregated.totalCost });
        break;
      case 'claude_code.session.count':
        storage.aggregated.sessionCount += value;
        break;
      case 'claude_code.session.common_mode':
        storage.aggregated.commonModeCount += value;
        break;
      case 'claude_code.active_time.total':
        const timeType = attributes.type;
        if (timeType === 'cli') {
          storage.aggregated.activeTimeCLI += value / 1000;
        } else if (timeType === 'planning') {
          storage.aggregated.activeTimePlanning += value / 1000;
        } else if (timeType === 'user') {
          storage.aggregated.activeTimeUser += value / 1000;
        }
        break;
      case 'claude_code.lines_of_code.count':
        storage.aggregated.linesOfCode += value;
        break;
      case 'claude_code.hook.commands_blocked':
        storage.aggregated.commandsBlocked += value;
        break;
      case 'claude_code.hook.git_failures':
        storage.aggregated.gitFailures += value;
        break;
      case 'claude_code.tool.files_modified':
        storage.aggregated.filesModified += value;
        break;
      case 'claude_code.tool.calls':
        storage.aggregated.toolCalls += value;
        break;
    }
  });
  
  // Recalculate event counts
  storage.events.forEach(event => {
    storage.aggregated.eventCounts[event.type] = 
      (storage.aggregated.eventCounts[event.type] || 0) + 1;
  });
  
  // Recalculate derived stats
  storage.aggregated.totalTokens =
    storage.aggregated.inputTokens +
    storage.aggregated.outputTokens +
    storage.aggregated.cacheReadTokens +
    storage.aggregated.cacheCreationTokens;
  
  const totalCacheTokens = storage.aggregated.cacheReadTokens + storage.aggregated.cacheCreationTokens;
  if (totalCacheTokens > 0) {
    storage.aggregated.cacheEfficiency =
      (storage.aggregated.cacheReadTokens / totalCacheTokens * 100).toFixed(2);
  }
  
  if (storage.aggregated.outputTokens > 0) {
    storage.aggregated.costPer1kOutput =
      (storage.aggregated.totalCost / storage.aggregated.outputTokens * 1000).toFixed(4);
  }
  
  const totalActiveTime = storage.aggregated.activeTimeCLI +
                         storage.aggregated.activeTimePlanning +
                         storage.aggregated.activeTimeUser;
  if (totalActiveTime > 0) {
    storage.aggregated.productivityRatio =
      Math.round(storage.aggregated.outputTokens / totalActiveTime);
  }
  
  // Recalculate daily and weekly stats from metrics
  const now = Date.now();
  const dayStart = getDayStart();
  const weekStart = getWeekStart();
  
  // Reset daily and weekly stats
  storage.dailyStats = {
    dayStart: dayStart,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    byModel: {}
  };
  
  storage.weeklyStats = {
    weekStart: weekStart,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    byModel: {}
  };
  
  // Replay metrics for daily and weekly stats
  storage.metrics.forEach(metric => {
    const { name: metricName, value, attributes, timestamp } = metric;
    const model = attributes.model || 'unknown';
    
    // Check if metric is within current day
    const isToday = timestamp >= dayStart;
    // Check if metric is within current week
    const isThisWeek = timestamp >= weekStart;
    
    if (isToday || isThisWeek) {
      // Initialize model tracking if needed
      if (isToday && !storage.dailyStats.byModel[model]) {
        storage.dailyStats.byModel[model] = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cost: 0
        };
      }
      if (isThisWeek && !storage.weeklyStats.byModel[model]) {
        storage.weeklyStats.byModel[model] = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cost: 0
        };
      }
      
      switch (metricName) {
        case 'claude_code.token.usage':
          const tokenType = attributes.type;
          if (tokenType === 'input') {
            if (isToday) {
              storage.dailyStats.inputTokens += value;
              storage.dailyStats.byModel[model].inputTokens += value;
            }
            if (isThisWeek) {
              storage.weeklyStats.inputTokens += value;
              storage.weeklyStats.byModel[model].inputTokens += value;
            }
          } else if (tokenType === 'output') {
            if (isToday) {
              storage.dailyStats.outputTokens += value;
              storage.dailyStats.byModel[model].outputTokens += value;
            }
            if (isThisWeek) {
              storage.weeklyStats.outputTokens += value;
              storage.weeklyStats.byModel[model].outputTokens += value;
            }
          } else if (tokenType === 'cacheRead') {
            if (isToday) {
              storage.dailyStats.cacheReadTokens += value;
              storage.dailyStats.byModel[model].cacheReadTokens += value;
            }
            if (isThisWeek) {
              storage.weeklyStats.cacheReadTokens += value;
              storage.weeklyStats.byModel[model].cacheReadTokens += value;
            }
          } else if (tokenType === 'cacheCreation') {
            if (isToday) {
              storage.dailyStats.cacheCreationTokens += value;
              storage.dailyStats.byModel[model].cacheCreationTokens += value;
            }
            if (isThisWeek) {
              storage.weeklyStats.cacheCreationTokens += value;
              storage.weeklyStats.byModel[model].cacheCreationTokens += value;
            }
          }
          break;
        case 'claude_code.cost.usage':
          if (isToday) {
            storage.dailyStats.totalCost += value;
            storage.dailyStats.byModel[model].cost += value;
          }
          if (isThisWeek) {
            storage.weeklyStats.totalCost += value;
            storage.weeklyStats.byModel[model].cost += value;
          }
          break;
      }
    }
  });
  
  // Calculate totals for daily and weekly
  storage.dailyStats.totalTokens =
    storage.dailyStats.inputTokens +
    storage.dailyStats.outputTokens +
    storage.dailyStats.cacheReadTokens +
    storage.dailyStats.cacheCreationTokens;
  
  storage.weeklyStats.totalTokens =
    storage.weeklyStats.inputTokens +
    storage.weeklyStats.outputTokens +
    storage.weeklyStats.cacheReadTokens +
    storage.weeklyStats.cacheCreationTokens;
  
  console.log('  ✅ Aggregated statistics recalculated');
  console.log(`  ✅ Daily stats: ${storage.dailyStats.totalTokens} tokens, $${storage.dailyStats.totalCost.toFixed(4)}`);
  console.log(`  ✅ Weekly stats: ${storage.weeklyStats.totalTokens} tokens, $${storage.weeklyStats.totalCost.toFixed(4)}`);
}

// Session changefeed and WebSocket broadcasting functions
const formatMinutes = (seconds) => {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
};

function formatSessionData(session) {
  if (!session) return null;

  const now = Date.now();
  const totalActiveTime = (session.activeTimeCLI || 0) + (session.activeTimePlanning || 0) + (session.activeTimeUser || 0);

  // Debug logging for active time data
  console.log(`🔍 Formatting session ${session.sessionId}:`, {
    activeTimeCLI: session.activeTimeCLI,
    activeTimePlanning: session.activeTimePlanning,
    activeTimeUser: session.activeTimeUser,
    totalActiveTime: totalActiveTime
  });

  return {
    sessionId: session.sessionId,
    terminalType: session.terminalType,
    startTime: session.startTime,
    lastSeen: session.lastSeen,
    duration: now - session.startTime,
    isActive: (now - session.lastSeen) < 60000, // Active if seen in last minute
    inputTokens: session.inputTokens || 0,
    outputTokens: session.outputTokens || 0,
    cacheReadTokens: session.cacheReadTokens || 0,
    cacheCreationTokens: session.cacheCreationTokens || 0,
    totalTokens: session.totalTokens || 0,
    totalCost: (session.totalCost || 0).toFixed(4),
    activeTimeCLI: formatMinutes(session.activeTimeCLI || 0),
    activeTimePlanning: formatMinutes(session.activeTimePlanning || 0),
    activeTimeUser: formatMinutes(session.activeTimeUser || 0),
    totalActiveTime: formatMinutes(totalActiveTime),
    linesOfCode: session.linesOfCode || 0,
    commonModeCount: session.commonModeCount || 0,
    byModel: session.byModel || {}
  };
}

function broadcastSessionUpdate(change) {
  let message;
  let sessionData;

  if (change.type === 'initial' || change.type === 'add' || change.type === 'change') {
    // Session added or updated
    sessionData = formatSessionData(change.new_val);
    activeSessions.set(change.new_val.sessionId, sessionData); // Update cache

    message = {
      type: 'session_update',
      action: change.type === 'initial' ? 'add' : change.type,
      timestamp: Date.now(),
      data: sessionData
    };
  } else if (change.type === 'remove') {
    // Session removed (became inactive)
    activeSessions.delete(change.old_val.sessionId); // Remove from cache

    message = {
      type: 'session_update',
      action: 'remove',
      timestamp: Date.now(),
      data: { sessionId: change.old_val.sessionId }
    };
  }

  if (!message) return;

  // Broadcast to all connected clients
  const messageStr = JSON.stringify(message);
  connectedClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageStr);
      } catch (error) {
        console.error('Error broadcasting session update:', error);
        connectedClients.delete(client);
      }
    }
  });
}

// Recalculate aggregated stats from all buckets (OLD - DEPRECATED - Use recalculateAggregatedStatsFromSessions instead)
async function recalculateAggregatedStatsFromBuckets() {
  if (!dbConnection) return;

  try {
    console.log('🔄 Recalculating aggregated stats from all buckets...');

    // Get all buckets
    const buckets = await r.db('metrics')
      .table('metric_buckets')
      .run(dbConnection);

    const bucketsArray = await buckets.toArray();
    console.log(`  📊 Found ${bucketsArray.length} buckets to process`);

    if (bucketsArray.length === 0) {
      console.log('  ℹ️  No buckets found, skipping recalculation');
      return;
    }

    // Aggregate all data from buckets
    const aggregated = {
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
    };

    bucketsArray.forEach(bucket => {
      aggregated.inputTokens += bucket.inputTokens || 0;
      aggregated.outputTokens += bucket.outputTokens || 0;
      aggregated.cacheReadTokens += bucket.cacheReadTokens || 0;
      aggregated.cacheCreationTokens += bucket.cacheCreationTokens || 0;
      aggregated.totalCost += bucket.totalCost || 0;
      aggregated.activeTimeCLI += bucket.activeTimeCLI || 0;
      aggregated.activeTimePlanning += bucket.activeTimePlanning || 0;
      aggregated.activeTimeUser += bucket.activeTimeUser || 0;
      aggregated.linesOfCode += bucket.linesOfCode || 0;
      aggregated.commandsBlocked += bucket.commandsBlocked || 0;
      aggregated.gitFailures += bucket.gitFailures || 0;
      aggregated.filesModified += bucket.filesModified || 0;
      aggregated.toolCalls += bucket.toolCalls || 0;

      // Merge byModel
      if (bucket.byModel) {
        Object.entries(bucket.byModel).forEach(([model, data]) => {
          if (!aggregated.byModel[model]) {
            aggregated.byModel[model] = {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              cost: 0
            };
          }
          aggregated.byModel[model].inputTokens += data.inputTokens || 0;
          aggregated.byModel[model].outputTokens += data.outputTokens || 0;
          aggregated.byModel[model].cacheReadTokens += data.cacheReadTokens || 0;
          aggregated.byModel[model].cacheCreationTokens += data.cacheCreationTokens || 0;
          aggregated.byModel[model].cost += data.cost || 0;
        });
      }
    });

    // Replace the aggregated_stats document with recalculated values
    await r.db('metrics').table('aggregated_stats')
      .get('current')
      .replace(Object.assign({ id: 'current' }, aggregated))
      .run(dbConnection);

    console.log(`  ✅ Recalculated aggregated stats:`);
    console.log(`     Total Cost: $${aggregated.totalCost.toFixed(2)}`);
    console.log(`     Input Tokens: ${(aggregated.inputTokens / 1000).toFixed(1)}K`);
    console.log(`     Output Tokens: ${(aggregated.outputTokens / 1000).toFixed(1)}K`);
    console.log(`     Cache Read: ${(aggregated.cacheReadTokens / 1000000).toFixed(1)}M`);
    console.log(`     Lines of Code: ${aggregated.linesOfCode}`);
  } catch (err) {
    console.error('❌ Error recalculating aggregated stats:', err);
  }
}

async function recalculateAggregatedStatsFromSessions() {
  if (!dbConnection) return;

  try {
    console.log('🔄 Recalculating aggregated stats from sessions...');

    const sessions = await r.db('metrics')
      .table('sessions')
      .run(dbConnection);

    const sessionsArray = await sessions.toArray();
    console.log(`  📊 Found ${sessionsArray.length} sessions to process`);

    if (sessionsArray.length === 0) {
      console.log('  ℹ️  No sessions found, skipping recalculation');
      return;
    }

    const aggregated = {
      sessionCount: sessionsArray.length,
      commonModeCount: 0,
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
    };

    sessionsArray.forEach(session => {
      aggregated.inputTokens += session.inputTokens || 0;
      aggregated.outputTokens += session.outputTokens || 0;
      aggregated.cacheReadTokens += session.cacheReadTokens || 0;
      aggregated.cacheCreationTokens += session.cacheCreationTokens || 0;
      aggregated.totalCost += session.totalCost || 0;
      aggregated.activeTimeCLI += session.activeTimeCLI || 0;
      aggregated.activeTimePlanning += session.activeTimePlanning || 0;
      aggregated.activeTimeUser += session.activeTimeUser || 0;
      aggregated.linesOfCode += session.linesOfCode || 0;
      aggregated.commandsBlocked += session.commandsBlocked || 0;
      aggregated.gitFailures += session.gitFailures || 0;
      aggregated.filesModified += session.filesModified || 0;
      aggregated.toolCalls += session.toolCalls || 0;
      aggregated.commonModeCount += session.commonModeCount || 0;

      // Merge byModel
      if (session.byModel) {
        Object.entries(session.byModel).forEach(([model, data]) => {
          if (!aggregated.byModel[model]) {
            aggregated.byModel[model] = {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              cost: 0
            };
          }
          aggregated.byModel[model].inputTokens += data.inputTokens || 0;
          aggregated.byModel[model].outputTokens += data.outputTokens || 0;
          aggregated.byModel[model].cacheReadTokens += data.cacheReadTokens || 0;
          aggregated.byModel[model].cacheCreationTokens += data.cacheCreationTokens || 0;
          aggregated.byModel[model].cost += data.cost || 0;
        });
      }
    });

    await r.db('metrics').table('aggregated_stats')
      .get('current')
      .replace(Object.assign({ id: 'current' }, aggregated))
      .run(dbConnection);

    console.log(`  ✅ Recalculated from sessions:`);
    console.log(`     Session Count: ${aggregated.sessionCount}`);
    console.log(`     Common Mode Count: ${aggregated.commonModeCount}`);
    console.log(`     Total Cost: $${aggregated.totalCost.toFixed(2)}`);
    console.log(`     Input Tokens: ${(aggregated.inputTokens / 1000).toFixed(1)}K`);
    console.log(`     Output Tokens: ${(aggregated.outputTokens / 1000).toFixed(1)}K`);
    console.log(`     Lines of Code: ${aggregated.linesOfCode}`);
  } catch (err) {
    console.error('❌ Error recalculating from sessions:', err);
  }
}

// Session changefeed tracker and cache
let sessionChangefeed = null;
const activeSessions = new Map(); // Cache of active sessions

// Metric changefeeds and caches
let aggregatedChangefeed = null;
let bucketChangefeed = null;
const metricBucketsCache = new Map(); // Cache of metric buckets (bucketTime -> bucket data)
let aggregatedStatsCache = null; // Cache of aggregated stats (single document)

async function startSessionChangefeed() {
  try {
    console.log('🔄 Starting session changefeed...');

    sessionChangefeed = await r.db('metrics')
      .table('sessions')
      .filter(function(session) {
        // Only stream sessions active in last 5 minutes (300000 ms)
        return session('lastSeen').gt(r.now().toEpochTime().mul(1000).sub(300000));
      })
      .changes({
        includeInitial: true,    // Send snapshot on connect
        includeTypes: true,      // Include change type
        squash: 2                // Squash rapid updates (2 sec window)
      })
      .run(dbConnection);

    console.log('✅ Session changefeed started');

    // Process changefeed events
    sessionChangefeed.each((err, change) => {
      if (err) {
        console.error('❌ Changefeed error:', err);
        // Try to reconnect after 5 seconds
        setTimeout(() => {
          console.log('🔄 Reconnecting session changefeed...');
          startSessionChangefeed();
        }, 5000);
        return;
      }

      // Broadcast to WebSocket clients
      console.log('📡 Broadcasting session change, type:', change.type);
      broadcastSessionUpdate(change);
    });

  } catch (error) {
    console.error('❌ Failed to start session changefeed:', error);
    // Retry after 5 seconds
    setTimeout(() => {
      console.log('🔄 Retrying session changefeed startup...');
      startSessionChangefeed();
    }, 5000);
  }
}

// Metrics changefeed functions
function formatAggregatedData(stats) {
  if (!stats) return null;

  // Format active times with units (same as formatMinutes helper)
  const formatTime = (seconds) => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    return `${(seconds / 60).toFixed(1)}m`;
  };

  return {
    sessionCount: stats.sessionCount || 0,
    commonModeCount: stats.commonModeCount || 0,
    inputTokens: stats.inputTokens || 0,
    outputTokens: stats.outputTokens || 0,
    cacheReadTokens: stats.cacheReadTokens || 0,
    cacheCreationTokens: stats.cacheCreationTokens || 0,
    totalCost: stats.totalCost || 0,
    activeTimeCLI: formatTime(stats.activeTimeCLI || 0),
    activeTimePlanning: formatTime(stats.activeTimePlanning || 0),
    activeTimeUser: formatTime(stats.activeTimeUser || 0),
    linesOfCode: stats.linesOfCode || 0,
    commandsBlocked: stats.commandsBlocked || 0,
    gitFailures: stats.gitFailures || 0,
    filesModified: stats.filesModified || 0,
    toolCalls: stats.toolCalls || 0,
    byModel: stats.byModel || {},
    lastUpdated: stats.lastUpdated || Date.now()
  };
}

function formatBucketData(bucket) {
  if (!bucket) return null;

  return {
    bucketTime: bucket.bucketTime,
    bucketSize: bucket.bucketSize || '1min',
    inputTokens: bucket.inputTokens || 0,
    outputTokens: bucket.outputTokens || 0,
    cacheReadTokens: bucket.cacheReadTokens || 0,
    cacheCreationTokens: bucket.cacheCreationTokens || 0,
    totalCost: bucket.totalCost || 0,
    activeTimeCLI: bucket.activeTimeCLI || 0,
    activeTimePlanning: bucket.activeTimePlanning || 0,
    activeTimeUser: bucket.activeTimeUser || 0,
    linesOfCode: bucket.linesOfCode || 0,
    commandsBlocked: bucket.commandsBlocked || 0,
    gitFailures: bucket.gitFailures || 0,
    filesModified: bucket.filesModified || 0,
    toolCalls: bucket.toolCalls || 0,
    byModel: bucket.byModel || {},
    lastUpdated: bucket.lastUpdated || Date.now()
  };
}

function broadcastAggregatedUpdate(change) {
  if (!change || !change.new_val) return;

  console.log('📡 Broadcasting aggregated update');

  const formattedData = formatAggregatedData(change.new_val);

  // Update cache
  aggregatedStatsCache = formattedData;

  const message = {
    type: 'aggregated_update',
    timestamp: Date.now(),
    data: formattedData
  };

  // Broadcast to all connected clients
  const messageStr = JSON.stringify(message);
  connectedClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageStr);
      } catch (error) {
        console.error('Error broadcasting aggregated update:', error);
        connectedClients.delete(client);
      }
    }
  });
}

function broadcastBucketUpdate(change) {
  if (!change) return;

  let message;

  if (change.type === 'initial') {
    // Initial snapshot - send as snapshot message and update cache
    const formattedBucket = formatBucketData(change.new_val);
    metricBucketsCache.set(change.new_val.bucketTime, formattedBucket);

    console.log('📡 Broadcasting bucket snapshot (initial)');
    message = {
      type: 'buckets_snapshot',
      timestamp: Date.now(),
      data: [formattedBucket]
    };
  } else if (change.type === 'add' || change.type === 'change') {
    // Bucket added or updated - update cache
    const formattedBucket = formatBucketData(change.new_val);
    metricBucketsCache.set(change.new_val.bucketTime, formattedBucket);

    console.log(`📡 Broadcasting bucket update, type: ${change.type}`);
    message = {
      type: 'bucket_update',
      action: change.type,
      timestamp: Date.now(),
      data: formattedBucket
    };
  } else if (change.type === 'remove') {
    // Bucket removed (aged out) - remove from cache
    metricBucketsCache.delete(change.old_val.bucketTime);

    console.log('📡 Broadcasting bucket remove');
    message = {
      type: 'bucket_update',
      action: 'remove',
      timestamp: Date.now(),
      data: { bucketTime: change.old_val.bucketTime }
    };
  }

  if (!message) return;

  // Broadcast to all connected clients
  const messageStr = JSON.stringify(message);
  connectedClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageStr);
      } catch (error) {
        console.error('Error broadcasting bucket update:', error);
        connectedClients.delete(client);
      }
    }
  });
}

async function startAggregatedChangefeed() {
  try {
    console.log('🔄 Starting aggregated stats changefeed...');

    aggregatedChangefeed = await r.db('metrics')
      .table('aggregated_stats')
      .get('current')
      .changes({
        includeInitial: true,
        squash: 1  // 1-second squash window
      })
      .run(dbConnection);

    console.log('✅ Aggregated stats changefeed started');

    // Process changefeed events
    aggregatedChangefeed.each((err, change) => {
      if (err) {
        console.error('❌ Aggregated changefeed error:', err);
        setTimeout(() => {
          console.log('🔄 Reconnecting aggregated changefeed...');
          startAggregatedChangefeed();
        }, 5000);
        return;
      }

      broadcastAggregatedUpdate(change);
    });

  } catch (error) {
    console.error('❌ Failed to start aggregated changefeed:', error);
    setTimeout(() => {
      console.log('🔄 Retrying aggregated changefeed startup...');
      startAggregatedChangefeed();
    }, 5000);
  }
}

async function startBucketChangefeed() {
  try {
    console.log('🔄 Starting bucket changefeed...');

    const MAX_TIMEFRAME = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

    bucketChangefeed = await r.db('metrics')
      .table('metric_buckets')
      .filter(function(bucket) {
        // Only stream buckets from last 30 days
        return bucket('bucketTime').ge(r.now().toEpochTime().mul(1000).sub(MAX_TIMEFRAME));
      })
      .changes({
        includeInitial: true,
        includeTypes: true,
        squash: 2  // 2-second squash window
      })
      .run(dbConnection);

    console.log('✅ Bucket changefeed started');

    // Process changefeed events
    bucketChangefeed.each((err, change) => {
      if (err) {
        console.error('❌ Bucket changefeed error:', err);
        setTimeout(() => {
          console.log('🔄 Reconnecting bucket changefeed...');
          startBucketChangefeed();
        }, 5000);
        return;
      }

      broadcastBucketUpdate(change);
    });

  } catch (error) {
    console.error('❌ Failed to start bucket changefeed:', error);
    setTimeout(() => {
      console.log('🔄 Retrying bucket changefeed startup...');
      startBucketChangefeed();
    }, 5000);
  }
}

async function startMetricChangefeeds() {
  await Promise.all([
    startAggregatedChangefeed(),
    startBucketChangefeed()
  ]);
}

// Start combined server (OTLP receiver + Dashboard on port 4318)
async function startServer() {
  try {
    // Initialize RethinkDB connection
    await initializeDatabase();

    // Load recent data from database
    await loadRecentDataFromDB();

    // Recalculate aggregated stats to ensure "All Time" data is accurate
    await recalculateAggregatedStatsFromSessions();

    // Start session changefeed for real-time streaming
    await startSessionChangefeed();

    // Start metrics changefeeds for real-time metric streaming
    await startMetricChangefeeds();

    // Start the server
    server.listen(OTLP_PORT, () => {
      console.log('\n🚀 Claude Code Metrics Dashboard Started!\n');
      console.log(`📡 OTLP Receiver:  http://localhost:${OTLP_PORT}`);
      console.log(`📊 Dashboard:      http://localhost:${OTLP_PORT}`);
      console.log(`🔌 WebSocket:      ws://localhost:${OTLP_PORT}`);
      console.log('\n⚙️  Configure Claude Code with:');
      console.log('   export CLAUDE_CODE_ENABLE_TELEMETRY=1');
      console.log('   export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318');
      console.log('   export OTEL_EXPORTER_OTLP_PROTOCOL=http/json');
      console.log('   export OTEL_METRICS_EXPORTER=otlp');
      console.log('   export OTEL_LOGS_EXPORTER=otlp');
      console.log('\n✅ Ready to receive telemetry data!');
      console.log(`🌐 Open dashboard: http://localhost:${OTLP_PORT}\n`);

      // Check for daily/weekly resets every hour
      setInterval(() => {
        checkAndResetStats();
      }, 3600000); // 1 hour
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Start the server
startServer();
