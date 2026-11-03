'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const REMOTE_URL = 'https://raw.githubusercontent.com/duyruaaa79/cursor-vietnamese-language-pack/main/dist/dict.json';
const REFRESH_MS = 24 * 60 * 60 * 1000;

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return undefined;
	}
}

function isDict(value) {
	return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 1000;
}

// Bundled dictionary overlaid with the last downloaded one (newer translations win).
function load(extensionRoot, stateDir) {
	const bundled = readJson(path.join(extensionRoot, 'dist', 'dict.json')) || {};
	const remote = readJson(path.join(stateDir, 'dict.json'));
	return isDict(remote) ? { ...bundled, ...remote } : bundled;
}

function fetchText(url) {
	return new Promise((resolve, reject) => {
		https.get(url, { timeout: 20000 }, res => {
			if (res.statusCode !== 200) {
				res.resume();
				reject(new Error(`HTTP ${res.statusCode}`));
				return;
			}
			const chunks = [];
			res.on('data', c => chunks.push(c));
			res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		}).on('error', reject).on('timeout', function () {
			this.destroy(new Error('timeout'));
		});
	});
}

// Downloads the latest dictionary at most once a day. Returns true when it changed.
async function refresh(stateDir) {
	const target = path.join(stateDir, 'dict.json');
	const stampFile = path.join(stateDir, 'dict.checked');
	const last = Number(readJson(stampFile)) || 0;
	if (Date.now() - last < REFRESH_MS) {
		return false;
	}
	const text = await fetchText(REMOTE_URL);
	const parsed = JSON.parse(text);
	fs.mkdirSync(stateDir, { recursive: true });
	fs.writeFileSync(stampFile, JSON.stringify(Date.now()));
	if (!isDict(parsed)) {
		return false;
	}
	const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
	if (previous === text) {
		return false;
	}
	fs.writeFileSync(target, text);
	return true;
}

module.exports = { load, refresh };
