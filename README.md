# Claude Code Metrics Dashboard

A lightweight Node.js dashboard for monitoring Claude Code usage metrics via OpenTelemetry.

## Features

- **Real-time Monitoring**: Live token usage, cost tracking, and session metrics
- **Graphical Visualizations**: Interactive charts powered by Chart.js
- **Event Logging**: Track user prompts, tool results, API requests, and errors
- **Persistent Storage**: RethinkDB with WebSocket connections for real-time data sync
- **Hybrid Architecture**: In-memory caching + persistent database storage
- **Dark Theme**: Easy on the eyes for extended monitoring sessions

## Prerequisites

- Node.js 14 or higher
- npm or yarn
- RethinkDB (for persistent data storage via WebSocket)

## Installation

### 1. Install RethinkDB

RethinkDB is used for persistent storage with WebSocket connections.

**On macOS:**
```bash
brew install rethinkdb
```

**On Ubuntu/Debian:**
```bash
source /etc/lsb-release && echo "deb https://download.rethinkdb.com/repository/ubuntu-$DISTRIB_CODENAME $DISTRIB_CODENAME main" | sudo tee /etc/apt/sources.list.d/rethinkdb.list
wget -qO- https://download.rethinkdb.com/repository/raw/pubkey.gpg | sudo apt-key add -
sudo apt-get update
sudo apt-get install rethinkdb
```

**Using Docker:**
```bash
docker run -d --name rethinkdb -p 28015:28015 -p 8080:8080 rethinkdb
```

For other platforms, see: https://rethinkdb.com/docs/install/

### 2. Start RethinkDB

```bash
rethinkdb
```

Or with Docker:
```bash
docker start rethinkdb
```

RethinkDB will start on:
- Port 28015: Client driver port (WebSocket)
- Port 8080: Admin UI (optional)

### 3. Install Node.js dependencies

```bash
npm install
```

### 4. Migrate Existing Data (Optional)

If you have existing data from the SQLite version, you can migrate it to RethinkDB:

```bash
npm run migrate
```

This will:
- Connect to your SQLite database (`./metrics.db`)
- Read all metrics and events
- Insert them into RethinkDB
- Preserve all historical data

**Note:** Make sure RethinkDB is running before running the migration.

## Running the Dashboard

1. Start the server:
```bash
npm start
```

You should see:
```
🚀 Claude Code Metrics Dashboard Started!

📡 OTLP Receiver:  http://localhost:4318
📊 Dashboard:      http://localhost:3000
```

2. Open your browser to [http://localhost:3000](http://localhost:3000)

## Configure Claude Code

Before using Claude Code, configure it to send telemetry data:

### On Linux/Mac:
```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
```

### On Windows (PowerShell):
```powershell
$env:CLAUDE_CODE_ENABLE_TELEMETRY=1
$env:OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
$env:OTEL_EXPORTER_OTLP_PROTOCOL="http/json"
$env:OTEL_METRICS_EXPORTER="otlp"
$env:OTEL_LOGS_EXPORTER="otlp"
```

### On Windows (CMD):
```cmd
set CLAUDE_CODE_ENABLE_TELEMETRY=1
set OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
set OTEL_EXPORTER_OTLP_PROTOCOL=http/json
set OTEL_METRICS_EXPORTER=otlp
set OTEL_LOGS_EXPORTER=otlp
```

## Usage

1. Start the dashboard (as shown above)
2. Configure Claude Code environment variables
3. Run Claude Code normally
4. Watch metrics appear in real-time on the dashboard

## Dashboard Features

### Stats Cards
- **Total Tokens**: Cumulative token usage across all sessions
- **Total Cost**: Cumulative cost in USD
- **Sessions**: Number of Claude Code sessions
- **Events**: Total number of logged events

### Charts
- **Token Usage Over Time**: Line chart showing token consumption
- **Cost Tracking**: Line chart displaying cost accumulation

### Events Log
- Real-time feed of Claude Code events
- Includes user prompts, tool results, API requests, and errors
- Timestamped and color-coded

## Architecture

```
Claude Code → OpenTelemetry → OTLP Receiver (Port 4318)
                                    ↓
                        In-Memory + RethinkDB (WebSocket)
                                    ↓
                            Dashboard API (Port 4318)
                                    ↓
                            Web Dashboard (Chart.js)
```

**Database Connection:**
- RethinkDB uses WebSocket connections by default (port 28015)
- Provides real-time data synchronization
- Persistent storage survives server restarts

## Port Configuration

- **Port 4318**: OTLP receiver endpoint (OpenTelemetry standard)
- **Port 3000**: Dashboard web interface

To change ports, edit `server.js`:
```javascript
const OTLP_PORT = 4318;
const DASHBOARD_PORT = 3000;
```

## Data Storage

The dashboard uses a hybrid storage approach:

1. **In-Memory Storage**: Recent metrics and events are cached in memory for fast access
   - Last 1000 metrics
   - Last 500 events
   - Aggregated statistics

2. **RethinkDB Persistent Storage**: All data is automatically saved to RethinkDB
   - WebSocket connection for real-time updates
   - Data survives server restarts
   - Automatic schema initialization on first run

### Environment Variables

You can customize the RethinkDB connection:

```bash
export RETHINKDB_HOST=localhost  # Default: localhost
export RETHINKDB_PORT=28015      # Default: 28015
```

## Troubleshooting

### RethinkDB connection errors
- Verify RethinkDB is running: `ps aux | grep rethinkdb`
- Check RethinkDB is listening on port 28015
- If using Docker: `docker ps | grep rethinkdb`
- Try connecting manually: `rethinkdb --bind all` (allows remote connections)

### No data appearing in dashboard
- Verify Claude Code is configured with correct environment variables
- Check that `CLAUDE_CODE_ENABLE_TELEMETRY=1` is set
- Ensure the OTLP endpoint is `http://localhost:4318`
- Check server console for incoming requests
- Verify RethinkDB connection is successful (check server startup logs)

### Migration fails
- Ensure `metrics.db` exists in the project directory
- Verify RethinkDB is running before running migration
- Check that you have write permissions to the RethinkDB data directory

### Port already in use
- Change ports in `server.js` if 4318 is occupied
- Update Claude Code's `OTEL_EXPORTER_OTLP_ENDPOINT` accordingly
- RethinkDB default port (28015) can be changed with `--driver-port`

### Dashboard not updating
- Check browser console for errors
- Verify server is running and connected to RethinkDB
- Try refreshing the browser
- Check RethinkDB admin UI (http://localhost:8080) for data

## References

- [Claude Code Monitoring Documentation](https://code.claude.com/docs/en/monitoring-usage)
- [OpenTelemetry Protocol](https://opentelemetry.io/docs/specs/otlp/)
- [Chart.js Documentation](https://www.chartjs.org/)
- [RethinkDB Documentation](https://rethinkdb.com/docs/)
- [RethinkDB WebSocket Support](https://rethinkdb.com/docs/troubleshooting/#my-insert-queries-are-slow-or-slow-down-when-i-insert-a-lot-of-documents)

## License

MIT
