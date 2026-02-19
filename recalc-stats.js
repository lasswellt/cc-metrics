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
      totalCost: 0,
      pullRequests: 0,
      commits: 0,
      codeEditAccepts: 0,
      codeEditRejects: 0,
      linesAdded: 0,
      linesRemoved: 0,
      commandsBlocked: 0,
      gitFailures: 0,
      filesModified: 0,
      toolCalls: 0,
      commonModeCount: 0
    };

    const byModel = {};

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
      totals.pullRequests += session.pullRequests || 0;
      totals.commits += session.commits || 0;
      totals.codeEditAccepts += session.codeEditAccepts || 0;
      totals.codeEditRejects += session.codeEditRejects || 0;
      totals.linesAdded += session.linesAdded || 0;
      totals.linesRemoved += session.linesRemoved || 0;
      totals.commandsBlocked += session.commandsBlocked || 0;
      totals.gitFailures += session.gitFailures || 0;
      totals.filesModified += session.filesModified || 0;
      totals.toolCalls += session.toolCalls || 0;
      totals.commonModeCount += session.commonModeCount || 0;

      // Merge byModel
      if (session.byModel) {
        Object.entries(session.byModel).forEach(([model, data]) => {
          if (!byModel[model]) {
            byModel[model] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, cost: 0 };
          }
          byModel[model].inputTokens += data.inputTokens || 0;
          byModel[model].outputTokens += data.outputTokens || 0;
          byModel[model].cacheReadTokens += data.cacheReadTokens || 0;
          byModel[model].cacheCreationTokens += data.cacheCreationTokens || 0;
          byModel[model].cost += data.cost || 0;
        });
      }
    });

    console.log('Calculated totals from sessions:', totals);

    // Update aggregated_stats
    await r.table('aggregated_stats').get('current').update({
      sessionCount: sessionsArray.length,
      activeTimeCLI: totals.activeTimeCLI,
      activeTimePlanning: totals.activeTimePlanning,
      activeTimeUser: totals.activeTimeUser,
      linesOfCode: totals.linesOfCode,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheCreationTokens: totals.cacheCreationTokens,
      totalCost: totals.totalCost,
      pullRequests: totals.pullRequests,
      commits: totals.commits,
      codeEditAccepts: totals.codeEditAccepts,
      codeEditRejects: totals.codeEditRejects,
      linesAdded: totals.linesAdded,
      linesRemoved: totals.linesRemoved,
      commandsBlocked: totals.commandsBlocked,
      gitFailures: totals.gitFailures,
      filesModified: totals.filesModified,
      toolCalls: totals.toolCalls,
      commonModeCount: totals.commonModeCount,
      byModel: byModel,
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
