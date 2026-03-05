#!/bin/bash
set -e

# Wait for RethinkDB to be ready
echo "Waiting for RethinkDB to start..."
until node -e "
const r = require('rethinkdb');
r.connect({ host: 'localhost', port: 28015 })
  .then(conn => { conn.close(); process.exit(0); })
  .catch(() => process.exit(1));
" 2>/dev/null; do
  sleep 1
done
echo "RethinkDB is ready."

exec node server.js
