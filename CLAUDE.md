# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code Metrics Dashboard is a Node.js application that monitors Claude Code usage via OpenTelemetry Protocol (OTLP). It receives telemetry data from Claude Code, stores it in RethinkDB, and displays real-time metrics through a web dashboard.

## Essential Commands

### Development
```bash
npm start                # Start the dashboard server
npm run dev             # Same as start (alias)
npm run debug           # Start with DEBUG=true for verbose logging
npm run recalc-stats    # Recalculate aggregated stats from sessions
```

### Database Setup
```bash
npm run setup           # Initialize RethinkDB database schema
                        # (Runs automatically on first server start)
```

**Note:** Database setup happens automatically when you first start the server. The `npm run setup` command is useful for:
- Manual initialization before starting the server
- Troubleshooting database issues
- CI/CD pipelines
- Verifying database connectivity

### Testing
Test the OTLP endpoint manually:
```bash
curl http://localhost:4318/api/debug/metrics              # View raw metrics
curl http://localhost:4318/api/debug/stats-comparison    # Compare session totals vs aggregated stats
```

### Database
```bash
rethinkdb                                # Start RethinkDB server
docker run -d --name rethinkdb \        # Run RethinkDB in Docker
  -p 28015:28015 -p 8080:8080 rethinkdb
```

## Architecture

### Data Flow
```
Claude Code (with CLAUDE_CODE_ENABLE_TELEMETRY=1)
    ↓ OTLP/HTTP (JSON)
Server.js (Port 4318) - OTLP Receiver
    ↓
Three parallel data paths:
    ├─→ saveMetricToDB()        → RethinkDB metrics table (raw OTLP data)
    ├─→ upsertSession()         → RethinkDB sessions table (per-session aggregates)
    ├─→ updateMetricBucket()    → RethinkDB metric_buckets table (time-bucketed data)
    └─→ updateAggregatedStats() → RethinkDB aggregated_stats table (all-time totals)
    ↓
In-Memory Cache (last 1000 metrics, last 500 events)
    ↓
Dashboard API (Port 3000) + WebSocket for real-time updates
    ↓
Web Dashboard (Chart.js + vanilla JS)
```

### Hybrid Storage Model

The application uses a dual storage strategy:

1. **In-Memory Cache** (`storage` object in server.js:248-318):
   - Last 1000 metrics
   - Last 500 events
   - Current session stats (resets on server restart)
   - Daily/weekly stats with automatic reset
   - Usage limits configuration

2. **RethinkDB Persistent Storage**:
   - `metrics` table: All raw OTLP metric data points
   - `events` table: Event logs (user prompts, tool results, errors)
   - `sessions` table: Per-session aggregated statistics (indexed by sessionId)
   - `metric_buckets` table: Time-bucketed metrics for historical queries
   - `aggregated_stats` table: Single record ('current') with all-time totals

### Database Schema

**Important:** The `sessions` table is the source of truth for historical aggregates. On server startup, `recalculateAggregatedStatsFromSessions()` rebuilds the `aggregated_stats` table from `sessions` data.

### OTLP Metric Names

CRITICAL: Metric names must exactly match between OTLP payloads and database update functions. See FIX-SUMMARY.md for historical issues with metric name mismatches.

Core metric names processed:
- `claude_code.tokens.input`
- `claude_code.tokens.output`
- `claude_code.tokens.cache_read`
- `claude_code.tokens.cache_creation`
- `claude_code.hook.commands_blocked`
- `claude_code.hook.git_failures`
- `claude_code.tool.files_modified`
- `claude_code.tool.calls`
- `claude_code.active_time.cli`
- `claude_code.active_time.planning`
- `claude_code.active_time.user`
- `claude_code.lines_of_code`

### API Endpoints

**OTLP Receivers:**
- POST `/v1/metrics` - Receives OTLP metrics (JSON format)
- POST `/v1/logs` - Receives OTLP log events

**Dashboard API:**
- GET `/api/metrics?timeframe=<1h|2h|3h|6h|24h|7d|30d|all>` - Get metrics for timeframe
- GET `/api/events` - Get event log
- GET `/api/sessions` - Get all terminal sessions with aggregated stats
- GET `/api/sessions/count` - Get session count
- POST `/api/usage-limits` - Set usage limits (tokens/cost)
- POST `/api/reset-session` - Reset current session stats
- POST `/api/claude-usage` - Fetch official usage from Claude.ai (experimental)

**Debug Endpoints:**
- GET `/api/debug/metrics` - View raw metrics in memory
- GET `/api/debug/stats-comparison` - Compare session totals vs aggregated stats

### Real-Time Updates

The frontend uses RethinkDB changefeeds for real-time updates:
- `USE_CHANGEFEED_METRICS = true` enables WebSocket-based live updates
- Eliminates polling for better performance and lower latency
- See public/app.js for changefeed implementation

## Critical Implementation Details

### Metric Name Consistency
When adding new metrics or modifying existing ones:
1. Check the exact metric name sent by Claude Code's OpenTelemetry implementation
2. Update ALL three functions: `updateMetricBucket()`, `updateAggregatedStats()`, and `upsertSession()`
3. Use the exact same string in all three locations
4. Test with `/api/debug/stats-comparison` to verify aggregation accuracy

### Session Management
- Sessions are tracked by `sessionId` attribute from OTLP data
- `terminalType` attribute distinguishes different terminal types (e.g., "Browser", "VS Code")
- Each session tracks: start/end time, token usage, cost, active time, lines of code, etc.
- Sessions persist across server restarts in RethinkDB

### Cost Calculation
Cost calculation uses model-specific pricing (see `calculateCostForModel()` in server.js):
- Different rates for input/output/cache tokens
- Model name extracted from OTLP attributes
- Supports multiple Claude models (Opus, Sonnet, Haiku variants)

### Time-Bucketed Metrics
The `metric_buckets` table aggregates metrics into 1-hour windows:
- Bucket key format: `<metricName>:<bucketTime>`
- `bucketTime` is rounded to hour: `Math.floor(timestamp / 3600000) * 3600000`
- Used for historical trend analysis

## Common Pitfalls

1. **Metric Name Mismatches**: Always verify OTLP metric names match database update functions. See FIX-SUMMARY.md for a detailed example of this issue.

2. **RethinkDB Connection**: Ensure RethinkDB is running before starting the server. Connection uses WebSocket-based protocol on port 28015.

3. **Data Aggregation**: The `aggregated_stats` table is recalculated from `sessions` on startup. Don't manually edit `aggregated_stats` - it will be overwritten.

4. **WebSocket Connections**: The server uses two types of WebSocket connections:
   - RethinkDB client connection (port 28015)
   - Dashboard client WebSocket (changefeed updates)

5. **Environment Variables**: Claude Code must have `CLAUDE_CODE_ENABLE_TELEMETRY=1` and correct OTLP endpoint configured.

## Debugging Common Issues

### 1. RethinkDB Connection Failures

**Symptoms:**
- Server shows error: "❌ ERROR: Cannot connect to RethinkDB"
- Error message: "ECONNREFUSED 127.0.0.1:28015"
- Server exits with clear error message and instructions

**Diagnosis:**
```bash
# Check if RethinkDB is running
ps aux | grep rethinkdb

# For Docker:
docker ps | grep rethinkdb

# Test manual connection
telnet localhost 28015
```

**Solutions:**
1. **Start RethinkDB** (choose one method):
   ```bash
   # Option 1: Local installation
   rethinkdb

   # Option 2: Docker
   docker run -d --name rethinkdb -p 28015:28015 -p 8080:8080 rethinkdb

   # Option 3: Start existing Docker container
   docker start rethinkdb
   ```

2. **Verify database setup** (optional):
   ```bash
   npm run setup
   ```
   Note: Database setup runs automatically when you start the server, so this step is usually not needed.

3. **Check configuration**:
   - Verify RETHINKDB_HOST and RETHINKDB_PORT environment variables
   - Check firewall isn't blocking port 28015
   - Review RethinkDB logs for startup errors

**Expected Success Log:**
```
🔌 Connecting to RethinkDB at localhost:28015...
📦 Connected to RethinkDB via WebSocket (native RethinkDB protocol)
   Connection type: TCP with WebSocket-like protocol on port 28015
   Database: metrics
  ✅ Created database: metrics (or "ℹ️ Database already exists: metrics")
  ✅ Created table: metrics (or "ℹ️ Table already exists: metrics")
  ... (additional tables and indexes)
✅ Database schema initialized
```

**Improved Error Messages:**
The server now provides clear, actionable error messages when RethinkDB is not running:
- Detects connection refused (ECONNREFUSED)
- Shows exact commands to start RethinkDB
- Exits gracefully instead of crashing
- Suggests next steps to resolve the issue

### 2. No Data Appearing in Dashboard

**Symptoms:**
- Dashboard loads but shows zero metrics
- Claude Code is running but no data appears

**Diagnosis Steps:**

**Step 1: Verify Claude Code Configuration**
```bash
# Check environment variables are set
echo $CLAUDE_CODE_ENABLE_TELEMETRY  # Should be: 1
echo $OTEL_EXPORTER_OTLP_ENDPOINT   # Should be: http://localhost:4318
echo $OTEL_EXPORTER_OTLP_PROTOCOL   # Should be: http/json
```

**Step 2: Check Server is Receiving Data**
```bash
# Start server in debug mode
npm run debug

# Look for log messages like:
# 📊 Received OTLP metrics: <count> data points
# 💾 Saved metric to DB: <metric-name>
```

**Step 3: Inspect Raw Metrics**
```bash
curl http://localhost:4318/api/debug/metrics | jq
```

**Step 4: Check RethinkDB Data**
```bash
# Access RethinkDB admin UI
open http://localhost:8080

# Or query via Data Explorer:
# r.db('metrics').table('metrics').count()
# r.db('metrics').table('sessions').limit(5)
```

**Solutions:**
- Restart Claude Code with correct environment variables
- Verify OTLP endpoint is http://localhost:4318 (not https)
- Check server console for errors during metric processing
- Try `node recalc-stats.js` to rebuild aggregated stats from sessions

### 3. Metrics Aggregation Discrepancies

**Symptoms:**
- Session totals don't match aggregated stats cards
- Lines of code or cost values seem too low
- Stats reset unexpectedly

**Diagnosis:**
```bash
# Compare session totals vs aggregated stats
curl http://localhost:4318/api/debug/stats-comparison | jq

# Check for discrepancies:
# {
#   "sessionTotals": { "linesOfCode": 30600 },
#   "aggregatedStats": { "linesOfCode": 3400 },
#   "discrepancy": { "linesOfCode": 27200 }  // ❌ Problem!
# }
```

**Common Causes:**
1. **Metric Name Mismatch**: OTLP sends `claude_code.hook.commands_blocked` but code checks for `claude_code.commands.blocked`
2. **Incomplete Recalculation**: Server started before all sessions were loaded
3. **Function Collision**: Multiple functions with same name overwriting data

**Solutions:**
- Review FIX-SUMMARY.md for known metric name issues
- Run recalculation: `node recalc-stats.js`
- Search server.js for metric name usage in all three functions:
  - `updateMetricBucket()` (line ~644)
  - `updateAggregatedStats()` (line ~769)
  - `upsertSession()` (line ~1000)
- Verify exact OTLP metric name with `npm run debug`

### 4. Dashboard Not Updating in Real-Time

**Symptoms:**
- Must refresh browser to see new data
- Charts don't update automatically
- "Last updated" timestamp doesn't change

**Diagnosis:**

**Step 1: Check WebSocket Connection**
- Open browser DevTools → Network tab → WS filter
- Look for WebSocket connection to dashboard server
- Check for "Connection closed" or 401/403 errors

**Step 2: Verify Changefeed Feature Flag**
```javascript
// In public/app.js, line 6:
const USE_CHANGEFEED_METRICS = true;  // Should be true
```

**Step 3: Check Server Console**
```bash
# Look for:
# 📡 Dashboard client connected via WebSocket
# 🔔 Sending metrics update via WebSocket (changefeed)
```

**Solutions:**
- Check browser console for WebSocket errors
- Verify server is running (WebSocket requires active server)
- Clear browser cache and hard refresh (Ctrl+Shift+R)
- Disable browser extensions that may block WebSockets
- Check firewall/proxy isn't blocking WebSocket upgrade

### 5. Port Already in Use

**Symptoms:**
- "Error: listen EADDRINUSE: address already in use :::4318"
- "Error: listen EADDRINUSE: address already in use :::3000"

**Diagnosis:**
```bash
# Find process using port 4318
lsof -i :4318
netstat -anp | grep 4318  # Linux
lsof -ti:4318 | xargs kill  # Kill process

# Find process using port 3000
lsof -i :3000
```

**Solutions:**
- Kill conflicting process: `kill -9 <PID>`
- Change ports in server.js:
  ```javascript
  const OTLP_PORT = 4319;      // Changed from 4318
  const DASHBOARD_PORT = 3001;  // Changed from 3000
  ```
- Update Claude Code OTEL_EXPORTER_OTLP_ENDPOINT accordingly

### 6. Session Not Tracking Properly

**Symptoms:**
- Multiple sessions created for same Claude Code instance
- Session data splits across multiple session IDs
- Missing sessionId in terminal sessions list

**Diagnosis:**
```bash
# Check sessions in database
curl http://localhost:4318/api/sessions | jq

# Look at raw metrics to see sessionId values
curl http://localhost:4318/api/debug/metrics | jq '.[] | {name: .name, sessionId: .attributes.sessionId}'
```

**Common Causes:**
- Claude Code not sending consistent sessionId attribute
- Server restart (in-memory session tracking resets)
- Multiple Claude Code instances running simultaneously

**Solutions:**
- Sessions persist in RethinkDB across restarts (expected behavior)
- Each Claude Code instance gets unique sessionId (expected)
- Use `/api/sessions` to view all historical sessions
- Check OTLP payload includes sessionId attribute

### 7. Memory Issues with Large Datasets

**Symptoms:**
- Server becomes slow or unresponsive
- High memory usage
- Browser crashes when loading dashboard

**Diagnosis:**
```bash
# Check in-memory storage size
curl http://localhost:4318/api/debug/metrics | jq 'length'  # Should be ≤1000

# Check database size
# In RethinkDB admin UI (http://localhost:8080):
# r.db('metrics').table('metrics').count()
```

**Solutions:**
- In-memory cache automatically limits to last 1000 metrics, 500 events
- For large historical queries, use timeframe parameter:
  ```bash
  # Limit to last 24 hours
  curl http://localhost:4318/api/metrics?timeframe=24h
  ```
- Consider pruning old data from RethinkDB:
  ```javascript
  // Delete metrics older than 90 days
  r.db('metrics').table('metrics')
    .filter(r.row('timestamp').lt(Date.now() - 90*24*60*60*1000))
    .delete()
  ```

### 8. Daily/Weekly Stats Not Resetting

**Symptoms:**
- Daily stats don't reset at midnight
- Weekly stats don't reset on Monday

**Diagnosis:**
```bash
# Check current day/week start times
curl http://localhost:4318/api/metrics?timeframe=24h | jq '.dailyStats'

# Server console should show:
# 🔄 Resetting daily stats
# 🔄 Resetting weekly stats
```

**Causes:**
- Server must be running continuously for auto-reset
- Reset logic in `checkAndResetStats()` runs on each metric update
- If server is stopped overnight, reset happens on first metric after restart

**Solutions:**
- Keep server running with process manager (pm2, systemd)
- Manual reset via server restart (triggers recalculation)
- Stats stored in in-memory cache, resets expected on server restart

### 9. Cost Calculations Incorrect

**Symptoms:**
- Cost doesn't match expected Claude API pricing
- Cost is $0.00 despite token usage
- Different cost shown for same model

**Diagnosis:**
```bash
# Check which model names are being tracked
curl http://localhost:4318/api/metrics?timeframe=all | jq '.byModel'

# In debug mode, look for:
# 💰 Calculated cost for claude-sonnet-4: $X.XX
```

**Causes:**
- Model name from OTLP doesn't match pricing table in `calculateCostForModel()`
- New Claude model released without pricing update
- Model name attribute missing from OTLP payload

**Solutions:**
- Add new model pricing in server.js `calculateCostForModel()` function
- Check OTLP attributes include correct model name
- Verify pricing matches https://anthropic.com/pricing
- Run `node recalc-stats.js` after updating pricing

## Configuration

Environment variables:
- `RETHINKDB_HOST` - Default: localhost
- `RETHINKDB_PORT` - Default: 28015
- `DEBUG` - Set to 'true' for verbose logging

Ports (configured in server.js):
- `OTLP_PORT = 4318` - OTLP receiver endpoint
- `DASHBOARD_PORT = 3000` - Web dashboard

## Testing Changes

When modifying metrics processing:
1. Start server with `npm run debug` for verbose logging
2. Trigger Claude Code activity to generate OTLP data
3. Check console for incoming metrics
4. Verify data in dashboard (http://localhost:3000)
5. Use `/api/debug/stats-comparison` to verify aggregation accuracy
6. Check RethinkDB admin UI (http://localhost:8080) for database state

## Key Files

- `server.js` - Main application (OTLP receiver, API, WebSocket server, database logic)
- `public/app.js` - Dashboard frontend (Chart.js, real-time updates via changefeed)
- `public/index.html` - Dashboard HTML
- `public/styles.css` - Dashboard styles
- `recalc-stats.js` - Standalone script to recalculate aggregated stats from sessions
