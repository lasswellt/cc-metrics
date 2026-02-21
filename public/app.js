// localStorage keys (must be at top before any code that uses them)
const STORAGE_KEY = 'claudeSessionKey';
const POLLING_INTERVAL_KEY = 'pollingInterval';
const DATA_TIMEFRAME_KEY = 'dataTimeframe';
const THEME_KEY = 'dashboardTheme';

// Feature flag: Use RethinkDB changefeeds for metrics instead of polling
const USE_CHANGEFEED_METRICS = true;

// Chart.js configuration — Bloomberg terminal theme
const chartConfig = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
        duration: 200
    },
    interaction: {
        mode: 'index',
        intersect: false
    },
    plugins: {
        legend: {
            display: false,
            labels: {
                color: '#666680',
                usePointStyle: true,
                pointStyle: 'circle',
                padding: 8,
                font: { family: "'JetBrains Mono', monospace", size: 10 }
            }
        },
        tooltip: {
            backgroundColor: '#0e0e16',
            borderColor: '#1e1e2e',
            borderWidth: 1,
            cornerRadius: 0,
            padding: 8,
            titleColor: '#e8e8e8',
            bodyColor: '#666680',
            titleFont: { family: "'JetBrains Mono', monospace", weight: '600', size: 11 },
            bodyFont: { family: "'JetBrains Mono', monospace", size: 10 }
        }
    },
    scales: {
        y: {
            beginAtZero: true,
            ticks: { color: '#666680', font: { family: "'JetBrains Mono', monospace", size: 9 } },
            grid: { color: 'rgba(30,30,46,0.5)', drawBorder: false },
            border: { display: false }
        },
        x: {
            ticks: { color: '#666680', font: { family: "'JetBrains Mono', monospace", size: 9 } },
            grid: { color: 'rgba(30,30,46,0.5)', drawBorder: false },
            border: { display: false }
        }
    }
};

// Horizontal bar chart config for breakdowns
const horizontalBarConfig = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    animation: {
        duration: 200
    },
    plugins: {
        legend: { display: false },
        tooltip: {
            backgroundColor: '#0e0e16',
            borderColor: '#1e1e2e',
            borderWidth: 1,
            cornerRadius: 0,
            padding: 8,
            titleColor: '#e8e8e8',
            bodyColor: '#666680',
            titleFont: { family: "'JetBrains Mono', monospace", weight: '600', size: 11 },
            bodyFont: { family: "'JetBrains Mono', monospace", size: 10 },
            callbacks: {
                label: function(context) {
                    return ' ' + formatNumber(context.raw);
                }
            }
        }
    },
    scales: {
        x: {
            beginAtZero: true,
            ticks: { color: '#666680', font: { family: "'JetBrains Mono', monospace", size: 9 } },
            grid: { color: 'rgba(30,30,46,0.5)', drawBorder: false },
            border: { display: false }
        },
        y: {
            ticks: { color: '#666680', font: { family: "'JetBrains Mono', monospace", size: 10 } },
            grid: { display: false },
            border: { display: false }
        }
    }
};

// Initialize charts — horizontal bar charts for breakdowns
const tokensByTypeChart = new Chart(document.getElementById('tokens-by-type-chart'), {
    type: 'bar',
    data: {
        labels: ['Input', 'Output', 'Cache Read', 'Cache Create'],
        datasets: [{
            data: [0, 0, 0, 0],
            backgroundColor: [
                '#18ffff',
                '#00e676',
                '#ffab40',
                '#a78bfa'
            ],
            borderRadius: 0,
            borderSkipped: false,
            barThickness: 14
        }]
    },
    options: horizontalBarConfig
});

const tokensByModelChart = new Chart(document.getElementById('tokens-by-model-chart'), {
    type: 'bar',
    data: {
        labels: [],
        datasets: [{
            data: [],
            backgroundColor: [],
            borderRadius: 0,
            borderSkipped: false,
            barThickness: 14
        }]
    },
    options: horizontalBarConfig
});

const timeDistributionChart = new Chart(document.getElementById('time-distribution-chart'), {
    type: 'bar',
    data: {
        labels: ['CLI', 'Planning', 'User'],
        datasets: [{
            data: [0, 0, 0],
            backgroundColor: [
                '#18ffff',
                '#a78bfa',
                '#00e676'
            ],
            borderRadius: 0,
            borderSkipped: false,
            barThickness: 14
        }]
    },
    options: horizontalBarConfig
});

const tokenTimelineCanvas = document.getElementById('token-usage-timeline');

const timeScaleConfig = {
    type: 'time',
    time: {
        unit: 'minute',
        displayFormats: { minute: 'HH:mm', hour: 'HH:mm' },
        tooltipFormat: 'MMM d, HH:mm:ss'
    },
    ticks: {
        color: '#666680',
        maxRotation: 45,
        minRotation: 45,
        font: { family: "'JetBrains Mono', monospace", size: 9 }
    },
    grid: { color: 'rgba(30,30,46,0.5)', drawBorder: false },
    border: { display: false }
};

const tokenUsageTimeline = new Chart(tokenTimelineCanvas, {
    type: 'line',
    data: {
        datasets: [
            {
                label: 'Input',
                data: [],
                borderColor: '#18ffff',
                borderWidth: 1,
                tension: 0.1,
                fill: false,
                pointRadius: 0,
                pointHoverRadius: 3
            },
            {
                label: 'Output',
                data: [],
                borderColor: '#00e676',
                borderWidth: 1,
                tension: 0.1,
                fill: false,
                pointRadius: 0,
                pointHoverRadius: 3
            },
            {
                label: 'Cache Read',
                data: [],
                borderColor: '#ffab40',
                borderWidth: 1,
                tension: 0.1,
                fill: false,
                pointRadius: 0,
                pointHoverRadius: 3
            },
            {
                label: 'Cache Creation',
                data: [],
                borderColor: '#a78bfa',
                borderWidth: 1,
                tension: 0.1,
                fill: false,
                pointRadius: 0,
                pointHoverRadius: 3
            }
        ]
    },
    options: {
        ...chartConfig,
        scales: {
            ...chartConfig.scales,
            x: timeScaleConfig
        },
        plugins: {
            ...chartConfig.plugins,
            legend: {
                display: true,
                position: 'top',
                labels: {
                    color: '#666680',
                    usePointStyle: true,
                    pointStyle: 'circle',
                    padding: 8,
                    font: { family: "'JetBrains Mono', monospace", size: 9 }
                }
            }
        }
    }
});

const costTimelineCanvas = document.getElementById('cost-timeline');

const costTimeline = new Chart(costTimelineCanvas, {
    type: 'line',
    data: {
        datasets: [{
            label: 'Cost ($)',
            data: [],
            borderColor: '#ffab40',
            borderWidth: 1,
            tension: 0.1,
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 3
        }]
    },
    options: {
        ...chartConfig,
        scales: {
            ...chartConfig.scales,
            x: timeScaleConfig
        }
    }
});

// ============================================================================
// Theme Manager
// ============================================================================

const ThemeManager = {
    themes: {
        bloomberg: {
            chart: {
                fontFamily: "'JetBrains Mono', monospace",
                gridColor: 'rgba(30,30,46,0.5)',
                tickColor: '#666680',
                tooltipBg: '#0e0e16',
                tooltipBorder: '#1e1e2e',
                tooltipTitle: '#e8e8e8',
                tooltipBody: '#666680',
                legendColor: '#666680',
                dataColors: ['#18ffff', '#00e676', '#ffab40', '#a78bfa'],
                costColor: '#ffab40',
                borderWidth: 1,
                tension: 0.1,
                fill: false,
                borderRadius: 0,
                barThickness: 14,
                cornerRadius: 0,
                animationDuration: 200,
                pointRadius: 0,
                pointHoverRadius: 3,
            },
            renderMode: 'terminal'
        },
        glass: {
            chart: {
                fontFamily: "'Inter', sans-serif",
                gridColor: 'rgba(255,255,255,0.06)',
                tickColor: '#a0a0a0',
                tooltipBg: 'rgba(30,30,50,0.9)',
                tooltipBorder: 'rgba(255,255,255,0.15)',
                tooltipTitle: '#ffffff',
                tooltipBody: '#c0c0c0',
                legendColor: '#c0c0c0',
                dataColors: ['#4facfe', '#43e97b', '#ff9800', '#f093fb'],
                costColor: '#ff9800',
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                borderRadius: 6,
                barThickness: 18,
                cornerRadius: 6,
                animationDuration: 600,
                pointRadius: 0,
                pointHoverRadius: 5,
            },
            renderMode: 'cards'
        },
        minimal: {
            chart: {
                fontFamily: "'Inter', sans-serif",
                gridColor: 'rgba(255,255,255,0.04)',
                tickColor: '#71717a',
                tooltipBg: '#1a1a22',
                tooltipBorder: 'rgba(255,255,255,0.1)',
                tooltipTitle: '#e4e4e7',
                tooltipBody: '#a1a1aa',
                legendColor: '#a1a1aa',
                dataColors: ['#6366f1', '#22c55e', '#f59e0b', '#a78bfa'],
                costColor: '#f59e0b',
                borderWidth: 1.5,
                tension: 0.3,
                fill: false,
                borderRadius: 4,
                barThickness: 16,
                cornerRadius: 4,
                animationDuration: 300,
                pointRadius: 0,
                pointHoverRadius: 4,
            },
            renderMode: 'list'
        }
    },

    current: 'bloomberg',

    init() {
        this.current = localStorage.getItem(THEME_KEY) || 'bloomberg';
        document.body.setAttribute('data-theme', this.current);
        const sel = document.getElementById('theme-select');
        if (sel) sel.value = this.current;
        this.applyChartTheme();
    },

    set(themeName) {
        if (!this.themes[themeName]) return;
        this.current = themeName;
        localStorage.setItem(THEME_KEY, themeName);
        document.body.setAttribute('data-theme', themeName);
        const sel = document.getElementById('theme-select');
        if (sel) sel.value = themeName;
        this.applyChartTheme();
        renderSessions();
        renderTeams();
        if (lastEventsData) updateEvents(lastEventsData);
    },

    get config() { return this.themes[this.current]; },

    applyChartTheme() {
        const c = this.config.chart;
        const allCharts = [
            { chart: tokenUsageTimeline, type: 'line' },
            { chart: costTimeline, type: 'line' },
            { chart: tokensByTypeChart, type: 'bar' },
            { chart: tokensByModelChart, type: 'bar' },
            { chart: timeDistributionChart, type: 'bar' }
        ];

        allCharts.forEach(({ chart, type }) => {
            if (!chart) return;

            // Tooltip
            const tt = chart.options.plugins.tooltip;
            tt.backgroundColor = c.tooltipBg;
            tt.borderColor = c.tooltipBorder;
            tt.cornerRadius = c.cornerRadius;
            tt.titleColor = c.tooltipTitle;
            tt.bodyColor = c.tooltipBody;
            tt.titleFont = { ...tt.titleFont, family: c.fontFamily };
            tt.bodyFont = { ...tt.bodyFont, family: c.fontFamily };

            // Legend
            if (chart.options.plugins.legend && chart.options.plugins.legend.labels) {
                chart.options.plugins.legend.labels.color = c.legendColor;
                if (chart.options.plugins.legend.labels.font) {
                    chart.options.plugins.legend.labels.font = {
                        ...chart.options.plugins.legend.labels.font,
                        family: c.fontFamily
                    };
                }
            }

            // Animation
            chart.options.animation.duration = c.animationDuration;

            // Scales
            ['x', 'y'].forEach(axis => {
                const scale = chart.options.scales[axis];
                if (!scale) return;
                if (scale.ticks) {
                    scale.ticks.color = c.tickColor;
                    if (scale.ticks.font) {
                        scale.ticks.font = { ...scale.ticks.font, family: c.fontFamily };
                    }
                }
                if (scale.grid && scale.grid.display !== false) {
                    scale.grid.color = c.gridColor;
                }
            });

            // Dataset-level styling
            if (type === 'line') {
                chart.data.datasets.forEach((ds, i) => {
                    const color = ds.label === 'Cost ($)' ? c.costColor : c.dataColors[i % c.dataColors.length];
                    ds.borderColor = color;
                    ds.borderWidth = c.borderWidth;
                    ds.tension = c.tension;
                    ds.fill = c.fill;
                    ds.pointRadius = c.pointRadius;
                    ds.pointHoverRadius = c.pointHoverRadius;
                    if (c.fill && color.startsWith('#')) {
                        ds.backgroundColor = color + '20';
                    }
                });
            } else {
                chart.data.datasets.forEach(ds => {
                    ds.borderRadius = c.borderRadius;
                    ds.barThickness = c.barThickness;
                });
            }

            chart.update('none');
        });
    }
};

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
                borderWidth: 1,
                pointRadius: 0,
                tension: 0.1,
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
    claudeUsageSparklines.fiveHour = createUsageSparkline('five-hour-sparkline', '#00e676');
    claudeUsageSparklines.sevenDay = createUsageSparkline('seven-day-sparkline', '#18ffff');
    claudeUsageSparklines.sonnet = createUsageSparkline('sonnet-sparkline', '#ffab40');
}

// ============================================================================
// Animated Value Counter
// ============================================================================

const animatingElements = new Map();

function animateValue(element, newValue, formatter, duration = 200) {
    if (!element) return;

    // Parse current displayed value to a number
    const text = element.textContent || '0';
    const currentValue = parseFloat(text.replace(/[^0-9.\-]/g, '')) || 0;

    // Skip if no meaningful change (prevents jitter)
    if (Math.abs(newValue - currentValue) < 0.01) return;

    // Cancel any ongoing animation for this element
    const existingAnim = animatingElements.get(element);
    if (existingAnim) {
        cancelAnimationFrame(existingAnim);
    }

    const startTime = performance.now();
    const delta = newValue - currentValue;

    function easeOutQuart(t) {
        return 1 - Math.pow(1 - t, 4);
    }

    function tick(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = easeOutQuart(progress);
        const current = currentValue + delta * easedProgress;

        element.textContent = formatter ? formatter(current) : current.toString();

        if (progress < 1) {
            const id = requestAnimationFrame(tick);
            animatingElements.set(element, id);
        } else {
            animatingElements.delete(element);
        }
    }

    const id = requestAnimationFrame(tick);
    animatingElements.set(element, id);
}

// ============================================================================
// Progress Ring Controller
// ============================================================================

function updateProgressRing(ringId, percentage) {
    // No-op: progress rings removed in Bloomberg terminal redesign
}

// ============================================================================
// Productivity Gauge SVG Arc
// ============================================================================

function updateProductivityGauge(value) {
    // No-op: gauge SVG removed in Bloomberg terminal redesign
}

// ============================================================================
// Stat Card Sparklines
// ============================================================================

const statSparklineData = {
    cost: [],
    loc: [],
    inputTokens: [],
    outputTokens: []
};

const statSparklines = {};

function initStatSparklines() {
    // No-op: stat card sparklines removed in Bloomberg terminal redesign
}

function hexToRgbObj(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 148, g: 163, b: 184 };
}

function updateStatSparkline(dataKey, value) {
    // No-op: stat card sparklines removed in Bloomberg terminal redesign
}

// ============================================================================
// Trend Indicators
// ============================================================================

const previousStats = {};

function updateTrendIndicator(elementId, currentValue, statKey) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const prev = previousStats[statKey];
    if (prev !== undefined && prev > 0) {
        const change = ((currentValue - prev) / prev) * 100;
        if (Math.abs(change) > 0.1) {
            const arrow = change > 0 ? '\u2191' : '\u2193';
            el.textContent = `${arrow} ${Math.abs(change).toFixed(1)}%`;
            el.className = `trend-indicator ${change > 0 ? 'up' : 'down'}`;
        } else {
            el.textContent = '';
            el.className = 'trend-indicator';
        }
    }
    previousStats[statKey] = currentValue;
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

// Get model family and version from full model name
// Returns: { family: 'opus'|'sonnet'|'haiku'|'unknown', version: '4.5'|null }
function getModelFamily(modelFullName) {
    if (!modelFullName) return { family: 'unknown', version: null };

    const lower = modelFullName.toLowerCase();

    if (lower.includes('opus')) {
        const match = lower.match(/opus[_-](\d+)[_-](\d+)/);
        const version = match ? `${match[1]}.${match[2]}` : null;
        return { family: 'opus', version };
    }

    if (lower.includes('sonnet')) {
        const match = lower.match(/sonnet[_-](\d+)[_-](\d+)/);
        const version = match ? `${match[1]}.${match[2]}` : null;
        return { family: 'sonnet', version };
    }

    if (lower.includes('haiku')) {
        const match = lower.match(/haiku[_-](\d+)[_-](\d+)/);
        const version = match ? `${match[1]}.${match[2]}` : null;
        return { family: 'haiku', version };
    }

    return { family: 'unknown', version: null };
}

// Compare version strings (e.g., "4.5" vs "4.0")
// Returns: positive if v1 > v2, negative if v1 < v2, 0 if equal
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 !== p2) return p1 - p2;
    }
    return 0;
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
    // Main stats — animated
    const sessionCount = data.sessionCount || 0;
    animateValue(document.getElementById('session-count'), sessionCount, v => Math.round(v).toString());

    // Active times - display formatted string from backend (already includes units like "5.0m" or "30.2s")
    document.getElementById('active-time-cli').textContent = data.activeTimeCLI || '0s';
    document.getElementById('active-time-planning').textContent = data.activeTimePlanning || '0s';

    // Cost — animated
    const totalCost = parseFloat(data.totalCost || 0);
    animateValue(document.getElementById('total-cost'), totalCost, v => `$${v.toFixed(2)}`);

    // Lines of code — animated
    const loc = data.linesOfCode || 0;
    animateValue(document.getElementById('lines-of-code'), loc, v => formatNumber(Math.round(v)));

    // Token stats — animated
    const inputTokens = data.inputTokens || 0;
    const outputTokens = data.outputTokens || 0;
    const cacheRead = data.cacheReadTokens || 0;
    const cacheCreation = data.cacheCreationTokens || 0;

    animateValue(document.getElementById('input-tokens'), inputTokens, v => formatNumber(Math.round(v)));
    animateValue(document.getElementById('output-tokens'), outputTokens, v => formatNumber(Math.round(v)));
    animateValue(document.getElementById('cache-read'), cacheRead, v => formatNumber(Math.round(v)));
    animateValue(document.getElementById('cache-creation'), cacheCreation, v => formatNumber(Math.round(v)));

    // Cache efficiency — animated + progress ring
    const cacheEfficiency = parseFloat(data.cacheEfficiency) || 0;
    animateValue(document.getElementById('cache-efficiency'), cacheEfficiency, v => `${v.toFixed(2)}%`);
    updateProgressRing('cache-efficiency-ring', cacheEfficiency);

    // Cost per 1k — animated
    const costPer1k = parseFloat(data.costPer1kOutput) || 0;
    animateValue(document.getElementById('cost-per-1k'), costPer1k, v => `$${v.toFixed(2)}`);

    // Productivity — animated + gauge
    const productivityRatio = data.productivityRatio || 0;
    animateValue(document.getElementById('productivity-ratio'), productivityRatio, v => formatNumber(v));
    updateProductivityGauge(productivityRatio);

    // Git & Code Activity stats — animated
    animateValue(document.getElementById('pull-requests'), data.pullRequests || 0, v => formatNumber(Math.round(v)));
    animateValue(document.getElementById('commits'), data.commits || 0, v => formatNumber(Math.round(v)));
    animateValue(document.getElementById('lines-added'), data.linesAdded || 0, v => '+' + formatNumber(Math.round(v)));
    animateValue(document.getElementById('lines-removed'), data.linesRemoved || 0, v => '-' + formatNumber(Math.round(v)));

    // Edit accept rate — animated + progress ring
    const totalEdits = (data.codeEditAccepts || 0) + (data.codeEditRejects || 0);
    const acceptRate = totalEdits > 0 ? (data.codeEditAccepts || 0) / totalEdits * 100 : 0;
    animateValue(document.getElementById('edit-accept-rate'), acceptRate, v => `${v.toFixed(1)}%`);
    updateProgressRing('edit-accept-ring', acceptRate);

    // Update stat sparklines
    updateStatSparkline('cost', totalCost);
    updateStatSparkline('loc', loc);
    updateStatSparkline('inputTokens', inputTokens);
    updateStatSparkline('outputTokens', outputTokens);

    // Update trend indicators
    updateTrendIndicator('trend-total-cost', totalCost, 'totalCost');
    updateTrendIndicator('trend-lines-of-code', loc, 'linesOfCode');
    updateTrendIndicator('trend-input-tokens', inputTokens, 'inputTokens');
    updateTrendIndicator('trend-output-tokens', outputTokens, 'outputTokens');
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
    tokensByTypeChart.update();
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
    tokensByModelChart.update();
}

// Update cost by model list
function updateCostByModel(byModel) {
    const costList = document.getElementById('cost-by-model');
    if (!costList) return;
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
    timeDistributionChart.update();
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

    tokenUsageTimeline.update();
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

    costTimeline.update();
}

// Update events list
// Helper function: Format an attribute value based on its type and key
function formatAttributeValue(key, value) {
    if (typeof value === 'number' && key.includes('cost')) {
        return `$${value.toFixed(4)}`;
    } else if (typeof value === 'number' && key.includes('tokens')) {
        return value.toLocaleString();
    } else if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return value;
}

// Helper function: Extract and format attribute lines from an event
function extractAttributeLines(event) {
    const lines = [];

    if (event.attributes) {
        for (const [key, value] of Object.entries(event.attributes)) {
            const formattedValue = formatAttributeValue(key, value);
            lines.push(`${key}: ${formattedValue}`);
        }
    }

    // If no attributes, use body
    if (lines.length === 0) {
        lines.push(event.body || 'No data');
    }

    return lines;
}

// Card-based event rendering (glass theme)
function renderEventCardView(event) {
    const time = formatTime(event.timestamp);
    const type = escapeHtml(event.type || 'info').toUpperCase();
    const severity = (event.severity || 'INFO').toLowerCase();
    let typeClass = 'info';
    if (severity === 'error' || severity === 'err') typeClass = 'error';
    else if (severity === 'warn' || severity === 'warning') typeClass = 'warn';
    else if (type.includes('TOOL') || type.includes('tool')) typeClass = 'tool';

    const attributeLines = extractAttributeLines(event);
    const body = attributeLines[0] || '';

    let badges = '';
    if (event.attributes && event.attributes._display) {
        const d = event.attributes._display;
        if (d.model) badges += `<span class="log-badge model">${escapeHtml(d.model)}</span>`;
        if (d.tool) badges += `<span class="log-badge tool">${escapeHtml(d.tool)}</span>`;
        if (d.cost !== undefined) badges += `<span class="log-badge cost">$${parseFloat(d.cost).toFixed(4)}</span>`;
        if (d.success !== undefined) badges += `<span class="log-badge ${d.success ? 'success' : 'failure'}">${d.success ? 'OK' : 'FAIL'}</span>`;
        if (d.duration !== undefined) badges += `<span class="log-badge duration">${d.duration}ms</span>`;
    }

    return `
        <div class="event-card ${typeClass}">
            <div class="event-card-header">
                <span class="event-card-time">${time}</span>
                <span class="event-card-type ${typeClass}">${type}</span>
                ${badges ? `<span class="log-badges">${badges}</span>` : ''}
            </div>
            <div class="event-card-body">${escapeHtml(body)}</div>
        </div>
    `;
}

// Simple row event rendering (minimal theme)
function renderEventListItem(event) {
    const time = formatTime(event.timestamp);
    const type = escapeHtml(event.type || 'info').toUpperCase();
    const severity = (event.severity || 'INFO').toLowerCase();
    let typeClass = 'info';
    if (severity === 'error' || severity === 'err') typeClass = 'error';
    else if (severity === 'warn' || severity === 'warning') typeClass = 'warn';
    else if (type.includes('TOOL') || type.includes('tool')) typeClass = 'tool';

    const attributeLines = extractAttributeLines(event);
    const body = attributeLines[0] || '';

    let badges = '';
    if (event.attributes && event.attributes._display) {
        const d = event.attributes._display;
        if (d.model) badges += `<span class="log-badge model">${escapeHtml(d.model)}</span>`;
        if (d.cost !== undefined) badges += `<span class="log-badge cost">$${parseFloat(d.cost).toFixed(4)}</span>`;
    }

    return `
        <div class="event-row ${typeClass}">
            <span class="event-row-time">${time}</span>
            <span class="event-row-body">${escapeHtml(body)}</span>
            ${badges ? `<span class="log-badges">${badges}</span>` : ''}
        </div>
    `;
}

// Render a single event as a compact log line
function renderEventItem(event) {
    const time = formatTime(event.timestamp);
    const type = escapeHtml(event.type || 'info').toUpperCase();

    // Determine severity class for coloring
    const severity = (event.severity || 'INFO').toLowerCase();
    let typeClass = 'info';
    if (severity === 'error' || severity === 'err') typeClass = 'error';
    else if (severity === 'warn' || severity === 'warning') typeClass = 'warn';
    else if (type.includes('TOOL') || type.includes('tool')) typeClass = 'tool';
    else if (severity === 'debug') typeClass = 'debug';

    // Build compact body text from first attribute line
    const attributeLines = extractAttributeLines(event);
    const body = attributeLines[0] || '';

    // Build inline badges
    let badges = '';
    if (event.attributes && event.attributes._display) {
        const d = event.attributes._display;
        if (d.model) badges += `<span class="log-badge model">${escapeHtml(d.model)}</span>`;
        if (d.tool) badges += `<span class="log-badge tool">${escapeHtml(d.tool)}</span>`;
        if (d.cost !== undefined) badges += `<span class="log-badge cost">$${parseFloat(d.cost).toFixed(4)}</span>`;
        if (d.success !== undefined) badges += `<span class="log-badge ${d.success ? 'success' : 'failure'}">${d.success ? 'OK' : 'FAIL'}</span>`;
        if (d.duration !== undefined) badges += `<span class="log-badge duration">${d.duration}ms</span>`;
        if (d.error) badges += `<span class="log-badge error">${escapeHtml(String(d.error).substring(0, 40))}</span>`;
    }

    return `
        <div class="log-line">
            <span class="log-time">${time}</span>
            <span class="log-type ${typeClass}">${type}</span>
            <span class="log-body">${escapeHtml(body)}</span>
            ${badges ? `<span class="log-badges">${badges}</span>` : ''}
        </div>
    `;
}

// Cache last events data for theme re-rendering
let lastEventsData = null;

// Main function: Update events list - dispatches to theme-appropriate renderer
function updateEvents(eventsData) {
    lastEventsData = eventsData;
    const eventsList = document.getElementById('events-list');

    if (eventsData.events.length === 0) {
        eventsList.innerHTML = '<div class="no-data">No events yet. Start a Claude Code session to see data.</div>';
        return;
    }

    const mode = ThemeManager.config.renderMode;
    if (mode === 'cards') {
        eventsList.innerHTML = eventsData.events.map(renderEventCardView).join('');
    } else if (mode === 'list') {
        eventsList.innerHTML = eventsData.events.map(renderEventListItem).join('');
    } else {
        eventsList.innerHTML = eventsData.events.map(renderEventItem).join('');
    }
}

// Toggle expand/collapse - no-op in terminal redesign (log lines are single-line)
function toggleEventExpand(button) {}

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
// Merges into existing sessionsMap so DB-loaded sessions are preserved
function handleSessionsSnapshot(data) {
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
        // Mark session as inactive instead of deleting — keeps completed
        // team agent sessions visible in the sessions panel
        if (data && data.sessionId) {
            const existing = sessionsMap.get(data.sessionId);
            if (existing) {
                existing.isActive = false;
                sessionsMap.set(data.sessionId, existing);
            }
        }
    }
    renderSessions();
    recordWebSocketActivity();
}

// Render terminal sessions from sessionsMap
// Helper function: Calculate total tokens for a model's data
function calculateModelTotalTokens(modelData) {
    return (modelData.inputTokens || 0) +
           (modelData.outputTokens || 0) +
           (modelData.cacheReadTokens || 0) +
           (modelData.cacheCreationTokens || 0);
}

// Helper function: Aggregate models by family (opus, sonnet, haiku) with percentages
// Always returns 3 families in fixed order, even if they have 0 tokens
function aggregateModelsByFamily(byModel) {
    // Initialize all 3 families with zero values
    const families = {
        opus: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            cost: 0,
            displayName: 'Opus',
            highestVersion: null,
            percentage: 0,
            isActive: false
        },
        sonnet: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            cost: 0,
            displayName: 'Sonnet',
            highestVersion: null,
            percentage: 0,
            isActive: false
        },
        haiku: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            cost: 0,
            displayName: 'Haiku',
            highestVersion: null,
            percentage: 0,
            isActive: false
        }
    };

    // If byModel exists and has data, aggregate it
    if (byModel && typeof byModel === 'object') {
        Object.entries(byModel).forEach(([modelFullName, data]) => {
            const { family, version } = getModelFamily(modelFullName);

            // Skip unknown models
            if (family === 'unknown') return;

            const familyData = families[family];

            // Aggregate token counts
            familyData.inputTokens += (data.inputTokens || 0);
            familyData.outputTokens += (data.outputTokens || 0);
            familyData.cacheReadTokens += (data.cacheReadTokens || 0);
            familyData.cacheCreationTokens += (data.cacheCreationTokens || 0);
            familyData.cost += (data.cost || 0);

            // Track highest version for display name
            if (version) {
                if (!familyData.highestVersion ||
                    compareVersions(version, familyData.highestVersion) > 0) {
                    familyData.highestVersion = version;
                    // Update display name with version
                    familyData.displayName = `${family.charAt(0).toUpperCase() + family.slice(1)} ${version}`;
                }
            }
        });
    }

    // Calculate total tokens across all families
    const totalTokens = Object.values(families).reduce((sum, fam) =>
        sum + calculateModelTotalTokens(fam), 0);

    // Calculate percentage for each family and find most active
    let mostActiveFamily = null;
    let highestTokenCount = 0;

    Object.values(families).forEach(familyData => {
        const familyTotalTokens = calculateModelTotalTokens(familyData);

        // Calculate percentage
        if (totalTokens > 0) {
            familyData.percentage = (familyTotalTokens / totalTokens) * 100;
        } else {
            familyData.percentage = 0;
        }

        // Track most active family
        if (familyTotalTokens > highestTokenCount) {
            highestTokenCount = familyTotalTokens;
            mostActiveFamily = familyData;
        }
    });

    // Mark the most active family (only if it has tokens)
    if (mostActiveFamily && highestTokenCount > 0) {
        mostActiveFamily.isActive = true;
    }

    // Always return 3 families in fixed order: Opus, Sonnet, Haiku
    return [
        ['opus', families.opus],
        ['sonnet', families.sonnet],
        ['haiku', families.haiku]
    ];
}

// Helper function: Render a single model column
function renderModelColumn(familyKey, familyData) {
    const input = familyData.inputTokens || 0;
    const output = familyData.outputTokens || 0;
    const total = calculateModelTotalTokens(familyData);
    const displayName = familyData.displayName || 'Unknown';
    const percentage = (familyData.percentage || 0).toFixed(1);
    const isActive = familyData.isActive || false;

    // Add CSS classes
    const zeroTokenClass = total === 0 ? 'zero-tokens' : '';
    const activeClass = isActive ? 'active-model' : '';

    // Activity arrow (only show if active)
    const arrowHtml = isActive ? '<span class="activity-arrow">↑</span>' : '';

    return `
        <div class="session-model-column ${zeroTokenClass} ${activeClass}">
            <div class="model-column-header">
                ${displayName} (${percentage}%)
                ${arrowHtml}
            </div>
            <div class="model-column-divider"></div>
            <div class="model-column-value">
                ${formatNumber(input)}/${formatNumber(output)}/${formatNumber(total)}
            </div>
        </div>
    `;
}

// Render a single session as a table row
function renderSessionCard(session) {
    const shortId = session.sessionId.split('-')[0];
    const rowClass = session.isActive ? 'active-row' : '';
    const statusDotClass = session.isActive ? 'active' : '';

    // Get primary model info
    const modelFamilies = aggregateModelsByFamily(session.byModel);
    const activeModel = modelFamilies.find(([, d]) => d.isActive);
    const modelName = activeModel ? activeModel[1].displayName : '--';

    // Calculate total tokens
    const totalTokens = modelFamilies.reduce((sum, [, d]) => sum + calculateModelTotalTokens(d), 0);

    return `
        <tr class="${rowClass}">
            <td><span class="session-status-dot ${statusDotClass}"></span>${shortId}</td>
            <td>${escapeHtml(session.terminalType || '??')}</td>
            <td>${modelName}</td>
            <td>${formatNumber(totalTokens)}</td>
            <td style="color:var(--amber)">$${session.totalCost}</td>
            <td>${formatNumber(session.linesOfCode)}</td>
            <td>${session.totalActiveTime}</td>
            <td>${formatSessionDuration(session.duration)}</td>
            <td style="color:var(--gray)">${formatRelativeTime(session.lastSeen)}</td>
        </tr>
    `;
}

// Card-based session rendering (glass theme)
function renderSessionCardView(session) {
    const shortId = session.sessionId.split('-')[0];
    const isActive = session.isActive;
    const modelFamilies = aggregateModelsByFamily(session.byModel);
    const totalTokens = modelFamilies.reduce((sum, [, d]) => sum + calculateModelTotalTokens(d), 0);

    const modelBadges = modelFamilies
        .filter(([, d]) => calculateModelTotalTokens(d) > 0)
        .map(([, d]) => `<span class="session-card-badge">${d.displayName} ${d.percentage.toFixed(0)}%</span>`)
        .join('');

    return `
        <div class="session-card ${isActive ? 'active' : ''}">
            <div class="session-card-header">
                <span class="session-status-dot ${isActive ? 'active' : ''}"></span>
                <span class="session-card-id">${shortId}</span>
                <span class="session-card-type">${escapeHtml(session.terminalType || '??')}</span>
                <span class="session-card-cost">$${session.totalCost}</span>
            </div>
            ${modelBadges ? `<div class="session-card-models">${modelBadges}</div>` : ''}
            <div class="session-card-footer">
                <span>${formatNumber(totalTokens)} tok</span>
                <span>${formatNumber(session.linesOfCode)} LoC</span>
                <span>${session.totalActiveTime}</span>
                <span>${formatSessionDuration(session.duration)}</span>
                <span class="session-card-seen">${formatRelativeTime(session.lastSeen)}</span>
            </div>
        </div>
    `;
}

// List-based session rendering (minimal theme)
function renderSessionListItem(session) {
    const shortId = session.sessionId.split('-')[0];
    const isActive = session.isActive;
    const modelFamilies = aggregateModelsByFamily(session.byModel);
    const activeModel = modelFamilies.find(([, d]) => d.isActive);
    const modelName = activeModel ? activeModel[1].displayName : '--';
    const totalTokens = modelFamilies.reduce((sum, [, d]) => sum + calculateModelTotalTokens(d), 0);

    return `
        <div class="session-list-item ${isActive ? 'active' : ''}">
            <span class="session-status-dot ${isActive ? 'active' : ''}"></span>
            <span class="session-list-id">${shortId}</span>
            <span class="session-list-model">${modelName}</span>
            <span class="session-list-tokens">${formatNumber(totalTokens)}</span>
            <span class="session-list-cost">$${session.totalCost}</span>
            <span class="session-list-loc">${formatNumber(session.linesOfCode)} LoC</span>
            <span class="session-list-time">${session.totalActiveTime}</span>
            <span class="session-list-seen">${formatRelativeTime(session.lastSeen)}</span>
        </div>
    `;
}

// Main render function - dispatches to theme-appropriate layout
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

    // Show section and update stats
    sessionsSection.style.display = 'flex';
    const activeSessions = sessions.filter(s => s.isActive).length;
    sessionsTotal.textContent = `${sessions.length} total`;
    sessionsActive.textContent = `${activeSessions} active`;

    // Sort by startTime (newest session first)
    sessions.sort((a, b) => b.startTime - a.startTime);

    const mode = ThemeManager.config.renderMode;
    if (mode === 'cards') {
        sessionsList.innerHTML = sessions.map(renderSessionCardView).join('');
    } else if (mode === 'list') {
        sessionsList.innerHTML = sessions.map(renderSessionListItem).join('');
    } else {
        sessionsList.innerHTML = `
            <table class="sessions-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Type</th>
                        <th>Model</th>
                        <th>Tokens</th>
                        <th>Cost</th>
                        <th>LoC</th>
                        <th>Active</th>
                        <th>Dur</th>
                        <th>Seen</th>
                    </tr>
                </thead>
                <tbody>
                    ${sessions.map(renderSessionCard).join('')}
                </tbody>
            </table>
        `;
    }
}

// Handle teams snapshot/update
function handleTeamsUpdate(teamsData) {
    if (teamsData && typeof teamsData === 'object' && Object.keys(teamsData).length > 0) {
        teamsMap.clear();
        Object.entries(teamsData).forEach(([name, team]) => {
            teamsMap.set(name, team);
        });
    }
    renderTeams();
}

function renderTeamCard(teamName, team) {
    const members = team.members || [];
    const tasks = team.tasks || [];
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const totalTasks = tasks.length;
    const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    let totalCost = 0;
    let totalTokens = 0;
    members.forEach(m => {
        if (m.sessionStats) {
            totalCost += m.sessionStats.totalCost || 0;
            totalTokens += m.sessionStats.totalTokens || 0;
        }
    });

    const membersHtml = members.map(member => {
        const isActive = member.status === 'active';
        const stats = member.sessionStats || {};
        return `<div class="team-member ${isActive ? 'active' : ''}"><span class="member-status"></span><span class="member-name">${escapeHtml(member.name || '??')}</span><span class="member-role">${escapeHtml(member.agentType || 'agent')}</span><span class="member-cost">$${(stats.totalCost || 0).toFixed(2)}</span><span class="member-tokens">${formatNumber(stats.totalTokens || 0)}</span></div>`;
    }).join('');

    const taskListHtml = tasks.slice(0, 3).map(task => {
        const statusIcon = task.status === 'completed' ? '&#10003;' : task.status === 'in_progress' ? '&#9881;' : '&#9675;';
        const statusClass = task.status || 'pending';
        return `<div class="task-item ${statusClass}"><span class="task-status-icon">${statusIcon}</span> ${escapeHtml(task.subject || task.description || 'Untitled')}</div>`;
    }).join('');

    return `
        <div class="team-card">
            <div class="team-card-header">
                <h3>${escapeHtml(teamName)}</h3>
                <div class="team-card-stats">
                    <span>${members.length}m</span>
                    <span class="separator">|</span>
                    <span>$${totalCost.toFixed(2)}</span>
                    <span class="separator">|</span>
                    <span>${formatNumber(totalTokens)} tok</span>
                    ${totalTasks > 0 ? `<span class="separator">|</span><span>${completedTasks}/${totalTasks} tasks</span>` : ''}
                </div>
            </div>
            <div class="team-members">${membersHtml}</div>
            ${totalTasks > 0 ? `
                <div class="task-progress">
                    <div class="task-progress-bar"><div class="task-progress-fill" style="width: ${progressPct}%"></div></div>
                    <span class="task-progress-label">${progressPct}%</span>
                </div>
                <div class="task-list-compact">${taskListHtml}</div>
            ` : ''}
        </div>
    `;
}

function renderTeams() {
    const teamsSection = document.getElementById('teams-section');
    const teamsList = document.getElementById('teams-list');
    const teamsTotal = document.getElementById('teams-total');
    const teamsActiveMembers = document.getElementById('teams-active-members');

    if (teamsMap.size === 0) {
        teamsSection.classList.add('hidden');
        return;
    }

    teamsSection.classList.remove('hidden');
    teamsTotal.textContent = `${teamsMap.size} team${teamsMap.size !== 1 ? 's' : ''}`;

    let activeCount = 0;
    teamsMap.forEach(team => {
        (team.members || []).forEach(m => {
            if (m.status === 'active') activeCount++;
        });
    });
    teamsActiveMembers.textContent = `${activeCount} active`;

    const cards = [];
    teamsMap.forEach((team, name) => {
        cards.push(renderTeamCard(name, team));
    });
    teamsList.innerHTML = cards.join('');
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

        // Only fetch teams via API if WebSocket hasn't provided them yet
        if (teamsMap.size === 0) {
            try {
                const teamsResponse = await fetch('/api/teams');
                const teamsData = await teamsResponse.json();
                handleTeamsUpdate(teamsData);
            } catch (e) {
                console.log('Teams endpoint not available');
            }
        }

        // Fetch OAuth usage
        try {
            const oauthResponse = await fetch('/api/oauth-usage');
            const oauthData = await oauthResponse.json();
            if (oauthData.success !== false) {
                updateOAuthUsageDisplay(oauthData);
            }
        } catch (e) {
            console.log('OAuth usage endpoint not available');
        }

        // Fetch events with timeframe parameter (still using polling for events)
        const eventsResponse = await fetch(`/api/events?timeframe=${timeframe}`);
        const eventsData = await eventsResponse.json();

        updateEvents(eventsData);

        // Fetch all sessions from DB for the timeframe (includes completed team agent sessions)
        // Changefeed only covers active sessions — DB has the full history
        try {
            const sessionsResponse = await fetch(`/api/sessions?timeframe=${timeframe}`);
            const sessionsData = await sessionsResponse.json();
            if (sessionsData.sessions && Array.isArray(sessionsData.sessions)) {
                sessionsData.sessions.forEach(session => {
                    // Only add if not already present (changefeed has fresher data for active sessions)
                    if (!sessionsMap.has(session.sessionId)) {
                        sessionsMap.set(session.sessionId, session);
                    }
                });
                renderSessions();
            }
        } catch (e) {
            console.log('Sessions fetch not available, relying on changefeed');
        }

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

// Team state management
const teamsMap = new Map();

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
        statusIndicator.style.background = '#00e676';
        lastUpdate.textContent = 'WS OK';
    } else if (status === 'disconnected') {
        statusIndicator.style.background = '#ff5252';
        lastUpdate.textContent = 'WS DOWN';
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
      pullRequests: 0,
      commits: 0,
      codeEditAccepts: 0,
      codeEditRejects: 0,
      linesAdded: 0,
      linesRemoved: 0,
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
      aggregated.pullRequests += bucket.pullRequests || 0;
      aggregated.commits += bucket.commits || 0;
      aggregated.codeEditAccepts += bucket.codeEditAccepts || 0;
      aggregated.codeEditRejects += bucket.codeEditRejects || 0;
      aggregated.linesAdded += bucket.linesAdded || 0;
      aggregated.linesRemoved += bucket.linesRemoved || 0;

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
            else if (message.type === 'team_update' || message.type === 'teams_snapshot') {
                handleTeamsUpdate(message.data);
            }
            else if (message.type === 'oauth_usage_update') {
                if (message.data) {
                    updateOAuthUsageDisplay(message.data);
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
            claudeUsageSparklines.fiveHour.update();
        }
        if (claudeUsageSparklines.sevenDay) {
            claudeUsageSparklines.sevenDay.data.labels = [];
            claudeUsageSparklines.sevenDay.data.datasets[0].data = [];
            claudeUsageSparklines.sevenDay.update();
        }
        if (claudeUsageSparklines.sonnet) {
            claudeUsageSparklines.sonnet.data.labels = [];
            claudeUsageSparklines.sonnet.data.datasets[0].data = [];
            claudeUsageSparklines.sonnet.update();
        }
        return;
    }

    const timestamps = historyData.map(d => new Date(d.timestamp));

    // Update 5-hour sparkline
    if (claudeUsageSparklines.fiveHour) {
        claudeUsageSparklines.fiveHour.data.labels = timestamps;
        claudeUsageSparklines.fiveHour.data.datasets[0].data =
            historyData.map(d => d.fiveHour);
        claudeUsageSparklines.fiveHour.update();
    }

    // Update 7-day sparkline
    if (claudeUsageSparklines.sevenDay) {
        claudeUsageSparklines.sevenDay.data.labels = timestamps;
        claudeUsageSparklines.sevenDay.data.datasets[0].data =
            historyData.map(d => d.sevenDay);
        claudeUsageSparklines.sevenDay.update();
    }

    // Update Sonnet sparkline
    if (claudeUsageSparklines.sonnet) {
        claudeUsageSparklines.sonnet.data.labels = timestamps;
        claudeUsageSparklines.sonnet.data.datasets[0].data =
            historyData.map(d => d.sonnet || 0);
        claudeUsageSparklines.sonnet.update();
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

// Update OAuth usage display (from /api/oauth-usage endpoint)
function updateOAuthUsageDisplay(data) {
    // Show usage section
    document.getElementById('claude-usage-section').style.display = 'block';

    // Update 5-hour
    if (data.five_hour) {
        document.getElementById('account-five-hour').textContent = `${data.five_hour.utilization}%`;
        if (data.five_hour.resets_at) {
            const resetsIn = new Date(data.five_hour.resets_at) - Date.now();
            document.getElementById('account-five-hour-reset').textContent = `Resets in ${formatTimeRemaining(resetsIn)}`;
        }
        const pacingEl = document.getElementById('account-five-hour-pacing');
        if (pacingEl && data.five_hour.pacing_target !== undefined) {
            pacingEl.textContent = `Pacing: ${data.five_hour.pacing_target.toFixed(1)}%`;
            pacingEl.className = `pacing-indicator ${data.five_hour.status || 'under'}`;
        }
    }

    // Update 7-day
    if (data.seven_day) {
        document.getElementById('account-seven-day').textContent = `${data.seven_day.utilization}%`;
        if (data.seven_day.resets_at) {
            const resetsIn = new Date(data.seven_day.resets_at) - Date.now();
            document.getElementById('account-seven-day-reset').textContent = `Resets in ${formatTimeRemaining(resetsIn)}`;
        }
        const pacingEl = document.getElementById('account-seven-day-pacing');
        if (pacingEl && data.seven_day.pacing_target !== undefined) {
            pacingEl.textContent = `Pacing: ${data.seven_day.pacing_target.toFixed(1)}%`;
            pacingEl.className = `pacing-indicator ${data.seven_day.status || 'under'}`;
        }
    }

    // Update Opus
    const opusEl = document.getElementById('account-opus');
    if (opusEl) {
        if (data.seven_day_opus) {
            opusEl.textContent = `${data.seven_day_opus.utilization}%`;
            const opusResetEl = document.getElementById('account-opus-reset');
            if (opusResetEl && data.seven_day_opus.resets_at) {
                const resetsIn = new Date(data.seven_day_opus.resets_at) - Date.now();
                opusResetEl.textContent = `Resets in ${formatTimeRemaining(resetsIn)}`;
            }
        } else {
            opusEl.textContent = 'N/A';
        }
    }

    // Update Sonnet
    if (data.seven_day_sonnet) {
        document.getElementById('account-sonnet').textContent = `${data.seven_day_sonnet.utilization}%`;
        if (data.seven_day_sonnet.resets_at) {
            const resetsIn = new Date(data.seven_day_sonnet.resets_at) - Date.now();
            document.getElementById('account-sonnet-reset').textContent = `Resets in ${formatTimeRemaining(resetsIn)}`;
        }
    }

    // Update OAuth status badge
    const oauthBadge = document.getElementById('oauth-status-badge');
    if (oauthBadge) {
        oauthBadge.textContent = 'Connected';
        oauthBadge.className = 'oauth-status-badge active';
    }

    // Update last updated
    document.getElementById('account-last-update').textContent = new Date().toLocaleTimeString();
    updateClaudeStatus('Connected (OAuth)', 'active');
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

// Initialize stat card sparklines
initStatSparklines();

// Initialize theme selector
const themeSelect = document.getElementById('theme-select');
if (themeSelect) {
    themeSelect.addEventListener('change', (e) => {
        ThemeManager.set(e.target.value);
    });
}
ThemeManager.init();

// System Health tracking
const systemHealth = {
    startTime: Date.now(),
    eventTimestamps: [],    // rolling window for rate calc
    totalEvents: 0,
    wsStatus: 'disconnected',

    recordEvent() {
        const now = Date.now();
        this.totalEvents++;
        this.eventTimestamps.push(now);
        // Keep only last 60s of timestamps for rate calculation
        const cutoff = now - 60000;
        while (this.eventTimestamps.length > 0 && this.eventTimestamps[0] < cutoff) {
            this.eventTimestamps.shift();
        }
    },

    getRate() {
        const now = Date.now();
        const cutoff = now - 60000;
        while (this.eventTimestamps.length > 0 && this.eventTimestamps[0] < cutoff) {
            this.eventTimestamps.shift();
        }
        return this.eventTimestamps.length;
    },

    formatUptime() {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        if (elapsed < 60) return elapsed + 's';
        if (elapsed < 3600) return Math.floor(elapsed / 60) + 'm';
        const h = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60);
        return h + 'h' + (m > 0 ? m + 'm' : '');
    },

    update() {
        const uptimeEl = document.getElementById('sys-uptime');
        const wsEl = document.getElementById('sys-ws-status');
        const rateEl = document.getElementById('sys-event-rate');
        const countEl = document.getElementById('sys-event-count');
        const modelsEl = document.getElementById('sys-model-count');

        if (uptimeEl) uptimeEl.textContent = this.formatUptime();
        if (wsEl) {
            const connected = this.wsStatus === 'connected';
            wsEl.textContent = connected ? 'LIVE' : 'DOWN';
            wsEl.className = 'val ' + (connected ? 'green' : 'red');
        }
        if (rateEl) rateEl.textContent = this.getRate() + '/m';
        if (countEl) countEl.textContent = this.totalEvents.toLocaleString();
        if (modelsEl) {
            // Count unique models from sessions
            const models = new Set();
            sessionsMap.forEach(s => {
                if (s.models) {
                    Object.keys(s.models).forEach(m => models.add(m));
                }
            });
            modelsEl.textContent = models.size;
        }
    }
};

// Update system health every second
setInterval(() => systemHealth.update(), 1000);

// Patch updateWebSocketStatus to feed systemHealth
const _origUpdateWsStatus = updateWebSocketStatus;
updateWebSocketStatus = function(status) {
    systemHealth.wsStatus = status;
    _origUpdateWsStatus(status);
};

// Patch handleWebSocketUpdate to count events
const _origHandleWsUpdate = handleWebSocketUpdate;
handleWebSocketUpdate = function() {
    systemHealth.recordEvent();
    _origHandleWsUpdate();
};

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
            // Re-fetch sessions from DB for the new timeframe
            try {
                sessionsMap.clear();
                const resp = await fetch(`/api/sessions?timeframe=${newTimeframe}`);
                const data = await resp.json();
                if (data.sessions) {
                    data.sessions.forEach(s => sessionsMap.set(s.sessionId, s));
                }
                renderSessions();
            } catch (e) {
                console.log('Session re-fetch failed:', e);
            }
        } else {
            // Use polling approach - fetch from server
            await fetchData();
        }

        console.log(`📅 Data timeframe changed to: ${newTimeframe}`);
    });
}

