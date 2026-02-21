const EventEmitter = require('events');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const POLL_INTERVAL_MS = 5000;
const SESSION_TIME_TOLERANCE_MS = 30000;

class TeamWatcher extends EventEmitter {
  constructor() {
    super();
    this.teams = new Map();
    this.sessionToTeam = new Map();
    this.pollTimer = null;
    this.teamsDir = path.join(os.homedir(), '.claude', 'teams');
    this.tasksDir = path.join(os.homedir(), '.claude', 'tasks');
    this.previousTeamState = null;
  }

  async start() {
    await this._scan();
    this.pollTimer = setInterval(() => this._scan(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getTeams() {
    return this.teams;
  }

  correlateSession(sessionId, startTime) {
    // Check if already linked
    const existing = this.sessionToTeam.get(sessionId);
    if (existing) {
      return existing;
    }

    for (const [teamName, team] of this.teams) {
      // Check lead session ID
      if (team.leadSessionId === sessionId) {
        const info = { teamName, memberName: team.leadName || 'lead' };
        this.sessionToTeam.set(sessionId, info);
        return info;
      }

      // Check members by time-based heuristic
      if (startTime && team.members) {
        for (const member of team.members) {
          if (member.joinedAt) {
            const joinedAt = new Date(member.joinedAt).getTime();
            const sessionStart = new Date(startTime).getTime();
            if (Math.abs(joinedAt - sessionStart) <= SESSION_TIME_TOLERANCE_MS) {
              const info = { teamName, memberName: member.name };
              this.sessionToTeam.set(sessionId, info);
              return info;
            }
          }
        }
      }
    }

    return null;
  }

  getSessionTeamInfo(sessionId) {
    return this.sessionToTeam.get(sessionId) || null;
  }

  linkSession(sessionId, teamName, memberName) {
    this.sessionToTeam.set(sessionId, { teamName, memberName });
  }

  async _scan() {
    const newTeams = new Map();

    try {
      await fsp.access(this.teamsDir);
    } catch {
      // Teams directory doesn't exist, clear teams and check for changes
      if (this.teams.size > 0) {
        this.teams = newTeams;
        this._emitIfChanged(newTeams);
      }
      return;
    }

    let teamDirs;
    try {
      teamDirs = await fsp.readdir(this.teamsDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of teamDirs) {
      if (!entry.isDirectory()) continue;

      const teamName = entry.name;
      const configPath = path.join(this.teamsDir, teamName, 'config.json');

      let config;
      try {
        const raw = await fsp.readFile(configPath, 'utf-8');
        config = JSON.parse(raw);
      } catch {
        continue;
      }

      // Read tasks for this team
      const tasks = await this._readTasks(teamName);

      newTeams.set(teamName, {
        name: config.name || teamName,
        leadName: config.leadName || null,
        leadSessionId: config.leadSessionId || null,
        members: Array.isArray(config.members) ? config.members : [],
        tasks,
        createdAt: config.createdAt || null,
        ...config
      });
    }

    this.teams = newTeams;
    this._emitIfChanged(newTeams);
  }

  async _readTasks(teamName) {
    const tasksPath = path.join(this.tasksDir, teamName);
    const tasks = [];

    try {
      await fsp.access(tasksPath);
    } catch {
      return tasks;
    }

    let files;
    try {
      files = await fsp.readdir(tasksPath);
    } catch {
      return tasks;
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const raw = await fsp.readFile(path.join(tasksPath, file), 'utf-8');
        const task = JSON.parse(raw);
        tasks.push({
          id: task.id || path.basename(file, '.json'),
          subject: task.subject || null,
          status: task.status || 'pending',
          owner: task.owner || null,
          ...task
        });
      } catch {
        continue;
      }
    }

    return tasks;
  }

  _emitIfChanged(newTeams) {
    const newState = this._serializeTeams(newTeams);
    if (newState !== this.previousTeamState) {
      this.previousTeamState = newState;
      this.emit('team_change', newTeams);
    }
  }

  _serializeTeams(teams) {
    const obj = {};
    for (const [key, value] of teams) {
      obj[key] = value;
    }
    return JSON.stringify(obj);
  }
}

module.exports = TeamWatcher;
