// localStorage keys (must be at top before any code that uses them)
const STORAGE_KEY = 'claudeSessionKey';
const POLLING_INTERVAL_KEY = 'pollingInterval';
const DATA_TIMEFRAME_KEY = 'dataTimeframe';

// Feature flag: Use RethinkDB changefeeds for metrics instead of polling
const USE_CHANGEFEED_METRICS = true;

// Chart.js configuration
const chartConfig = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            display: true,
            labels: { color: '#a0a0a0' }
        }
    },
    scales: {
        y: {
            beginAtZero: true,
            ticks: { color: '#a0a0a0' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' }
        },
        x: {
            ticks: { color: '#a0a0a0' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' }
        }
    }
};

// Initialize pie chart config
const pieConfig = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            display: true,
            position: 'right',
            labels: { color: '#a0a0a0', padding: 10 }
        }
    }
};

// Initialize charts
const tokensByTypeChart = new Chart(document.getElementById('tokens-by-type-chart'), {
    type: 'doughnut',
    data: {
        labels: ['Input', 'Output', 'Cache Read', 'Cache Creation'],
        datasets: [{
            data: [0, 0, 0, 0],
            backgroundColor: [
                'rgba(33, 150, 243, 0.8)',
                'rgba(76, 175, 80, 0.8)',
                'rgba(255, 193, 7, 0.8)',
                'rgba(156, 39, 176, 0.8)'
            ],
            borderColor: [
                'rgb(33, 150, 243)',
                'rgb(76, 175, 80)',
                'rgb(255, 193, 7)',
                'rgb(156, 39, 176)'
            ],
            borderWidth: 2
        }]
    },
    options: pieConfig
});

const tokensByModelChart = new Chart(document.getElementById('tokens-by-model-chart'), {
    type: 'doughnut',
    data: {
        labels: [],
        datasets: [{
            data: [],
            backgroundColor: [],
            borderWidth: 2
        }]
    },
    options: pieConfig
});

const timeDistributionChart = new Chart(document.getElementById('time-distribution-chart'), {
    type: 'doughnut',
    data: {
        labels: ['CLI', 'Planning', 'User'],
        datasets: [{
            data: [0, 0, 0],
            backgroundColor: [
                'rgba(33, 150, 243, 0.8)',
                'rgba(156, 39, 176, 0.8)',
                'rgba(255, 152, 0, 0.8)'
            ],
            borderColor: [
                'rgb(33, 150, 243)',
                'rgb(156, 39, 176)',
                'rgb(255, 152, 0)'
            ],
            borderWidth: 2
        }]
    },
    options: pieConfig
});

const tokenUsageTimeline = new Chart(document.getElementById('token-usage-timeline'), {
    type: 'line',
    data: {
        datasets: [
            {
                label: 'Input',
                data: [],
                borderColor: 'rgb(33, 150, 243)',
                backgroundColor: 'rgba(33, 150, 243, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true
            },
            {
                label: 'Output',
                data: [],
                borderColor: 'rgb(76, 175, 80)',
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true
            },
            {
                label: 'Cache Read',
                data: [],
                borderColor: 'rgb(255, 193, 7)',
                backgroundColor: 'rgba(255, 193, 7, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true
            },
            {
                label: 'Cache Creation',
                data: [],
                borderColor: 'rgb(156, 39, 176)',
                backgroundColor: 'rgba(156, 39, 176, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true
            }
        ]
    },
    options: {
        ...chartConfig,
        scales: {
            ...chartConfig.scales,
            x: {
                ...chartConfig.scales.x,
                type: 'time',
                time: {
                    unit: 'minute',
                    displayFormats: {
                        minute: 'HH:mm',
                        hour: 'HH:mm'
                    },
                    tooltipFormat: 'MMM d, HH:mm:ss'
                },
                ticks: {
                    ...chartConfig.scales.x.ticks,
                    maxRotation: 45,
                    minRotation: 45
                }
            }
        },
        plugins: {
            legend: {
                display: true,
                position: 'top',
                labels: { color: '#a0a0a0' }
            }
        }
    }
});

const costTimeline = new Chart(document.getElementById('cost-timeline'), {
    type: 'line',
    data: {
        datasets: [{
            label: 'Cost ($)',
            data: [],
            borderColor: '#ff9800',
            backgroundColor: 'rgba(255, 152, 0, 0.1)',
            borderWidth: 2,
            tension: 0.4,
            fill: true
        }]
    },
    options: {
        ...chartConfig,
        scales: {
            ...chartConfig.scales,
            x: {
                ...chartConfig.scales.x,
                type: 'time',
                time: {
                    unit: 'minute',
                    displayFormats: {
                        minute: 'HH:mm',
                        hour: 'HH:mm'
                    },
                    tooltipFormat: 'MMM d, HH:mm:ss'
                },
                ticks: {
                    ...chartConfig.scales.x.ticks,
                    maxRotation: 45,
                    minRotation: 45
                }
            }
        }
    }
});

// ============================================================================
// Claude.ai Usage Sparklines
// ============================================================================

const claudeUsageSparklines = {
    fiveHour: null,
    sevenDay: null,
    sonnet: null
};

function createUsageSparkline(canvasId, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.warn(`Canvas element ${canvasId} not found`);
        return null;
    }

    // Extract RGB from hex color and create transparent background
    const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    };

    const rgb = hexToRgb(color);

    // Create gradient that fills from bottom to top
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)` : 'rgba(76, 175, 80, 0.3)');
    gradient.addColorStop(1, rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.05)` : 'rgba(76, 175, 80, 0.05)');

    return new Chart(canvas, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                data: [],
                borderColor: color,
                backgroundColor: gradient,
                borderWidth: 2.5,
                pointRadius: 0,
                tension: 0.3,
                fill: 'origin'
            }]
        },
        options: {
            responsive: false,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false },
                filler: {
                    propagate: false
                }
            },
            scales: {
                x: {
                    display: false,
                    grid: { display: false }
                },
                y: {
                    display: false,
                    min: 0,
                    max: 100,
                    beginAtZero: true,
                    grace: 0,
                    grid: { display: false }
                }
            },
            layout: {
                padding: 0
            }
        }
    });
}

// Initialize Claude.ai usage sparklines (will be created after DOM is ready)
function initializeClaudeSparklines() {
    claudeUsageSparklines.fiveHour = createUsageSparkline('five-hour-sparkline', '#4caf50');
    claudeUsageSparklines.sevenDay = createUsageSparkline('seven-day-sparkline', '#2196f3');
    claudeUsageSparklines.sonnet = createUsageSparkline('sonnet-sparkline', '#ff9800');
}

// Format number with K/M suffix
function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    // For small numbers, round to 2 decimals if they have decimals
    if (num % 1 !== 0) {
        return num.toFixed(2);
    }
    return num.toString();
}

// Format model name to be more readable
function formatModelName(modelFullName) {
    if (!modelFullName) return 'Unknown';
    
    // Extract model name from full version string
    // e.g., "claude-sonnet-4-5-20250929" -> "Sonnet 4.5"
    // e.g., "claude-haiku-4-0-20250101" -> "Haiku 4.0"
    
    if (modelFullName.includes('sonnet')) {
        const match = modelFullName.match(/sonnet-(\d+)-(\d+)/);
        if (match) return `Sonnet ${match[1]}.${match[2]}`;
        return 'Sonnet';
    }
    
    if (modelFullName.includes('haiku')) {
        const match = modelFullName.match(/haiku-(\d+)-(\d+)/);
        if (match) return `Haiku ${match[1]}.${match[2]}`;
        return 'Haiku';
    }
    
    if (modelFullName.includes('opus')) {
        const match = modelFullName.match(/opus-(\d+)-(\d+)/);
        if (match) return `Opus ${match[1]}.${match[2]}`;
        return 'Opus';
    }
    
    // Fallback: return last 2 parts or shortened version
    const parts = modelFullName.split('-');
    if (parts.length >= 2) {
        return parts.slice(1, 3).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    }
    
    return modelFullName;
}

// Format timestamp
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Format relative time
function formatRelativeTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 1000) return 'just now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
}

// Generate random color for models
function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = hash % 360;
    return `hsla(${h}, 70%, 60%, 0.8)`;
}

// Update all stats
function updateStats(data) {
    // Main stats
    document.getElementById('session-count').textContent = data.sessionCount;
    document.getElementById('common-mode').textContent = data.commonModeCount;
    
    // Active times - display formatted string from backend (already includes units like "5.0m" or "30.2s")
    document.getElementById('active-time-cli').textContent = data.activeTimeCLI || '0s';
    document.getElementById('active-time-planning').textContent = data.activeTimePlanning || '0s';
    
    // Cost - round to 2 decimals
    document.getElementById('total-cost').textContent = `$${parseFloat(data.totalCost || 0).toFixed(2)}`;
    document.getElementById('lines-of-code').textContent = formatNumber(data.linesOfCode || 0);

    // Token stats
    document.getElementById('input-tokens').textContent = formatNumber(data.inputTokens || 0);
    document.getElementById('output-tokens').textContent = formatNumber(data.outputTokens || 0);
    document.getElementById('cache-read').textContent = formatNumber(data.cacheReadTokens || 0);
    document.getElementById('cache-creation').textContent = formatNumber(data.cacheCreationTokens || 0);
    
    // Cache efficiency - round to 2 decimals
    const cacheEfficiency = parseFloat(data.cacheEfficiency) || 0;
    document.getElementById('cache-efficiency').textContent = `${cacheEfficiency.toFixed(2)}%`;
    
    // Cost per 1k - round to 2 decimals
    const costPer1k = parseFloat(data.costPer1kOutput) || 0;
    document.getElementById('cost-per-1k').textContent = `$${costPer1k.toFixed(2)}`;

    // Productivity - already uses formatNumber which now handles rounding
    document.getElementById('productivity-ratio').textContent = formatNumber(data.productivityRatio || 0);
}

// Update tokens by type pie chart
function updateTokensByType(data) {
    const total = data.inputTokens + data.outputTokens + data.cacheReadTokens + data.cacheCreationTokens;
    if (total === 0) return;

    tokensByTypeChart.data.datasets[0].data = [
        data.inputTokens,
        data.outputTokens,
        data.cacheReadTokens,
        data.cacheCreationTokens
    ];
    tokensByTypeChart.update('none');
}

// Update tokens by model pie chart
function updateTokensByModel(byModel) {
    const models = Object.keys(byModel);
    if (models.length === 0) return;

    const labels = [];
    const data = [];
    const colors = [];

    models.forEach(model => {
        const totalTokens = byModel[model].inputTokens +
                          byModel[model].outputTokens +
                          byModel[model].cacheReadTokens +
                          byModel[model].cacheCreationTokens;
        if (totalTokens > 0) {
            labels.push(formatModelName(model));
            data.push(totalTokens);
            colors.push(stringToColor(model));
        }
    });

    tokensByModelChart.data.labels = labels;
    tokensByModelChart.data.datasets[0].data = data;
    tokensByModelChart.data.datasets[0].backgroundColor = colors;
    tokensByModelChart.update('none');
}

// Update cost by model list
function updateCostByModel(byModel) {
    const costList = document.getElementById('cost-by-model');
    const models = Object.keys(byModel).filter(m => byModel[m].cost > 0);

    if (models.length === 0) {
        costList.innerHTML = '<div class="no-data">No cost data yet</div>';
        return;
    }

    // Sort by cost descending
    models.sort((a, b) => byModel[b].cost - byModel[a].cost);

    costList.innerHTML = models.map(model => `
        <div class="cost-item">
            <span class="model-name">${formatModelName(model)}</span>
            <span class="model-cost">$${byModel[model].cost.toFixed(2)}</span>
        </div>
    `).join('');
}

// Update time distribution chart
function updateTimeDistribution(data) {
    // Parse time strings (e.g., "19.7m" or "45.2s") back to seconds for comparison
    const parseTime = (timeStr) => {
        if (!timeStr) return 0;
        if (timeStr.endsWith('m')) return parseFloat(timeStr) * 60;
        if (timeStr.endsWith('s')) return parseFloat(timeStr);
        return 0;
    };

    const cliTime = parseTime(data.activeTimeCLI);
    const planningTime = parseTime(data.activeTimePlanning);
    const userTime = parseTime(data.activeTimeUser);

    const total = cliTime + planningTime + userTime;
    if (total === 0) return;

    timeDistributionChart.data.datasets[0].data = [cliTime, planningTime, userTime];
    timeDistributionChart.update('none');
}

// Update token usage timeline
function updateTokenUsageTimeline(history) {
    if (history.length === 0) return;

    // Set explicit time bounds based on current timeframe
    const now = Date.now();
    const timeframe = loadDataTimeframe();
    const timeframes = {
        '1h': 60 * 60 * 1000,
        '2h': 2 * 60 * 60 * 1000,
        '3h': 3 * 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000
    };

    // Prepare data with zero boundary points
    const prepareDataWithZeros = (dataPoints) => {
        if (dataPoints.length === 0) return [];

        const result = [...dataPoints];

        // Add zero at the start if needed
        if (timeframe !== 'all' && timeframes[timeframe]) {
            const minTime = now - timeframes[timeframe];
            if (dataPoints[0].x > minTime) {
                result.unshift({ x: minTime, y: 0 });
            }

            // Add zero at the end if needed
            if (dataPoints[dataPoints.length - 1].x < now) {
                result.push({ x: now, y: 0 });
            }
        }

        return result;
    };

    // Use actual timestamps for x-axis (not formatted labels)
    // This allows Chart.js time scale to work properly
    const inputData = history.map(h => ({ x: h.time, y: h.input }));
    const outputData = history.map(h => ({ x: h.time, y: h.output }));
    const cacheReadData = history.map(h => ({ x: h.time, y: h.cacheRead }));
    const cacheCreationData = history.map(h => ({ x: h.time, y: h.cacheCreation }));

    tokenUsageTimeline.data.datasets[0].data = prepareDataWithZeros(inputData);
    tokenUsageTimeline.data.datasets[1].data = prepareDataWithZeros(outputData);
    tokenUsageTimeline.data.datasets[2].data = prepareDataWithZeros(cacheReadData);
    tokenUsageTimeline.data.datasets[3].data = prepareDataWithZeros(cacheCreationData);

    if (timeframe !== 'all' && timeframes[timeframe]) {
        const minTime = now - timeframes[timeframe];
        tokenUsageTimeline.options.scales.x.min = minTime;
        tokenUsageTimeline.options.scales.x.max = now;
    } else {
        // For 'all' timeframe, let Chart.js auto-scale
        tokenUsageTimeline.options.scales.x.min = undefined;
        tokenUsageTimeline.options.scales.x.max = undefined;
    }

    tokenUsageTimeline.update('none');
}

// Update cost timeline
function updateCostTimeline(history) {
    if (history.length === 0) return;

    // Set explicit time bounds based on current timeframe
    const now = Date.now();
    const timeframe = loadDataTimeframe();
    const timeframes = {
        '1h': 60 * 60 * 1000,
        '2h': 2 * 60 * 60 * 1000,
        '3h': 3 * 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000
    };

    // Prepare data with zero boundary points
    const prepareDataWithZeros = (dataPoints) => {
        if (dataPoints.length === 0) return [];

        const result = [...dataPoints];

        // Add zero at the start if needed
        if (timeframe !== 'all' && timeframes[timeframe]) {
            const minTime = now - timeframes[timeframe];
            if (dataPoints[0].x > minTime) {
                result.unshift({ x: minTime, y: 0 });
            }

            // Add zero at the end if needed
            if (dataPoints[dataPoints.length - 1].x < now) {
                result.push({ x: now, y: 0 });
            }
        }

        return result;
    };

    // Use actual timestamps for x-axis (not formatted labels)
    // This allows Chart.js time scale to work properly
    const costData = history.map(h => ({ x: h.time, y: h.value }));
    costTimeline.data.datasets[0].data = prepareDataWithZeros(costData);

    if (timeframe !== 'all' && timeframes[timeframe]) {
        const minTime = now - timeframes[timeframe];
        costTimeline.options.scales.x.min = minTime;
        costTimeline.options.scales.x.max = now;
    } else {
        // For 'all' timeframe, let Chart.js auto-scale
        costTimeline.options.scales.x.min = undefined;
        costTimeline.options.scales.x.max = undefined;
    }

    costTimeline.update('none');
}

// Update events list
function updateEvents(eventsData) {
    const eventsList = document.getElementById('events-list');

    if (eventsData.events.length === 0) {
        eventsList.innerHTML = '<div class="no-data">No events yet. Start a Claude Code session to see data.</div>';
        return;
    }

    eventsList.innerHTML = eventsData.events.map((event, index) => {
        // Format attributes as lines
        const attributeLines = [];
        if (event.attributes) {
            for (const [key, value] of Object.entries(event.attributes)) {
                // Format value based on type
                let formattedValue = value;
                if (typeof value === 'number' && key.includes('cost')) {
                    formattedValue = `$${value.toFixed(4)}`;
                } else if (typeof value === 'number' && key.includes('tokens')) {
                    formattedValue = value.toLocaleString();
                } else if (typeof value === 'object') {
                    formattedValue = JSON.stringify(value);
                }
                attributeLines.push(`${key}: ${formattedValue}`);
            }
        }

        // If no attributes, use body
        if (attributeLines.length === 0) {
            attributeLines.push(event.body || 'No data');
        }

        const hasMoreThanTwoLines = attributeLines.length > 2;
        const previewLines = attributeLines.slice(0, 2);
        const remainingLines = attributeLines.slice(2);

        return `
            <div class="event-item">
                <div class="event-header">
                    <span class="event-type">${escapeHtml(event.type)}</span>
                    ${event.severity && event.severity !== 'INFO' ? `<span class="severity-badge severity-${escapeHtml(event.severity).toLowerCase()}">${escapeHtml(event.severity)}</span>` : ''}
                    <span class="event-time">${formatRelativeTime(event.timestamp)}</span>
                </div>
                <div class="event-body">
                    <div class="event-body-preview">
                        ${previewLines.map(line => `<div class="event-line">${escapeHtml(line)}</div>`).join('')}
                    </div>
                    ${hasMoreThanTwoLines ? `
                        <div class="event-body-full" style="display: none;">
                            ${remainingLines.map(line => `<div class="event-line">${escapeHtml(line)}</div>`).join('')}
                        </div>
                        <button class="event-expand-btn" onclick="toggleEventExpand(this)">
                            <span class="expand-icon">▼</span> Expand
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Toggle expand/collapse for event body
function toggleEventExpand(button) {
    const eventBody = button.closest('.event-body');
    const fullContent = eventBody.querySelector('.event-body-full');
    const icon = button.querySelector('.expand-icon');

    if (fullContent.style.display === 'none') {
        // Expand
        fullContent.style.display = 'block';
        icon.textContent = '▲';
        button.childNodes[1].textContent = ' Collapse';
    } else {
        // Collapse
        fullContent.style.display = 'none';
        icon.textContent = '▼';
        button.childNodes[1].textContent = ' Expand';
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Format session duration
function formatSessionDuration(ms) {
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

// Handle session snapshot from changefeed
function handleSessionsSnapshot(data) {
    sessionsMap.clear();
    if (Array.isArray(data)) {
        data.forEach(session => {
            if (session) sessionsMap.set(session.sessionId, session);
        });
    }
    renderSessions();
    recordWebSocketActivity();
}

// Handle session update from changefeed
function handleSessionUpdate(action, data) {
    if (action === 'add' || action === 'change') {
        if (data) sessionsMap.set(data.sessionId, data);
    } else if (action === 'remove') {
        if (data && data.sessionId) sessionsMap.delete(data.sessionId);
    }
    renderSessions();
    recordWebSocketActivity();
}

// Render terminal sessions from sessionsMap
function renderSessions() {
    const sessionsSection = document.getElementById('sessions-section');
    const sessionsList = document.getElementById('sessions-list');
    const sessionsTotal = document.getElementById('sessions-total');
    const sessionsActive = document.getElementById('sessions-active');

    const sessions = Array.from(sessionsMap.values());

    if (sessions.length === 0) {
        sessionsSection.style.display = 'none';
        return;
    }

    // Show section
    sessionsSection.style.display = 'block';

    // Calculate stats
    const activeSessions = sessions.filter(s => s.isActive).length;
    sessionsTotal.textContent = `${sessions.length} total`;
    sessionsActive.textContent = `${activeSessions} active`;

    // Sort by lastSeen (most recent first)
    sessions.sort((a, b) => b.lastSeen - a.lastSeen);

    // Render session cards with per-model breakdown
    sessionsList.innerHTML = sessions.map(session => {
        const shortId = session.sessionId.split('-')[0];
        const statusClass = session.isActive ? 'active' : '';
        const cardClass = session.isActive ? 'session-card active' : 'session-card';

        // Process and sort models by total tokens
        const modelsWithData = session.byModel && Object.keys(session.byModel).length > 0
            ? Object.entries(session.byModel)
                .filter(([model, data]) => {
                    const total = (data.inputTokens || 0) + (data.outputTokens || 0) +
                                 (data.cacheReadTokens || 0) + (data.cacheCreationTokens || 0);
                    return total > 0;
                })
                .sort((a, b) => {
                    const totalA = (a[1].inputTokens || 0) + (a[1].outputTokens || 0) +
                                  (a[1].cacheReadTokens || 0) + (a[1].cacheCreationTokens || 0);
                    const totalB = (b[1].inputTokens || 0) + (b[1].outputTokens || 0) +
                                  (b[1].cacheReadTokens || 0) + (b[1].cacheCreationTokens || 0);
                    return totalB - totalA;
                })
            : [];

        // Build model columns HTML
        const modelColumnsHtml = modelsWithData.map(([model, data]) => {
            const input = data.inputTokens || 0;
            const output = data.outputTokens || 0;
            const total = input + output + (data.cacheReadTokens || 0) + (data.cacheCreationTokens || 0);

            return `
                <div class="session-model-column">
                    <div class="model-column-header">${formatModelName(model)}</div>
                    <div class="model-column-divider"></div>
                    <div class="model-column-value">
                        ${formatNumber(input)}/${formatNumber(output)}/${formatNumber(total)}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="${cardClass}">
                <div class="session-header">
                    <div class="session-title">
                        <div class="session-status ${statusClass}"></div>
                        <div>
                            <div class="session-terminal">${session.terminalType || 'Unknown Terminal'}</div>
                            <div class="session-id">${shortId}</div>
                        </div>
                    </div>
                    <div class="session-info">
                        <span>Duration: ${formatSessionDuration(session.duration)}</span>
                        <span>Last seen: ${formatRelativeTime(session.lastSeen)}</span>
                    </div>
                </div>
                <div class="session-metrics-row">
                    ${modelColumnsHtml}
                    <div class="session-aggregate-column">
                        <div class="aggregate-column-header">Active Time</div>
                        <div class="aggregate-column-divider"></div>
                        <div class="aggregate-column-value">${session.totalActiveTime}</div>
                    </div>
                    <div class="session-aggregate-column">
                        <div class="aggregate-column-header">Lines of Code</div>
                        <div class="aggregate-column-divider"></div>
                        <div class="aggregate-column-value">${formatNumber(session.linesOfCode)}</div>
                    </div>
                    <div class="session-aggregate-column">
                        <div class="aggregate-column-header">Cost</div>
                        <div class="aggregate-column-divider"></div>
                        <div class="aggregate-column-value">$${session.totalCost}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// OLD updateSessions function - kept for backward compatibility during transition
// Old updateSessions function removed - now using renderSessions() with changefeed data

// Handle WebSocket updates - record activity and fetch data
function handleWebSocketUpdate() {
    // Record WebSocket activity on timeline
    recordWebSocketActivity();
    
    // Fetch updated data
    fetchData();
}

// Fetch and update data
async function fetchData() {
    try {
        // Get selected timeframe
        const timeframe = loadDataTimeframe();

        if (!USE_CHANGEFEED_METRICS) {
            // Polling mode - fetch metrics from API
            console.log(`📅 Fetching data for timeframe: ${timeframe}`);

            // Fetch metrics with timeframe parameter
            const metricsResponse = await fetch(`/api/metrics?timeframe=${timeframe}`);
            const metricsData = await metricsResponse.json();
            console.log(`   Received ${metricsData.recentMetrics?.length || 0} metrics, ${metricsData.totalTokens || 0} total tokens`);

            updateStats(metricsData);
            updateTokensByType(metricsData);
            updateTokensByModel(metricsData.byModel);
            updateCostByModel(metricsData.byModel);
            updateTimeDistribution(metricsData);
            updateTokenUsageTimeline(metricsData.tokensByTypeHistory);
            updateCostTimeline(metricsData.costHistory);
        }

        // Fetch events with timeframe parameter (still using polling for events)
        const eventsResponse = await fetch(`/api/events?timeframe=${timeframe}`);
        const eventsData = await eventsResponse.json();

        updateEvents(eventsData);

        // Sessions now updated via WebSocket changefeed (no polling needed)

        // Update last update time
        document.getElementById('last-update').textContent =
            `Last update: ${formatTime(Date.now())}`;

    } catch (error) {
        console.error('Error fetching data:', error);
        document.getElementById('last-update').textContent =
            'Error fetching data';
    }
}

// WebSocket connection for real-time updates
let ws = null;
let wsReconnectTimer = null;

// Session state management
const sessionsMap = new Map();

// Activity timeline tracking (2 minutes = 120000ms)
const TIMELINE_DURATION = 120000; // 2 minutes in milliseconds
let activityTimestamps = [];

// Update activity timeline
function updateActivityTimeline() {
    const now = Date.now();
    const timelineBars = document.getElementById('timeline-bars');
    
    if (!timelineBars) return;
    
    // Remove timestamps older than 2 minutes
    activityTimestamps = activityTimestamps.filter(ts => (now - ts) < TIMELINE_DURATION);
    
    // Get existing bars
    const existingBars = Array.from(timelineBars.children);
    const existingTimestamps = existingBars.map(bar => parseInt(bar.dataset.timestamp));
    
    // Remove bars for timestamps that no longer exist
    existingBars.forEach(bar => {
        const timestamp = parseInt(bar.dataset.timestamp);
        if (!activityTimestamps.includes(timestamp)) {
            bar.remove();
        }
    });
    
    // Update or create bars for each timestamp
    activityTimestamps.forEach(timestamp => {
        const age = now - timestamp;
        const position = 100 - (age / TIMELINE_DURATION * 100);
        
        let bar = existingBars.find(b => parseInt(b.dataset.timestamp) === timestamp);
        
        if (!bar) {
            // Create new bar
            bar = document.createElement('div');
            bar.className = 'timeline-bar new';
            bar.dataset.timestamp = timestamp;
            timelineBars.appendChild(bar);
            
            // Remove 'new' class after animation
            setTimeout(() => bar.classList.remove('new'), 400);
        }
        
        // Update position smoothly
        bar.style.left = `${position}%`;
        
        // Fade bars that are getting old (older than 90 seconds)
        if (age > 90000) {
            bar.classList.add('fading');
        } else {
            bar.classList.remove('fading');
        }
    });
}

// Add WebSocket activity to timeline
function recordWebSocketActivity() {
    activityTimestamps.push(Date.now());
    updateActivityTimeline();
}

// Update timeline positions every second
setInterval(updateActivityTimeline, 1000);

// Update WebSocket connection status indicator
function updateWebSocketStatus(status) {
    const statusIndicator = document.getElementById('status');
    const lastUpdate = document.getElementById('last-update');

    if (status === 'connected') {
        statusIndicator.style.background = '#4caf50';
        lastUpdate.textContent = 'Connected (WebSocket)';
    } else if (status === 'disconnected') {
        statusIndicator.style.background = '#f44336';
        lastUpdate.textContent = 'Disconnected - reconnecting...';
    }
}

// MetricsDashboard class manages real-time metric updates via changefeeds
class MetricsDashboard {
  constructor() {
    this.currentTimeframe = loadDataTimeframe();
    this.buckets = new Map();           // bucketTime -> bucket data
    this.aggregatedStats = null;         // All-time totals

    // UI update throttling
    this.updatePending = false;
    this.lastUpdate = 0;
    this.MIN_UPDATE_INTERVAL = 500;      // 500ms throttle
  }

  onMessage(message) {
    switch (message.type) {
      case 'aggregated_update':
        this.aggregatedStats = message.data;
        if (this.currentTimeframe === 'all') {
          this.scheduleUIUpdate();
        }
        break;

      case 'buckets_snapshot':
        // Initial snapshot - load all buckets
        if (Array.isArray(message.data)) {
          message.data.forEach(bucket => {
            this.buckets.set(bucket.bucketTime, bucket);
          });
        }
        // Always update UI after loading buckets for timeline charts
        this.scheduleUIUpdate();
        break;

      case 'bucket_update':
        this.handleBucketUpdate(message.action, message.data);
        break;
    }
  }

  handleBucketUpdate(action, bucketData) {
    if (!bucketData) return;

    const bucketTime = bucketData.bucketTime;

    if (action === 'remove') {
      this.buckets.delete(bucketTime);
    } else {
      // 'add', 'change', or 'initial'
      this.buckets.set(bucketTime, bucketData);
    }

    // Only update UI if bucket affects visible timeframe
    if (this.isBucketVisible(bucketTime)) {
      this.scheduleUIUpdate();
    }
  }

  isBucketVisible(bucketTime) {
    // Timeline charts always need bucket updates
    // For "all" timeframe, show all buckets
    if (this.currentTimeframe === 'all') {
      return true;
    }
    const cutoff = this.getTimeframeCutoff(this.currentTimeframe);
    return bucketTime >= cutoff;
  }

  getTimeframeCutoff(timeframe) {
    // For "all", return 0 to show all buckets from the beginning
    if (timeframe === 'all') {
      return 0;
    }
    
    const now = Date.now();
    const timeframes = {
      '1h': 60 * 60 * 1000,
      '2h': 2 * 60 * 60 * 1000,
      '3h': 3 * 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    return now - (timeframes[timeframe] || 0);
  }

  scheduleUIUpdate() {
    if (this.updatePending) return;

    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastUpdate;

    if (timeSinceLastUpdate >= this.MIN_UPDATE_INTERVAL) {
      this.performUIUpdate();
    } else {
      this.updatePending = true;
      setTimeout(() => {
        this.updatePending = false;
        this.performUIUpdate();
      }, this.MIN_UPDATE_INTERVAL - timeSinceLastUpdate);
    }
  }

  async performUIUpdate() {
    this.lastUpdate = Date.now();

    let stats;
    if (this.currentTimeframe === 'all') {
      stats = this.aggregatedStats;
    } else {
      stats = await this.calculateTimeframeStats();
    }

    if (!stats) return;

    // Calculate timeline data
    const tokensByTypeHistory = this.getTokensByTypeTimeline();
    const costHistory = this.getCostTimeline();

    // Update all UI sections
    updateStats(stats);
    updateTokensByType(stats);
    updateTokensByModel(stats.byModel);
    updateCostByModel(stats.byModel);
    updateTimeDistribution(stats);
    updateTokenUsageTimeline(tokensByTypeHistory);
    updateCostTimeline(costHistory);

    // Update last update time
    document.getElementById('last-update').textContent =
      `Last update: ${formatTime(Date.now())}`;
  }

  async calculateTimeframeStats() {
    const cutoff = this.getTimeframeCutoff(this.currentTimeframe);
    const visibleBuckets = Array.from(this.buckets.values())
      .filter(b => b.bucketTime >= cutoff)
      .sort((a, b) => a.bucketTime - b.bucketTime);

    // Fetch session count from database via API
    let sessionCount = 0;
    let commonModeCount = 0;
    
    try {
      const response = await fetch(`/api/sessions/count?timeframe=${this.currentTimeframe}`);
      const sessionData = await response.json();
      sessionCount = sessionData.sessionCount;
      commonModeCount = sessionData.commonModeCount;
    } catch (err) {
      console.error('Error fetching session count:', err);
    }
    
    // Aggregate buckets
    const aggregated = {
      sessionCount: sessionCount,
      commonModeCount: commonModeCount,
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
      byModel: {}
    };

    visibleBuckets.forEach(bucket => {
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

    // Calculate derived metrics (same as server-side logic)
    aggregated.totalTokens = aggregated.inputTokens + aggregated.outputTokens +
                             aggregated.cacheReadTokens + aggregated.cacheCreationTokens;
    aggregated.cacheTotal = aggregated.cacheReadTokens + aggregated.cacheCreationTokens;
    aggregated.cacheEfficiency = aggregated.cacheTotal > 0
      ? (aggregated.cacheReadTokens / aggregated.cacheTotal) * 100
      : 0;
    aggregated.costPer1kOutput = aggregated.outputTokens > 0
      ? (aggregated.totalCost / aggregated.outputTokens) * 1000
      : 0;
    aggregated.activeTimeTotal = aggregated.activeTimeCLI + aggregated.activeTimePlanning +
                                 aggregated.activeTimeUser;
    aggregated.productivityRatio = aggregated.activeTimeTotal > 0
      ? aggregated.linesOfCode / aggregated.activeTimeTotal
      : 0;

    // Format active times to match API format (with units like "4.3s" or "2.1m")
    const formatTime = (seconds) => {
      if (seconds < 60) return `${seconds.toFixed(1)}s`;
      return `${(seconds / 60).toFixed(1)}m`;
    };
    aggregated.activeTimeCLI = formatTime(aggregated.activeTimeCLI);
    aggregated.activeTimePlanning = formatTime(aggregated.activeTimePlanning);
    aggregated.activeTimeUser = formatTime(aggregated.activeTimeUser);

    return aggregated;
  }

  getTokensByTypeTimeline() {
    const cutoff = this.getTimeframeCutoff(this.currentTimeframe);
    return Array.from(this.buckets.values())
      .filter(b => b.bucketTime >= cutoff)
      .sort((a, b) => a.bucketTime - b.bucketTime)
      .map(bucket => ({
        time: bucket.bucketTime,
        input: bucket.inputTokens || 0,
        output: bucket.outputTokens || 0,
        cacheRead: bucket.cacheReadTokens || 0,
        cacheCreation: bucket.cacheCreationTokens || 0
      }));
  }

  getCostTimeline() {
    const cutoff = this.getTimeframeCutoff(this.currentTimeframe);
    return Array.from(this.buckets.values())
      .filter(b => b.bucketTime >= cutoff)
      .sort((a, b) => a.bucketTime - b.bucketTime)
      .map(bucket => ({
        time: bucket.bucketTime,
        value: bucket.totalCost || 0
      }));
  }

  onTimeframeChange(newTimeframe) {
    this.currentTimeframe = newTimeframe;
    saveDataTimeframe(newTimeframe);
    this.performUIUpdate();  // Instant update, no network request

    // Update Claude usage sparklines when timeframe changes
    fetchClaudeUsageHistory(newTimeframe);
  }

  cleanupOldBuckets() {
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    const cutoff = Date.now() - maxAge;

    for (let [bucketTime, bucket] of this.buckets) {
      if (bucketTime < cutoff) {
        this.buckets.delete(bucketTime);
      }
    }
  }
}

// Initialize metrics dashboard
let metricsDashboard = null;
if (USE_CHANGEFEED_METRICS) {
  metricsDashboard = new MetricsDashboard();
  // Run cleanup periodically
  setInterval(() => metricsDashboard.cleanupOldBuckets(), 60 * 60 * 1000); // Every hour
}

function connectWebSocket() {
    // Clear any existing reconnect timer
    if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
    }

    // Close existing WebSocket connection if it exists
    if (ws) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            console.log('🔌 Closing existing WebSocket connection');
            ws.close();
        }
        ws = null;
    }

    // Build WebSocket URL from current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);
    updateWebSocketStatus('disconnected');

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('✅ WebSocket connected');
        // Update status indicator
        updateWebSocketStatus('connected');
        // Fetch initial data
        fetchData();
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);

            if (message.type === 'connected') {
                console.log('📡 WebSocket: ' + message.message);
            }
            else if (message.type === 'sessions_snapshot') {
                // Initial snapshot - replace all sessions
                handleSessionsSnapshot(message.data);
            }
            else if (message.type === 'session_update') {
                // Incremental update
                handleSessionUpdate(message.action, message.data);
            }
            else if (USE_CHANGEFEED_METRICS && (message.type === 'aggregated_update' || 
                     message.type === 'bucket_update' || message.type === 'buckets_snapshot')) {
                // Handle metric changefeed updates
                if (metricsDashboard) {
                    metricsDashboard.onMessage(message);
                }
            }
            else if (message.type === 'metrics' || message.type === 'events') {
                // New data received, show activity on timeline only
                handleWebSocketUpdate();
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
    };

    ws.onclose = () => {
        console.log('🔌 WebSocket disconnected, reconnecting in 5 seconds...');
        // Update status indicator
        updateWebSocketStatus('disconnected');
        // Attempt to reconnect after 5 seconds
        wsReconnectTimer = setTimeout(connectWebSocket, 5000);
    };
}

// Initial fetch
fetchData();

// Connect to WebSocket for real-time updates
connectWebSocket();

// Manual refresh button
const refreshBtn = document.getElementById('refresh-btn');
if (refreshBtn) {
    refreshBtn.onclick = async function() {
        console.log('🔄 Manual refresh requested');
        await fetchData();
    };
}

// Log startup
console.log('📊 Claude Code Metrics Dashboard loaded');
console.log('🔌 WebSocket enabled for real-time updates');
console.log('🔄 Manual refresh available via refresh button');

// ============================================================================
// Claude.ai Usage Tracking
// ============================================================================

// Load session key from localStorage
function loadSessionKey() {
    return localStorage.getItem(STORAGE_KEY);
}

// Save session key to localStorage
function saveSessionKey(key) {
    localStorage.setItem(STORAGE_KEY, key);
}

// Clear session key from localStorage
function clearSessionKey() {
    localStorage.removeItem(STORAGE_KEY);
}

// Load polling interval from localStorage (default: 30 seconds)
function loadPollingInterval() {
    const saved = localStorage.getItem(POLLING_INTERVAL_KEY);
    return saved ? parseInt(saved, 10) : 30;
}

// Save polling interval to localStorage
function savePollingInterval(seconds) {
    localStorage.setItem(POLLING_INTERVAL_KEY, seconds.toString());
}

// Load data timeframe from localStorage (default: 'all')
function loadDataTimeframe() {
    return localStorage.getItem(DATA_TIMEFRAME_KEY) || 'all';
}

// Save data timeframe to localStorage
function saveDataTimeframe(timeframe) {
    localStorage.setItem(DATA_TIMEFRAME_KEY, timeframe);
}

// Fetch Claude.ai usage data
async function fetchClaudeUsage() {
    const sessionKey = loadSessionKey();

    if (!sessionKey) {
        updateClaudeStatus('No session key configured', 'error');
        return;
    }

    try {
        const response = await fetch('/api/claude-usage', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                sessionKey,
                userAgent: navigator.userAgent,
                language: navigator.language,
                platform: navigator.platform
            })
        });

        const result = await response.json();

        if (result.success) {
            updateClaudeUsageDisplay(result.data);
            updateClaudeStatus('Connected', 'active');

            // Fetch and update historical sparklines using current timeframe
            const currentTimeframe = loadDataTimeframe();
            await fetchClaudeUsageHistory(currentTimeframe);
        } else {
            handleClaudeError(result.error);
        }
    } catch (error) {
        console.error('Error fetching Claude usage:', error);
        updateClaudeStatus('Network error', 'error');
    }
}

// Format time remaining
function formatTimeRemaining(ms) {
  if (ms <= 0) return 'Resetting...';
  
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

// Fetch Claude.ai usage history for sparklines
async function fetchClaudeUsageHistory(timeframe) {
    try {
        // If 'all' timeframe is selected, show last 7 days for sparklines
        // Otherwise use the same timeframe as the main dashboard
        const sparklineTimeframe = timeframe === 'all' ? '7d' : timeframe;

        const response = await fetch(`/api/claude-usage/history?timeframe=${sparklineTimeframe}`);
        const result = await response.json();

        if (result.success && result.data) {
            updateClaudeUsageSparklines(result.data);
        }
    } catch (error) {
        console.error('Error fetching Claude usage history:', error);
    }
}

// Update sparklines with historical data
function updateClaudeUsageSparklines(historyData) {
    if (!historyData || historyData.length === 0) {
        // Clear sparklines if no data
        if (claudeUsageSparklines.fiveHour) {
            claudeUsageSparklines.fiveHour.data.labels = [];
            claudeUsageSparklines.fiveHour.data.datasets[0].data = [];
            claudeUsageSparklines.fiveHour.update('none');
        }
        if (claudeUsageSparklines.sevenDay) {
            claudeUsageSparklines.sevenDay.data.labels = [];
            claudeUsageSparklines.sevenDay.data.datasets[0].data = [];
            claudeUsageSparklines.sevenDay.update('none');
        }
        if (claudeUsageSparklines.sonnet) {
            claudeUsageSparklines.sonnet.data.labels = [];
            claudeUsageSparklines.sonnet.data.datasets[0].data = [];
            claudeUsageSparklines.sonnet.update('none');
        }
        return;
    }

    const timestamps = historyData.map(d => new Date(d.timestamp));

    // Update 5-hour sparkline
    if (claudeUsageSparklines.fiveHour) {
        claudeUsageSparklines.fiveHour.data.labels = timestamps;
        claudeUsageSparklines.fiveHour.data.datasets[0].data =
            historyData.map(d => d.fiveHour);
        claudeUsageSparklines.fiveHour.update('none');
    }

    // Update 7-day sparkline
    if (claudeUsageSparklines.sevenDay) {
        claudeUsageSparklines.sevenDay.data.labels = timestamps;
        claudeUsageSparklines.sevenDay.data.datasets[0].data =
            historyData.map(d => d.sevenDay);
        claudeUsageSparklines.sevenDay.update('none');
    }

    // Update Sonnet sparkline
    if (claudeUsageSparklines.sonnet) {
        claudeUsageSparklines.sonnet.data.labels = timestamps;
        claudeUsageSparklines.sonnet.data.datasets[0].data =
            historyData.map(d => d.sonnet || 0);
        claudeUsageSparklines.sonnet.update('none');
    }
}

// Helper function to format and display usage projection
function updateProjectionDisplay(elementId, projection) {
    const element = document.getElementById(elementId);

    if (!projection || !projection.available) {
        element.textContent = 'Insufficient data';
        element.className = 'usage-stat-projection neutral';
        return;
    }

    const { hourlyRate, msTo100, willHitLimit, severity } = projection;

    // Handle edge cases
    if (hourlyRate <= 0) {
        element.textContent = `✓ Stable (${Math.abs(hourlyRate).toFixed(2)}%/hr)`;
        element.className = 'usage-stat-projection safe';
        return;
    }

    if (!willHitLimit) {
        element.textContent = `✓ Safe (+${hourlyRate.toFixed(2)}%/hr)`;
        element.className = 'usage-stat-projection safe';
        return;
    }

    // Will hit limit before reset - show time and rate
    const hoursTo100 = Math.floor(msTo100 / 3600000);
    const minutesTo100 = Math.floor((msTo100 % 3600000) / 60000);

    // Format time display
    let timeDisplay;
    if (hoursTo100 >= 24) {
        const days = Math.floor(hoursTo100 / 24);
        const remainingHours = hoursTo100 % 24;
        timeDisplay = `${days}d ${remainingHours}h`;
    } else if (hoursTo100 > 0) {
        timeDisplay = `${hoursTo100}h ${minutesTo100}m`;
    } else {
        timeDisplay = `${minutesTo100}m`;
    }

    // Apply user-defined thresholds: critical < 12h, warning 12-72h
    const icon = severity === 'critical' ? '⚠' : '~';
    element.textContent = `${icon} ${timeDisplay} to 100% (+${hourlyRate.toFixed(2)}%/hr)`;
    element.className = `usage-stat-projection ${severity}`;
}

// Update Claude.ai usage display
function updateClaudeUsageDisplay(data) {
    // Show the usage section
    document.getElementById('claude-usage-section').style.display = 'block';

    // Update 5-hour usage
    if (data.fiveHour) {
        document.getElementById('account-five-hour').textContent = `${data.fiveHour.utilization}%`;
        document.getElementById('account-five-hour-reset').textContent =
            `Resets in ${formatTimeRemaining(data.fiveHour.resetsIn)}`;

        // Update projection display
        updateProjectionDisplay('account-five-hour-projection', data.projections?.fiveHour);
    } else {
        document.getElementById('account-five-hour').textContent = 'N/A';
        document.getElementById('account-five-hour-reset').textContent = '';
        document.getElementById('account-five-hour-projection').textContent = '';
    }

    // Update 7-day usage
    if (data.sevenDay) {
        document.getElementById('account-seven-day').textContent = `${data.sevenDay.utilization}%`;
        document.getElementById('account-seven-day-reset').textContent =
            `Resets in ${formatTimeRemaining(data.sevenDay.resetsIn)}`;

        // Update projection display
        updateProjectionDisplay('account-seven-day-projection', data.projections?.sevenDay);
    } else {
        document.getElementById('account-seven-day').textContent = 'N/A';
        document.getElementById('account-seven-day-reset').textContent = '';
        document.getElementById('account-seven-day-projection').textContent = '';
    }

    // Update Sonnet model usage
    if (data.byModel && data.byModel.sonnet) {
        document.getElementById('account-sonnet').textContent = `${data.byModel.sonnet.utilization}%`;
        document.getElementById('account-sonnet-reset').textContent = 
            `Resets in ${formatTimeRemaining(data.byModel.sonnet.resetsIn)}`;
    } else {
        document.getElementById('account-sonnet').textContent = 'N/A';
        document.getElementById('account-sonnet-reset').textContent = '';
    }

    // Format last updated time
    const lastUpdate = new Date(data.lastUpdated);
    document.getElementById('account-last-update').textContent = lastUpdate.toLocaleTimeString();
}

// Update Claude.ai status
function updateClaudeStatus(message, status) {
    const indicator = document.getElementById('claude-status');
    const text = document.getElementById('claude-status-text');

    indicator.className = 'claude-status-indicator ' + status;
    text.textContent = message;
}

// Handle Claude.ai errors
function handleClaudeError(error) {
    console.error('Claude.ai API error:', error);

    if (error.code === 'COOKIE_EXPIRED') {
        updateClaudeStatus('Session expired - please refresh', 'expired');
        showStatusMessage('Your session key has expired. Please update it in settings.', 'error');
    } else if (error.code === 'NETWORK_ERROR') {
        updateClaudeStatus('Cannot connect to Claude.ai', 'error');
    } else {
        updateClaudeStatus(error.message || 'Error fetching data', 'error');
    }
}

// Show status message in modal
function showStatusMessage(message, type) {
    const statusEl = document.getElementById('session-status');
    statusEl.textContent = message;
    statusEl.className = 'status-message ' + type;
}

// Modal control
const modal = document.getElementById('settings-modal');
const settingsBtn = document.getElementById('settings-btn');
const closeBtn = document.querySelector('.close');
const testBtn = document.getElementById('test-session-btn');
const saveBtn = document.getElementById('save-session-btn');
const clearBtn = document.getElementById('clear-session-btn');
const sessionInput = document.getElementById('session-key-input');

// Open modal
settingsBtn.onclick = function() {
    modal.classList.add('active');
    // Load existing settings
    const existingKey = loadSessionKey();
    if (existingKey) {
        sessionInput.value = existingKey;
    }

    // Load polling interval
    const pollingInterval = loadPollingInterval();
    document.getElementById('polling-interval-input').value = pollingInterval;
};

// Close modal
closeBtn.onclick = function() {
    modal.classList.remove('active');
    document.getElementById('session-status').textContent = '';
};

// Close modal when clicking outside
window.onclick = function(event) {
    if (event.target == modal) {
        modal.classList.remove('active');
        document.getElementById('session-status').textContent = '';
    }
};

// Test session key connection
testBtn.onclick = async function() {
    const key = sessionInput.value.trim();

    if (!key) {
        showStatusMessage('Please enter a session key to test', 'error');
        return;
    }

    showStatusMessage('Testing connection to Claude.ai...', 'success');

    try {
        const response = await fetch('/api/test-claude-session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                sessionKey: key,
                userAgent: navigator.userAgent,
                language: navigator.language,
                platform: navigator.platform
            })
        });

        const result = await response.json();

        console.log('🧪 Test result:', result);

        if (result.success && result.status === 200) {
            showStatusMessage(`✅ Connection successful! Found ${result.data.length || 0} organization(s)`, 'success');
        } else {
            showStatusMessage(
                `❌ Connection failed! Status: ${result.status}\n` +
                `Response: ${JSON.stringify(result.data || result.error).substring(0, 100)}`, 
                'error'
            );
        }
    } catch (error) {
        console.error('Test error:', error);
        showStatusMessage(`❌ Test failed: ${error.message}`, 'error');
    }
};

// Save session key
saveBtn.onclick = async function() {
    const key = sessionInput.value.trim();

    if (!key) {
        showStatusMessage('Please enter the cookie string', 'error');
        return;
    }

    // Validate that it contains sessionKey at minimum
    if (!key.includes('sessionKey=')) {
        showStatusMessage('Cookie string must contain sessionKey=...', 'error');
        return;
    }

    // Warn if cf_clearance is missing
    if (!key.includes('cf_clearance=')) {
        showStatusMessage('⚠️ Warning: cf_clearance cookie missing - requests may be blocked. Saving anyway...', 'error');
        // Continue anyway, let them save it
    }

    // Save session key to localStorage
    saveSessionKey(key);

    // Save polling interval
    const pollingInterval = parseInt(document.getElementById('polling-interval-input').value, 10);
    if (pollingInterval >= 5 && pollingInterval <= 300) {
        savePollingInterval(pollingInterval);
    }

    showStatusMessage('Settings saved! Testing connection...', 'success');

    // Test the key immediately
    await fetchClaudeUsage();

    // Restart polling with new interval
    restartClaudeUsagePolling();

    // Close modal after a delay
    setTimeout(() => {
        modal.classList.remove('active');
        sessionInput.value = '';
    }, 1500);
};

// Clear session key
clearBtn.onclick = function() {
    clearSessionKey();
    sessionInput.value = '';
    document.getElementById('claude-usage-section').style.display = 'none';
    updateClaudeStatus('No session key configured', 'error');
    showStatusMessage('Session key cleared', 'success');
};

// Polling interval ID (so we can restart it)
let claudeUsagePollingId = null;

// Initialize Claude.ai usage polling
function initClaudeUsage() {
    // Initialize sparklines (canvas elements should be in DOM by now)
    initializeClaudeSparklines();

    const sessionKey = loadSessionKey();

    if (sessionKey) {
        // Fetch immediately
        fetchClaudeUsage();

        // Also fetch history for sparklines using current timeframe
        const currentTimeframe = loadDataTimeframe();
        fetchClaudeUsageHistory(currentTimeframe);

        // Get saved polling interval (default 30 seconds)
        const pollingInterval = loadPollingInterval();

        // Poll at the configured interval
        claudeUsagePollingId = setInterval(fetchClaudeUsage, pollingInterval * 1000);

        console.log(`🔐 Claude.ai usage polling enabled (${pollingInterval}s interval)`);
        console.log('   Using your browser\'s User-Agent for authentication');
    } else {
        console.log('⚠️  No Claude.ai session key configured');
        updateClaudeStatus('Not configured - click ⚙️ to setup', 'error');
    }
}

// Restart Claude.ai usage polling with new interval
function restartClaudeUsagePolling() {
    // Clear existing interval if any
    if (claudeUsagePollingId) {
        clearInterval(claudeUsagePollingId);
        claudeUsagePollingId = null;
    }

    // Restart polling
    const sessionKey = loadSessionKey();
    if (sessionKey) {
        const pollingInterval = loadPollingInterval();
        claudeUsagePollingId = setInterval(fetchClaudeUsage, pollingInterval * 1000);
        console.log(`🔄 Polling restarted with ${pollingInterval}s interval`);
    }
}

// Start Claude.ai usage tracking
initClaudeUsage();

// Initialize timeframe selector
const timeframeSelect = document.getElementById('data-timeframe-select');
if (timeframeSelect) {
    // Load saved timeframe
    const savedTimeframe = loadDataTimeframe();
    timeframeSelect.value = savedTimeframe;

    // Add change event listener
    timeframeSelect.addEventListener('change', async function() {
        const newTimeframe = this.value;
        saveDataTimeframe(newTimeframe);
        
        if (USE_CHANGEFEED_METRICS && metricsDashboard) {
            // Use changefeed approach - instant update, no network request
            metricsDashboard.onTimeframeChange(newTimeframe);
        } else {
            // Use polling approach - fetch from server
            await fetchData();
        }
        
        console.log(`📅 Data timeframe changed to: ${newTimeframe}`);
    });
}

