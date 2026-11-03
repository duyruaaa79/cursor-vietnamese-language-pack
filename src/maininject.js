'use strict';

// macOS: translates Cursor's own UI without modifying Cursor.app and without restarting it.
// SIGUSR1 makes Cursor's main process open its Node inspector on 127.0.0.1:9229; we install a
// hook that runs the translator in every window (current and future), then close the
// inspector again right away.

const { execFileSync } = require('child_process');
const { payload } = require('./translator');

const INSPECTOR_PORT = 9229;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Runs inside Cursor's main process.
function installer(source) {
	const req = process.getBuiltinModule('module').createRequire(process.execPath);
	const { app, webContents } = req('electron');
	const isWorkbench = wc => !wc.isDestroyed() && /^vscode-file:\/\/vscode-app\/.*\.html/.test(wc.getURL());
	const existing = globalThis.__cursorViMain;
	if (existing) {
		existing.source = source;
		webContents.getAllWebContents().filter(isWorkbench).forEach(existing.inject);
		return 'updated';
	}
	const state = {
		source,
		inject(wc) {
			if (isWorkbench(wc)) {
				wc.executeJavaScript(state.source).catch(() => { });
			}
		},
	};
	const hook = wc => wc.on('dom-ready', () => state.inject(wc));
	globalThis.__cursorViMain = state;
	webContents.getAllWebContents().forEach(wc => {
		hook(wc);
		state.inject(wc);
	});
	app.on('web-contents-created', (_e, wc) => hook(wc));
	return 'installed';
}

// The Cursor app process has no arguments or only flags; the same binary run in Node mode
// (this agent, the `cursor` CLI) gets a script path as its first argument.
function cursorMainPids(executable = '/Applications/Cursor.app/Contents/MacOS/Cursor') {
	const out = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
	return out.split('\n')
		.map(l => /^\s*(\d+)\s+(.*)$/.exec(l))
		.filter(m => m && (m[2] === executable || m[2].startsWith(executable + ' -')))
		.map(m => Number(m[1]))
		.filter(pid => pid !== process.pid);
}

async function inspectorUrl() {
	for (let i = 0; i < 40; i++) {
		try {
			const res = await fetch(`http://127.0.0.1:${INSPECTOR_PORT}/json/list`);
			const [target] = await res.json();
			if (target && target.webSocketDebuggerUrl) {
				return target.webSocketDebuggerUrl;
			}
		} catch {
			// inspector not listening yet
		}
		await sleep(100);
	}
	throw new Error('Cursor inspector did not start');
}

function rpc(url) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		let nextId = 0;
		const pending = new Map();
		ws.addEventListener('message', e => {
			const msg = JSON.parse(e.data);
			if (pending.has(msg.id)) {
				pending.get(msg.id)(msg);
				pending.delete(msg.id);
			}
		});
		ws.addEventListener('error', () => reject(new Error('cannot connect to Cursor inspector')), { once: true });
		ws.addEventListener('open', () => resolve({
			evaluate(expression) {
				return new Promise(res => {
					const id = ++nextId;
					pending.set(id, msg => res(msg.result && msg.result.result ? msg.result.result.value : undefined));
					ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
				});
			},
			close: () => ws.close(),
		}), { once: true });
	});
}

// Installs or refreshes the translator in the Cursor main process `mainPid`.
async function inject({ mainPid, dict, signature, log = () => { } }) {
	process.kill(mainPid, 'SIGUSR1');
	const client = await rpc(await inspectorUrl());
	try {
		const pid = await client.evaluate('process.pid');
		if (pid !== mainPid) {
			throw new Error(`port ${INSPECTOR_PORT} belongs to another process (${pid})`);
		}
		try {
			const source = payload(dict, signature);
			const result = await client.evaluate(`(${installer.toString()})(${JSON.stringify(source)})`);
			log(`translator ${result} in Cursor ${mainPid}`);
			return result;
		} finally {
			await client.evaluate(`setTimeout(() => process.getBuiltinModule('inspector').close(), 50), 0`);
		}
	} finally {
		client.close();
	}
}

module.exports = { inject, cursorMainPids, rpc, inspectorUrl, INSPECTOR_PORT };
