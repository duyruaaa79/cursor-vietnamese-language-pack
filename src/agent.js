'use strict';

// macOS background job: whenever Cursor starts (it creates a new folder under its logs
// directory), launchd runs this file with Cursor's own binary in Node mode, and it installs
// the translator into the new Cursor process. The extension keeps the files below up to date.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { inject, cursorMainPids } = require('./maininject');

const RUNTIME_DIR = path.join(os.homedir(), '.cursor-vietnamese', 'runtime');
const LABEL = 'vn.duy.cursor-vietnamese';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const RUNTIME_FILES = ['agent.js', 'maininject.js', 'translator.js'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function executableOf(appRoot) {
	return path.resolve(appRoot, '..', '..', 'MacOS', 'Cursor');
}

function writeIfChanged(file, text, mode = 0o644) {
	if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) {
		return false;
	}
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text, { mode });
	return true;
}

function xml(s) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function plist(executable) {
	const logsDir = path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'logs');
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${xml(executable)}</string>
		<string>${xml(path.join(RUNTIME_DIR, 'agent.js'))}</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict><key>ELECTRON_RUN_AS_NODE</key><string>1</string></dict>
	<key>WatchPaths</key>
	<array><string>${xml(logsDir)}</string></array>
	<key>RunAtLoad</key><true/>
	<key>ThrottleInterval</key><integer>5</integer>
	<key>StandardOutPath</key><string>${xml(path.join(RUNTIME_DIR, 'agent.log'))}</string>
	<key>StandardErrorPath</key><string>${xml(path.join(RUNTIME_DIR, 'agent.log'))}</string>
</dict>
</plist>
`;
}

function launchctl(...args) {
	try {
		execFileSync('/bin/launchctl', args, { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

// Copies the runtime next to the merged dictionary and (re)loads the launchd job.
function install({ appRoot, dict }) {
	for (const name of RUNTIME_FILES) {
		writeIfChanged(path.join(RUNTIME_DIR, name), fs.readFileSync(path.join(__dirname, name), 'utf8'));
	}
	writeIfChanged(path.join(RUNTIME_DIR, 'dict.json'), JSON.stringify(dict));
	const domain = `gui/${process.getuid()}`;
	if (writeIfChanged(PLIST, plist(executableOf(appRoot))) || !launchctl('print', `${domain}/${LABEL}`)) {
		launchctl('bootout', `${domain}/${LABEL}`);
		launchctl('bootstrap', domain, PLIST);
	}
}

function uninstall() {
	launchctl('bootout', `gui/${process.getuid()}/${LABEL}`);
	fs.rmSync(PLIST, { force: true });
}

// Installs the translator into every running Cursor that does not have the current
// dictionary yet. `pids` limits it to specific main processes.
async function run({ executable = '/Applications/Cursor.app/Contents/MacOS/Cursor', pids, delay = 3000, log = console.log } = {}) {
	const running = cursorMainPids(executable);
	const targets = pids ? pids.filter(p => running.includes(p)) : running;
	const stateFile = path.join(RUNTIME_DIR, 'state.json');
	let state = {};
	try {
		state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
	} catch {
		// first run
	}
	const text = fs.readFileSync(path.join(RUNTIME_DIR, 'dict.json'), 'utf8');
	const signature = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
	const todo = targets.filter(p => state[p] !== signature);
	if (!todo.length) {
		return [];
	}
	await sleep(delay);
	const dict = JSON.parse(text);
	const done = [];
	for (const pid of todo) {
		try {
			await inject({ mainPid: pid, dict, signature, log });
			state[pid] = signature;
			done.push(pid);
		} catch (err) {
			log(`Cursor ${pid}: ${err.message}`);
		}
	}
	const next = {};
	for (const pid of cursorMainPids(executable)) {
		if (state[pid]) {
			next[pid] = state[pid];
		}
	}
	fs.writeFileSync(stateFile, JSON.stringify(next));
	return done;
}

if (require.main === module) {
	run({ executable: process.execPath, log: m => console.log(`[${new Date().toISOString()}] ${m}`) }).catch(err => {
		console.log(`[${new Date().toISOString()}] ${err.stack || err}`);
	});
}

module.exports = { install, uninstall, run, executableOf, RUNTIME_DIR };
