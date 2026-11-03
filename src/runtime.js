'use strict';

// Translates Cursor's own UI at runtime on macOS, where patching Cursor.app gets it killed.
// Cursor is started with --remote-debugging-port=0 (random port, loopback only) and the
// extension injects the translator into every workbench window over the DevTools protocol.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { payload } = require('./translator');

const PAGE_URL_RE = /^vscode-file:\/\/vscode-app\/.*\.html/;
const FLAG = '--remote-debugging-port=0';

function activePort(userDataDir) {
	try {
		const [port, wsPath] = fs.readFileSync(path.join(userDataDir, 'DevToolsActivePort'), 'utf8').split('\n');
		return port && wsPath ? { port: Number(port), wsPath } : undefined;
	} catch {
		return undefined;
	}
}

function connect({ port, wsPath }) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
		let nextId = 0;
		const pending = new Map();
		const handlers = [];
		const client = {
			send(method, params = {}, sessionId) {
				return new Promise(res => {
					const id = ++nextId;
					pending.set(id, res);
					ws.send(JSON.stringify({ id, method, params, sessionId }));
				});
			},
			on(handler) {
				handlers.push(handler);
			},
			close() {
				ws.close();
			},
			closed: new Promise(res => ws.addEventListener('close', res)),
		};
		ws.addEventListener('open', () => resolve(client), { once: true });
		ws.addEventListener('error', () => reject(new Error('cannot connect to Cursor DevTools port')), { once: true });
		ws.addEventListener('message', e => {
			const msg = JSON.parse(e.data);
			if (msg.id !== undefined && pending.has(msg.id)) {
				pending.get(msg.id)(msg);
				pending.delete(msg.id);
			} else if (msg.method) {
				handlers.forEach(h => h(msg));
			}
		});
	});
}

// Connects to the running Cursor and keeps every workbench window translated.
// Resolves to undefined when Cursor was not started with the DevTools flag.
async function start({ userDataDir, dict, log = () => { } }) {
	const info = activePort(userDataDir);
	if (!info) {
		return undefined;
	}
	let cdp;
	try {
		cdp = await connect(info);
	} catch {
		return undefined;
	}
	const signature = crypto.createHash('sha256').update(JSON.stringify(dict)).digest('hex').slice(0, 16);
	const source = payload(dict, signature);
	const handled = new Set();

	const inject = async target => {
		if (target.type !== 'page' || !PAGE_URL_RE.test(target.url) || handled.has(target.targetId)) {
			return;
		}
		handled.add(target.targetId);
		const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
		const sessionId = attached.result && attached.result.sessionId;
		if (!sessionId) {
			handled.delete(target.targetId);
			return;
		}
		await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source }, sessionId);
		const r = await cdp.send('Runtime.evaluate', { expression: source }, sessionId);
		if (r.result && r.result.exceptionDetails) {
			log(`translator error in ${target.url}: ${r.result.exceptionDetails.text}`);
		}
	};
	cdp.on(msg => {
		if (msg.method === 'Target.targetCreated' || msg.method === 'Target.targetInfoChanged') {
			inject(msg.params.targetInfo).catch(err => log(`inject failed: ${err.message}`));
		} else if (msg.method === 'Target.targetDestroyed') {
			handled.delete(msg.params.targetId);
		}
	});
	const r = await cdp.send('Target.setDiscoverTargets', { discover: true });
	if (r.error) {
		cdp.close();
		throw new Error(r.error.message);
	}
	return cdp;
}

function cursorAppPath(appRoot) {
	return path.resolve(appRoot, '..', '..', '..');
}

// Quits this Cursor and starts it again with the DevTools flag once the old process is gone.
function relaunch({ appRoot, mainPid, quit }) {
	const app = cursorAppPath(appRoot);
	const script = `i=0; while kill -0 ${Number(mainPid)} 2>/dev/null && [ $i -lt 120 ]; do sleep 0.5; i=$((i+1)); done; sleep 1; open -a "${app}" --args ${FLAG}`;
	spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
	return quit();
}

const LEGACY_LAUNCHER = path.join(os.homedir(), 'Applications', 'Cursor Tiếng Việt.app');

// Version 0.4.0 created a separate launcher app; Cursor is now relaunched in place instead.
function removeLegacyLauncher() {
	fs.rmSync(LEGACY_LAUNCHER, { recursive: true, force: true });
}

// Lets exactly one window of this Cursor process trigger the relaunch, and refuses when a
// relaunch happened moments ago (Cursor came back without the flag), so it can never loop.
function claimRelaunch(stateDir, mainPid) {
	fs.mkdirSync(stateDir, { recursive: true });
	const last = path.join(stateDir, 'relaunch-last');
	try {
		if (Date.now() - fs.statSync(last).mtimeMs < 90_000) {
			return false;
		}
	} catch {
		// never relaunched before
	}
	try {
		fs.writeFileSync(path.join(stateDir, `relaunch-${mainPid}`), '', { flag: 'wx' });
	} catch {
		return false;
	}
	for (const name of fs.readdirSync(stateDir)) {
		if (/^relaunch-\d+$/.test(name) && name !== `relaunch-${mainPid}`) {
			fs.rmSync(path.join(stateDir, name), { force: true });
		}
	}
	fs.writeFileSync(last, String(mainPid));
	return true;
}

module.exports = { start, relaunch, claimRelaunch, removeLegacyLauncher, activePort };
