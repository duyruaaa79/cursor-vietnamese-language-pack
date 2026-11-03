#!/usr/bin/env node
'use strict';

// Usage: node bin/cli.js <apply|restore|status|extract> [--app <Cursor app root>] [--force-unsafe]

const fs = require('fs');
const path = require('path');
const patcher = require('../src/patcher');
const langpack = require('../src/langpack');
const dictionary = require('../src/dictionary');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const command = args[0];
const appIdx = args.indexOf('--app');
const appRoot = appIdx !== -1 ? args[appIdx + 1] : patcher.defaultAppRoot();

function main() {
	switch (command) {
		case 'apply': {
			const dict = dictionary.load(ROOT, patcher.stateDir());
			const result = patcher.apply({ appRoot, dict, log: m => console.log(m), force: args.includes('--force-unsafe') });
			console.log(JSON.stringify(result, null, 2));
			break;
		}
		case 'sync-langpack': {
			const extensionRoot = args[1];
			const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'dict.json'), 'utf8'));
			console.log(langpack.sync({ appRoot, extensionRoot, dict }) ? 'changed' : 'unchanged');
			break;
		}
		case 'restore':
			console.log('restored:', patcher.restore({ appRoot }));
			break;
		case 'status':
			console.log(JSON.stringify(patcher.status({ appRoot }), null, 2));
			break;
		case 'extract': {
			const out = args[1] || 'tmp/cursor_ui_all.json';
			const strings = patcher.extract({ appRoot });
			fs.writeFileSync(out, JSON.stringify(strings, null, 1));
			console.log(`${strings.length} strings -> ${out}`);
			break;
		}
		default:
			console.error('usage: node bin/cli.js <apply|restore|status|extract|sync-langpack> [--app <path>]');
			process.exit(1);
	}
}

main();
