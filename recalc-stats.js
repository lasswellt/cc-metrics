const { r, connect } = require('./config/database');

async function recalculate() {
  let conn;
  try {
    conn = await connect();
    
    // Get all sessions
    const sessions = await r.table('sessions').run(conn);
    const sessionsArray = await sessions.toArray();
    
    console.log(`Found ${sessionsArray.length} sessions`);
    
    // Aggregate from sessions
    let totals = {
      activeTimeCLI: 0,
      activeTimePlanning: 0,
      activeTimeUser: 0,
      linesOfCode: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalCost: 0
    };
    
    sessionsArray.forEach(session => {
      totals.activeTimeCLI += session.activeTimeCLI || 0;
      totals.activeTimePlanning += session.activeTimePlanning || 0;
      totals.activeTimeUser += session.activeTimeUser || 0;
      totals.linesOfCode += session.linesOfCode || 0;
      totals.inputTokens += session.inputTokens || 0;
      totals.outputTokens += session.outputTokens || 0;
      totals.cacheReadTokens += session.cacheReadTokens || 0;
      totals.cacheCreationTokens += session.cacheCreationTokens || 0;
      totals.totalCost += session.totalCost || 0;
    });
    
    console.log('Calculated totals from sessions:', totals);
    
    // Update aggregated_stats
    await r.table('aggregated_stats').get('current').update({
      activeTimeCLI: totals.activeTimeCLI,
      activeTimePlanning: totals.activeTimePlanning,
      activeTimeUser: totals.activeTimeUser,
      linesOfCode: totals.linesOfCode,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheCreationTokens: totals.cacheCreationTokens,
      totalCost: totals.totalCost,
      lastUpdated: Date.now()
    }).run(conn);
    
    console.log('✅ Updated aggregated_stats table');
    
    await conn.close();
  } catch (err) {
    console.error('Error:', err);
    if (conn) await conn.close();
    process.exit(1);
  }
}

recalculate();
