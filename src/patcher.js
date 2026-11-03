'use strict';

// Localizes UI strings that Cursor hardcodes in its workbench bundles (Cursor Settings,
// Agents Window, chat) and keeps the language pack in sync with the installed Cursor.
// Only string literals in display-only positions are replaced, never ids or logic values.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PATCHER_VERSION = '1';

const TARGET_FILES = [
	'vs/workbench/workbench.desktop.main.js',
	'vs/workbench/workbench.glass.main.js',
];

const UI_KEYS = [
	'label', 'title', 'description', 'markdownDescription', 'settingsDescription', 'message',
	'placeholder', 'placeHolder', 'tooltip', 'hoverTooltip', 'tooltipLabel', 'ariaLabel',
	'"aria-label"', 'accessibleLabel', 'children', 'detail', 'subtitle', 'hintText',
	'secondaryText', 'emptyMessage', 'buttonText', 'primaryButton', 'cancelButton',
	'confirmLabel', 'dismissLabel', 'actionLabel', 'trayLabel', 'pillTitle', 'waitText',
	'failedLabel', 'runningLabel', 'doneLabel', 'changedLabel', 'nowLabel', 'heading',
	'header', 'caption',
];

// Flat lookup objects identified by one entry they contain; every value in them is a label.
const ANCHOR_ENTRIES = ['"plan-usage":"Plan & Usage"'];

const STR = '"((?:[^"\\\\\\n]|\\\\.)*)"';
const KEY_RE = new RegExp(`([{,]\\s*)(${UI_KEYS.join('|')})(\\s*:\\s*)${STR}`, 'g');
const ACTION_TITLE_RE = new RegExp(`(title\\s*:\\s*\\{\\s*value\\s*:\\s*)${STR}`, 'g');
const CHILDREN_ARRAY_RE = /children\s*:\s*\[/g;
const PAIR_RE = new RegExp(`((?:[\\w$]+|${STR})\\s*:\\s*)${STR}`, 'g');
const PROMPTISH_RE = /\b(you are|the user|assistant|system prompt|must not|tool call)\b/i;

function decode(raw) {
	try {
		return JSON.parse(`"${raw}"`);
	} catch {
		return undefined;
	}
}

function encode(value) {
	return JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function isDisplayText(value, key) {
	if (!value || value.length > 400 || !/[A-Za-z]{2}/.test(value)) {
		return false;
	}
	if (/^[\w.\-/:#@$]+$/.test(value) && !/^[A-Z][a-z]/.test(value)) {
		return false;
	}
	if (/^(https?:|vs\/|\$\(|codicon)/.test(value)) {
		return false;
	}
	if ((key === 'description' || key === 'message') && PROMPTISH_RE.test(value)) {
		return false;
	}
	return true;
}

// Returns [start, end) of each top-level string element inside a `children:[...]` array.
function childrenStrings(src, openIdx) {
	const out = [];
	let depth = 0;
	let prevSignificant = '[';
	for (let i = openIdx + 1, limit = Math.min(src.length, openIdx + 8000); i < limit; i++) {
		const ch = src[i];
		if (ch === '"' || ch === '\'' || ch === '`') {
			const start = i;
			for (i++; i < limit && src[i] !== ch; i++) {
				if (src[i] === '\\') {
					i++;
				}
			}
			if (ch === '"' && depth === 0 && (prevSignificant === '[' || prevSignificant === ',')) {
				let j = i + 1;
				while (/\s/.test(src[j])) {
					j++;
				}
				if (src[j] === ',' || src[j] === ']') {
					out.push([start, i + 1]);
				}
			}
			prevSignificant = ch;
			continue;
		}
		if ('([{'.includes(ch)) {
			depth++;
		} else if (')]}'.includes(ch)) {
			if (depth === 0) {
				break;
			}
			depth--;
		}
		if (!/\s/.test(ch)) {
			prevSignificant = ch;
		}
	}
	return out;
}

function anchorSpans(src) {
	const spans = [];
	for (const anchor of ANCHOR_ENTRIES) {
		let idx = src.indexOf(anchor);
		while (idx !== -1) {
			const start = src.lastIndexOf('{', idx);
			const end = src.indexOf('}', idx);
			if (start !== -1 && end !== -1) {
				spans.push([start, end + 1]);
			}
			idx = src.indexOf(anchor, idx + anchor.length);
		}
	}
	return spans;
}

// Collects every replaceable literal as {start, end, value} (start/end cover the quotes).
function findLiterals(src) {
	const found = new Map();
	const add = (start, end, raw, key) => {
		const value = decode(raw);
		if (value !== undefined && isDisplayText(value, key)) {
			found.set(start, { start, end, value });
		}
	};
	for (const m of src.matchAll(KEY_RE)) {
		const start = m.index + m[1].length + m[2].length + m[3].length;
		add(start, start + m[4].length + 2, m[4], m[2]);
	}
	for (const m of src.matchAll(ACTION_TITLE_RE)) {
		const start = m.index + m[1].length;
		add(start, start + m[2].length + 2, m[2], 'title');
	}
	for (const m of src.matchAll(CHILDREN_ARRAY_RE)) {
		for (const [s, e] of childrenStrings(src, m.index + m[0].length - 1)) {
			add(s, e, src.slice(s + 1, e - 1), 'children');
		}
	}
	for (const [s, e] of anchorSpans(src)) {
		const body = src.slice(s, e);
		for (const m of body.matchAll(PAIR_RE)) {
			const start = s + m.index + m[1].length;
			add(start, start + m[3].length + 2, m[3], 'label');
		}
	}
	return [...found.values()].sort((a, b) => a.start - b.start);
}

function patchSource(src, dict) {
	const parts = [];
	let last = 0;
	let count = 0;
	for (const lit of findLiterals(src)) {
		const vi = dict[lit.value];
		if (typeof vi !== 'string' || vi === lit.value || lit.start < last) {
			continue;
		}
		parts.push(src.slice(last, lit.start), encode(vi));
		last = lit.end;
		count++;
	}
	parts.push(src.slice(last));
	return { text: parts.join(''), count };
}

function sha256(data) {
	return crypto.createHash('sha256').update(data).digest();
}

function checksum(buf) {
	return sha256(buf).toString('base64').replace(/=+$/, '');
}

function writeAtomic(file, data) {
	const tmp = `${file}.cursor-vi-tmp`;
	fs.writeFileSync(tmp, data);
	fs.renameSync(tmp, file);
}

function stateDir() {
	return path.join(os.homedir(), '.cursor-vietnamese');
}

function defaultAppRoot() {
	if (process.platform === 'darwin') {
		return '/Applications/Cursor.app/Contents/Resources/app';
	}
	if (process.platform === 'win32') {
		return path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor', 'resources', 'app');
	}
	return '/usr/share/cursor/resources/app';
}

function marker(signature) {
	return `\n/*cursor-vi:${signature}*/\n`;
}

function readMarker(text) {
	const m = /\n\/\*cursor-vi:([0-9a-f]+)\*\/\n$/.exec(text.slice(-120));
	return m ? m[1] : undefined;
}

// Applies the patch for the installed Cursor. Safe to call repeatedly: files already
// patched with the same dictionary are left alone.
function apply({ appRoot = defaultAppRoot(), dict, log = () => { } }) {
	const productPath = path.join(appRoot, 'product.json');
	const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
	const commit = product.commit || 'unknown';
	const signature = sha256(PATCHER_VERSION + JSON.stringify(dict)).toString('hex').slice(0, 16);
	const backupRoot = path.join(stateDir(), 'backup', commit);
	const results = [];
	let changed = false;

	for (const rel of TARGET_FILES) {
		const file = path.join(appRoot, 'out', rel);
		if (!fs.existsSync(file)) {
			continue;
		}
		const current = fs.readFileSync(file, 'utf8');
		const existing = readMarker(current);
		if (existing === signature) {
			results.push({ file: rel, status: 'up-to-date' });
			continue;
		}
		const backup = path.join(backupRoot, rel);
		let pristine;
		if (existing === undefined) {
			pristine = current;
			fs.mkdirSync(path.dirname(backup), { recursive: true });
			fs.writeFileSync(backup, pristine);
		} else if (fs.existsSync(backup)) {
			pristine = fs.readFileSync(backup, 'utf8');
		} else {
			results.push({ file: rel, status: 'error', error: 'patched by an older dictionary but no backup found' });
			continue;
		}
		const { text, count } = patchSource(pristine, dict);
		const out = Buffer.from(text + marker(signature), 'utf8');
		writeAtomic(file, out);
		if (product.checksums && product.checksums[rel]) {
			product.checksums[rel] = checksum(out);
		}
		changed = true;
		results.push({ file: rel, status: 'patched', strings: count });
		log(`patched ${rel}: ${count} strings`);
	}

	if (changed) {
		const productBackup = path.join(backupRoot, 'product.json');
		if (!fs.existsSync(productBackup)) {
			fs.mkdirSync(backupRoot, { recursive: true });
			fs.copyFileSync(productPath, productBackup);
		}
		writeAtomic(productPath, JSON.stringify(product, null, '\t'));
	}
	return { commit, version: product.version, changed, results };
}

function restore({ appRoot = defaultAppRoot() } = {}) {
	const productPath = path.join(appRoot, 'product.json');
	const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
	const backupRoot = path.join(stateDir(), 'backup', product.commit || 'unknown');
	const restored = [];
	for (const rel of [...TARGET_FILES.map(f => path.join('out', f)), 'product.json']) {
		const backup = path.join(backupRoot, rel.replace(/^out[\\/]/, ''));
		const target = path.join(appRoot, rel);
		if (fs.existsSync(backup)) {
			writeAtomic(target, fs.readFileSync(backup));
			restored.push(rel);
		}
	}
	return restored;
}

function status({ appRoot = defaultAppRoot() } = {}) {
	return TARGET_FILES.map(rel => {
		const file = path.join(appRoot, 'out', rel);
		if (!fs.existsSync(file)) {
			return { file: rel, patched: false, missing: true };
		}
		const fd = fs.openSync(file, 'r');
		const size = fs.fstatSync(fd).size;
		const buf = Buffer.alloc(Math.min(120, size));
		fs.readSync(fd, buf, 0, buf.length, size - buf.length);
		fs.closeSync(fd);
		return { file: rel, patched: readMarker(buf.toString('utf8')) !== undefined };
	});
}

// Unique display strings in the pristine bundles, for building the dictionary.
function extract({ appRoot = defaultAppRoot() } = {}) {
	const product = JSON.parse(fs.readFileSync(path.join(appRoot, 'product.json'), 'utf8'));
	const backupRoot = path.join(stateDir(), 'backup', product.commit || 'unknown');
	const seen = new Set();
	for (const rel of TARGET_FILES) {
		const backup = path.join(backupRoot, rel);
		const file = fs.existsSync(backup) ? backup : path.join(appRoot, 'out', rel);
		if (!fs.existsSync(file)) {
			continue;
		}
		for (const lit of findLiterals(fs.readFileSync(file, 'utf8'))) {
			seen.add(lit.value);
		}
	}
	return [...seen];
}

module.exports = { apply, restore, status, extract, patchSource, findLiterals, defaultAppRoot, stateDir, TARGET_FILES };
