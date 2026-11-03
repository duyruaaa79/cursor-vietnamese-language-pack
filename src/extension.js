'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const patcher = require('./patcher');
const langpack = require('./langpack');
const dictionary = require('./dictionary');
const runtime = require('./runtime');

let output;

function log(message) {
	output.appendLine(`[${new Date().toISOString()}] ${message}`);
}

function config() {
	return vscode.workspace.getConfiguration('cursorVietnamese');
}

function userDataDir(context) {
	return path.resolve(context.globalStorageUri.fsPath, '..', '..', '..');
}

function commitOf(appRoot) {
	return JSON.parse(fs.readFileSync(path.join(appRoot, 'product.json'), 'utf8')).commit || 'unknown';
}

// Patches Cursor's own UI and resyncs the language pack. Returns true if a restart is needed.
function localize(context) {
	const appRoot = vscode.env.appRoot;
	const dict = dictionary.load(context.extensionPath, patcher.stateDir());
	let restartNeeded = false;

	if (langpack.sync({ appRoot, extensionRoot: context.extensionPath, dict })) {
		langpack.clearCache(userDataDir(context), commitOf(appRoot));
		log('language pack translations regenerated');
		restartNeeded = true;
	}

	const result = patcher.apply({ appRoot, dict, log });
	for (const r of result.results) {
		if (r.status === 'error') {
			log(`error in ${r.file}: ${r.error}`);
		}
	}
	return restartNeeded || result.changed;
}

async function promptRestart() {
	const quit = 'Thoát Cursor';
	const choice = await vscode.window.showInformationMessage(
		'Đã cập nhật bản Việt hóa cho Cursor. Thoát hẳn và mở lại Cursor để áp dụng.',
		quit,
		'Để sau'
	);
	if (choice === quit) {
		await vscode.commands.executeCommand('workbench.action.quit');
	}
}

function reportError(err) {
	log(`failed: ${err && err.stack || err}`);
	const permission = err && (err.code === 'EACCES' || err.code === 'EPERM');
	vscode.window.showErrorMessage(permission
		? 'Không có quyền ghi vào thư mục cài đặt Cursor nên chưa Việt hóa được giao diện riêng của Cursor. Xem nhật ký trong Output › Cursor Vietnamese.'
		: `Việt hóa giao diện Cursor thất bại: ${err && err.message || err}`);
}

async function runAutomatic(context) {
	try {
		if (patcher.bundlePatchingBlocked()) {
			if (patcher.status({ appRoot: vscode.env.appRoot }).some(s => s.patched)) {
				const restored = patcher.restore({ appRoot: vscode.env.appRoot });
				log(`restored files patched by an older version: ${restored.join(', ')}`);
			}
			runtime.removeLegacyLauncher();
			if (await startRuntime(context) === 'relaunching') {
				return;
			}
		}
		if (config().get('autoUpdateDictionary', true)) {
			try {
				if (await dictionary.refresh(patcher.stateDir())) {
					log('downloaded a newer dictionary');
				}
			} catch (err) {
				log(`dictionary update skipped: ${err.message}`);
			}
		}
		if (patcher.bundlePatchingBlocked()) {
			if (localize(context)) {
				await promptRestart();
			}
		} else if (patcher.isDisabled()) {
			log('auto patch disabled by the rescue script; run "Việt hóa giao diện Cursor" to enable again');
		} else if (config().get('autoPatch', true) && localize(context)) {
			await promptRestart();
		}
	} catch (err) {
		reportError(err);
	}
}

function relaunchFull() {
	return runtime.relaunch({
		appRoot: vscode.env.appRoot,
		mainPid: process.ppid,
		quit: () => vscode.commands.executeCommand('workbench.action.quit'),
	});
}

// macOS only: translates Cursor's own UI in the running windows. When Cursor was opened
// without the DevTools flag, restarts it once with the flag (automatic unless `manual`).
// Returns 'connected', 'relaunching' or 'off'.
async function startRuntime(context, { manual = false } = {}) {
	if (!config().get('runtimeTranslate', true)) {
		return 'off';
	}
	const dict = dictionary.load(context.extensionPath, patcher.stateDir());
	const cdp = await runtime.start({ userDataDir: userDataDir(context), dict, log });
	if (cdp) {
		log('runtime translator connected');
		context.subscriptions.push({ dispose: () => cdp.close() });
		return 'connected';
	}
	if (manual || runtime.claimRelaunch(patcher.stateDir(), process.ppid)) {
		log('restarting Cursor with the DevTools flag');
		await relaunchFull();
		return 'relaunching';
	}
	return 'off';
}

function activate(context) {
	output = vscode.window.createOutputChannel('Cursor Vietnamese');
	context.subscriptions.push(output);

	context.subscriptions.push(
		vscode.commands.registerCommand('cursorVietnamese.apply', async () => {
			try {
				fs.rmSync(path.join(patcher.stateDir(), 'disabled'), { force: true });
				if (patcher.bundlePatchingBlocked()) {
					const restart = localize(context);
					await config().update('runtimeTranslate', true, vscode.ConfigurationTarget.Global);
					if (await startRuntime(context, { manual: true }) !== 'connected') {
						return;
					}
					if (restart) {
						await promptRestart();
					} else {
						vscode.window.showInformationMessage('Giao diện Cursor đã được Việt hóa với bản dịch mới nhất.');
					}
				} else if (localize(context)) {
					await promptRestart();
				} else {
					vscode.window.showInformationMessage('Giao diện Cursor đã được Việt hóa với bản dịch mới nhất.');
				}
			} catch (err) {
				reportError(err);
			}
		}),
		vscode.commands.registerCommand('cursorVietnamese.restore', async () => {
			try {
				const restored = patcher.restore({ appRoot: vscode.env.appRoot });
				await config().update('autoPatch', false, vscode.ConfigurationTarget.Global);
				log(`restored: ${restored.join(', ') || 'nothing'}`);
				vscode.window.showInformationMessage(
					'Đã khôi phục giao diện gốc của Cursor và tắt tự động Việt hóa. Thoát và mở lại Cursor để áp dụng.'
				);
			} catch (err) {
				reportError(err);
			}
		}),
		vscode.commands.registerCommand('cursorVietnamese.relaunch', () => relaunchFull()),
		vscode.commands.registerCommand('cursorVietnamese.status', () => {
			const lines = patcher.status({ appRoot: vscode.env.appRoot })
				.map(s => `${s.file}: ${s.missing ? 'không có' : s.patched ? 'đã Việt hóa' : 'chưa Việt hóa'}`);
			output.show(true);
			lines.forEach(l => log(l));
		})
	);

	setTimeout(() => runAutomatic(context), patcher.bundlePatchingBlocked() ? 0 : 3000);
}

function deactivate() { }

module.exports = { activate, deactivate };
