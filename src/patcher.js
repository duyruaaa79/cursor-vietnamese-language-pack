'use strict';

// Localizes UI strings that Cursor hardcodes in its workbench bundles (Cursor Settings,
// Agents Window, chat) and keeps the language pack in sync with the installed Cursor.
// Strings that the bundle compares, switches on or uses as lookup keys are never replaced.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PATCHER_VERSION = '2';

const TARGET_FILES = [
	'vs/workbench/workbench.desktop.main.js',
	'vs/workbench/workbench.glass.main.js',
	'vs/workbench/workbench.anysphere-ui-automations.js',
	'vs/workbench/workbench.xai-commerce-prepaid.js',
];

const UI_KEY_RE = /^(?:label|title|description|markdownDescription|settingsDescription|message|placeholder|placeHolder|tooltip|hoverTooltip|ariaLabel|"aria-label"|children|detail|subtitle|heading|header|caption|loading|completed|done|inProgress|pending|running|failed|success|warning|error|errorMessage|successMessage|warningMessage|infoMessage|displayName|zoomIn|zoomOut|text|[a-z]\w*(?:Label|Title|Text|Message|Description|Tooltip|Placeholder|Heading|Caption|Hint|Subtitle|Button))$/;
const ID_KEY_RE = /^(?:original|id|key|type|kind|command|when|mode|value|icon|className|role|scheme|language|languageId|event|eventName|name|path|url|href|src|uri|model|modelName|toolName|method|status|state|variant|size|color|theme|group|category|order|source|target|format|encoding|channel|level|code|reason)$/;
const LOGIC_CALL_RE = /\.(?:has|get|set|delete|add|includes|startsWith|endsWith|indexOf|lastIndexOf|getItem|setItem|removeItem|replace|replaceAll|split|match|test|localeCompare|querySelector|querySelectorAll|getElementById|closest|matches|contains)\(\s*$/;
const NON_UI_CALL_RE = /(?:console\.\w+|\blog\w*|\.\w*Log\w*|\btrack\w*|\bcapture\w*|\bnew \w*Error|\bthrow \w*Error|\brequire|\bimport|\.(?:info|warn|debug|trace))\(\s*$|\bthrow\s*$/;
const PROMPTISH_RE = /\b(you are|the user|assistant|system prompt|must not|tool call|<\/?\w+>)\b/i;
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'void', 'delete', 'throw', 'new', 'yield', 'await', 'instanceof']);

// Tokenizes minified JS just enough to find string and template literals.
// Returns { strings: [{start, end, raw}], templates: [{start, end, quasis, exprs}] }
// where quasis/exprs are [start, end) offsets of the raw template parts.
function scan(src) {
	const strings = [];
	const templates = [];
	const n = src.length;
	let prev = '';
	let prevWord = '';

	function skipString(i, q) {
		for (i++; i < n; i++) {
			const c = src.charCodeAt(i);
			if (c === 92) {
				i++;
			} else if (c === q || c === 10) {
				return i;
			}
		}
		return n;
	}

	function skipRegex(i) {
		let inClass = false;
		for (i++; i < n; i++) {
			const c = src[i];
			if (c === '\\') {
				i++;
			} else if (c === '[') {
				inClass = true;
			} else if (c === ']') {
				inClass = false;
			} else if (c === '/' && !inClass) {
				break;
			} else if (c === '\n') {
				return i;
			}
		}
		for (i++; i < n && /[a-z]/.test(src[i]); i++) { }
		return i - 1;
	}

	// Scans code starting at i until an unmatched `}` (when inTemplate) or end of input.
	function code(i, inTemplate) {
		let depth = 0;
		for (; i < n; i++) {
			const ch = src[i];
			const cc = src.charCodeAt(i);
			if (cc === 34 || cc === 39) {
				const end = skipString(i, cc);
				if (cc === 34) {
					strings.push({ start: i, end: end + 1, raw: src.slice(i + 1, end) });
				}
				i = end;
				prev = '"';
				continue;
			}
			if (cc === 96) {
				i = template(i);
				prev = '"';
				continue;
			}
			if (ch === '/') {
				const next = src[i + 1];
				if (next === '/') {
					i = src.indexOf('\n', i);
					if (i === -1) {
						return n;
					}
					continue;
				}
				if (next === '*') {
					const end = src.indexOf('*/', i + 2);
					i = end === -1 ? n : end + 1;
					continue;
				}
				if (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || (prev === 'a' && KEYWORDS_BEFORE_REGEX.has(prevWord))) {
					i = skipRegex(i);
					prev = '"';
					continue;
				}
				prev = '/';
				continue;
			}
			if ((cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) || cc === 95 || cc === 36 || (cc >= 48 && cc <= 57)) {
				let j = i + 1;
				while (j < n) {
					const d = src.charCodeAt(j);
					if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || d === 95 || d === 36 || (d >= 48 && d <= 57)) {
						j++;
					} else {
						break;
					}
				}
				prevWord = src.slice(i, j);
				prev = 'a';
				i = j - 1;
				continue;
			}
			if (ch === '{') {
				depth++;
			} else if (ch === '}') {
				if (depth === 0 && inTemplate) {
					return i;
				}
				depth--;
			}
			if (cc > 32) {
				prev = ch === ')' || ch === ']' ? 'a' : ch;
				prevWord = '';
			}
		}
		return n;
	}

	function template(i) {
		const start = i;
		const quasis = [];
		const exprs = [];
		let qs = i + 1;
		for (i++; i < n; i++) {
			const ch = src[i];
			if (ch === '\\') {
				i++;
			} else if (ch === '`') {
				quasis.push([qs, i]);
				templates.push({ start, end: i + 1, quasis, exprs });
				return i;
			} else if (ch === '$' && src[i + 1] === '{') {
				quasis.push([qs, i]);
				const es = i + 2;
				i = code(es, true);
				exprs.push([es, i]);
				qs = i + 1;
			}
		}
		return n;
	}

	code(0, false);
	return { strings, templates };
}

function decode(raw) {
	if (raw.includes('\n')) {
		return undefined;
	}
	try {
		return JSON.parse(`"${raw}"`);
	} catch {
		return undefined;
	}
}

function escapeNonAscii(text) {
	return text.replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function encode(value) {
	return escapeNonAscii(JSON.stringify(value));
}

function encodeQuasi(value) {
	return escapeNonAscii(value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${'));
}

function prevNonSpace(src, i) {
	for (i--; i >= 0 && /\s/.test(src[i]); i--) { }
	return i;
}

function nextNonSpace(src, i) {
	for (; i < src.length && /\s/.test(src[i]); i++) { }
	return i;
}

// Key name when the literal is the value of `key:` in an object literal.
function keyBefore(src, start) {
	const c = prevNonSpace(src, start);
	if (src[c] !== ':') {
		return undefined;
	}
	const m = /([{,]\s*)([\w$]+|"[\w-]+")\s*$/.exec(src.slice(Math.max(0, c - 60), c));
	return m ? m[2] : undefined;
}

// True when position p sits directly inside a `children:[...]` or `return[...]` array.
function inChildrenArray(src, p) {
	let depth = 0;
	for (let i = p, limit = Math.max(0, p - 3000); i >= limit; i--) {
		const ch = src[i];
		if (ch === ')' || ch === ']' || ch === '}') {
			depth++;
		} else if (ch === '(' || ch === '{') {
			if (depth === 0) {
				return false;
			}
			depth--;
		} else if (ch === '[') {
			if (depth === 0) {
				return /(?:children\s*:|\breturn)\s*$/.test(src.slice(Math.max(0, i - 20), i));
			}
			depth--;
		}
	}
	return false;
}

// Flat lookup objects identified by one entry they contain; every value in them is a label.
const ANCHOR_ENTRIES = ['"plan-usage":"Plan & Usage"'];

function anchorSpans(src) {
	const spans = [];
	for (const anchor of ANCHOR_ENTRIES) {
		for (let idx = src.indexOf(anchor); idx !== -1; idx = src.indexOf(anchor, idx + anchor.length)) {
			const start = src.lastIndexOf('{', idx);
			const end = src.indexOf('}', idx);
			if (start !== -1 && end !== -1) {
				spans.push([start, end + 1]);
			}
		}
	}
	return spans;
}

function inSpans(spans, pos) {
	return spans.some(([a, b]) => pos > a && pos < b);
}

// Describes how the literal at [start, end) is used.
function classify(src, start, end) {
	const before = src.slice(Math.max(0, start - 40), start);
	const p = prevNonSpace(src, start);
	const q = nextNonSpace(src, end);
	const after = src.slice(q, q + 40);
	// Comparisons against a label the bundle itself assigned stay consistent when both sides are translated.
	if (/\.(?:label|title)\s*[=!]==\s*$/.test(before) || /^[=!]==\s*[\w$]+(?:\.[\w$]+)*\.(?:label|title)\b(?!\s*\()/.test(after)) {
		return 'labelcmp';
	}
	if (/[=!]==?\s*$/.test(before) || /^[=!]==?[^=]/.test(after) || /\bcase\s*$/.test(before) || /^in\b/.test(after) || LOGIC_CALL_RE.test(before)) {
		return 'logic';
	}
	if (src[p] === '[' && /[\w$)\]]/.test(src[prevNonSpace(src, p)]) && !/\b(?:return|case|in|of|typeof|void|yield|await|throw|else|do)\s*$/.test(src.slice(Math.max(0, p - 12), p))) {
		return 'logic';
	}
	if (after[0] === ':' && (src[p] === '{' || src[p] === ',')) {
		return 'logic';
	}
	if (NON_UI_CALL_RE.test(before) || /[\w$]\(\s*\d+\s*,\s*$/.test(before)) {
		return 'skip';
	}
	const key = keyBefore(src, start);
	if (key !== undefined) {
		if (/^title$/.test(key) && /\{\s*value\s*:\s*$/.test(before)) {
			return 'ui';
		}
		if (ID_KEY_RE.test(key)) {
			return 'skip';
		}
		return UI_KEY_RE.test(key) ? 'ui' : 'other';
	}
	if (/(?:\?|\?\?|\|\||=>|\breturn)\s*$/.test(before)) {
		return 'ui';
	}
	if (src[p] === ':' && /\?\s*"(?:[^"\\\n]|\\.)*"\s*$/.test(src.slice(Math.max(0, p - 320), p))) {
		return 'ui';
	}
	if ((src[p] === '[' || src[p] === ',') && inChildrenArray(src, p)) {
		return 'ui';
	}
	if (/\.(?:textContent|innerText|title|placeholder|ariaLabel|label)\s*=\s*$/.test(before) || /(?:createTextNode|showInformationMessage|showWarningMessage|showErrorMessage)\(\s*$/.test(before)) {
		return 'ui';
	}
	if (/\(\s*"[a-z][\w-]*(?:\.[\w-]+)+"\s*,\s*$/.test(before)) {
		return 'ui';
	}
	if (/(?:^|[,;{}(])\s*(?:(?:const|let|var)\s+)?[\w$]+\s*=\s*$/.test(before)) {
		return 'ui';
	}
	return 'other';
}

function looksLikeUiText(value, strict) {
	if (!value || value.length > 300 || !/[A-Za-z]{2}/.test(value) || PROMPTISH_RE.test(value)) {
		return false;
	}
	if (/^(https?:|vs\/|\$\(|codicon|\.|#|--)/.test(value) || /[{}<>;=\\|]|=>|\n/.test(value.replace(/\{\d+\}/g, ''))) {
		return false;
	}
	if (/^[\w.\-/:#@$]+$/.test(value)) {
		return strict && /^[A-Z][a-z]+$/.test(value);
	}
	return /^(?:\{\d+\}\s*)?[A-Z0-9]/.test(value) && /\s/.test(value);
}

function templateKey(src, t) {
	let key = '';
	for (let k = 0; k < t.quasis.length; k++) {
		const [a, b] = t.quasis[k];
		const raw = src.slice(a, b);
		if (raw.includes('\\') || /[{}]/.test(raw)) {
			return undefined;
		}
		key += raw;
		if (k < t.exprs.length) {
			key += `{${k}}`;
		}
	}
	return t.exprs.length ? key : undefined;
}

// Display strings worth translating: string literals in UI positions and templates.
function findCandidates(src) {
	const { strings, templates } = scan(src);
	const anchors = anchorSpans(src);
	const out = new Set();
	for (const s of strings) {
		const value = decode(s.raw);
		if (value === undefined) {
			continue;
		}
		const kind = inSpans(anchors, s.start) ? 'ui' : classify(src, s.start, s.end);
		if (kind === 'ui' && looksLikeUiText(value, true)) {
			out.add(value);
		}
	}
	for (const t of templates) {
		const key = templateKey(src, t);
		if (key && classify(src, t.start, t.end) !== 'skip' && looksLikeUiText(key, false)) {
			out.add(key);
		}
	}
	return out;
}

function patchSource(src, dict, logic) {
	const { strings, templates } = scan(src);
	if (!logic) {
		logic = new Set();
		const compared = new Set();
		const unpatched = new Set();
		for (const s of strings) {
			const value = decode(s.raw);
			if (value === undefined) {
				continue;
			}
			const kind = classify(src, s.start, s.end);
			if (kind === 'logic') {
				logic.add(value);
			} else if (kind === 'labelcmp') {
				compared.add(value);
			} else if ((kind === 'skip' && keyBefore(src, s.start) !== 'original') || (kind === 'other' && !/\s/.test(value))) {
				unpatched.add(value);
			}
		}
		for (const value of compared) {
			if (unpatched.has(value)) {
				logic.add(value);
			}
		}
	}
	const anchors = anchorSpans(src);
	const edits = [];
	for (const s of strings) {
		const value = decode(s.raw);
		const vi = value === undefined ? undefined : dict[value];
		if (typeof vi !== 'string' || vi === value) {
			continue;
		}
		if (inSpans(anchors, s.start) && src[nextNonSpace(src, s.end)] !== ':') {
			edits.push({ start: s.start, end: s.end, text: encode(vi) });
			continue;
		}
		if (logic.has(value)) {
			continue;
		}
		const kind = classify(src, s.start, s.end);
		if (kind === 'ui' || kind === 'labelcmp' || (kind === 'other' && /\s/.test(value))) {
			edits.push({ start: s.start, end: s.end, text: encode(vi) });
		}
	}
	for (const t of templates) {
		const key = templateKey(src, t);
		const vi = key && dict[key];
		if (typeof vi !== 'string' || vi === key || classify(src, t.start, t.end) === 'skip') {
			continue;
		}
		const exprs = t.exprs.map(([a, b]) => patchSource(src.slice(a, b), dict, logic).text);
		const pieces = vi.split(/\{(\d+)\}/);
		let text = '`';
		let ok = true;
		for (let k = 0; k < pieces.length; k++) {
			if (k % 2 === 0) {
				text += encodeQuasi(pieces[k]);
			} else if (exprs[+pieces[k]] !== undefined) {
				text += '${' + exprs[+pieces[k]] + '}';
			} else {
				ok = false;
			}
		}
		if (ok) {
			edits.push({ start: t.start, end: t.end, text: text + '`' });
		}
	}
	edits.sort((a, b) => a.start - b.start || b.end - a.end);
	const parts = [];
	let last = 0;
	let count = 0;
	for (const e of edits) {
		if (e.start < last) {
			continue;
		}
		parts.push(src.slice(last, e.start), e.text);
		last = e.end;
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

// A double-clickable script that restores the original bundles without needing Cursor to start.
function writeRescueScript(appRoot) {
	if (process.platform !== 'darwin') {
		return;
	}
	const files = [...TARGET_FILES, 'product.json'].map(rel => `"${rel}"`).join(' ');
	const script = `#!/bin/bash
# Khôi phục giao diện gốc của Cursor và tắt tự Việt hóa giao diện.
APP="${appRoot}"
STATE="$HOME/.cursor-vietnamese"
COMMIT=$(sed -n 's/.*"commit"[^"]*"\\([0-9a-f]*\\)".*/\\1/p' "$APP/product.json" | head -1)
BACKUP="$STATE/backup/$COMMIT"
touch "$STATE/disabled"
for rel in ${files}; do
	if [ "$rel" = "product.json" ]; then target="$APP/product.json"; else target="$APP/out/$rel"; fi
	if [ -f "$BACKUP/$rel" ]; then cp "$BACKUP/$rel" "$target" && echo "Đã khôi phục $rel"; fi
done
echo "Xong. Mở lại Cursor."
`;
	const file = path.join(stateDir(), 'Khoi-phuc-Cursor.command');
	fs.mkdirSync(stateDir(), { recursive: true });
	fs.writeFileSync(file, script, { mode: 0o755 });
}

function isDisabled() {
	return fs.existsSync(path.join(stateDir(), 'disabled'));
}

function marker(signature) {
	return `\n/*cursor-vi:${signature}*/\n`;
}

function readMarker(text) {
	const m = /\n\/\*cursor-vi:([0-9a-f]+)\*\/\n$/.exec(text.slice(-120));
	return m ? m[1] : undefined;
}

// macOS validates the code signature of the whole Cursor.app (resources included) and
// SIGKILLs it at launch once any bundled file is modified, so patching is unsafe there.
function bundlePatchingBlocked() {
	return process.platform === 'darwin';
}

// Applies the patch for the installed Cursor. Safe to call repeatedly: files already
// patched with the same dictionary are left alone.
function apply({ appRoot = defaultAppRoot(), dict, log = () => { }, force = false }) {
	if (bundlePatchingBlocked() && !force) {
		log('bundle patching skipped: macOS kills Cursor when files inside Cursor.app are modified');
		return { changed: false, results: [], blocked: true };
	}
	const productPath = path.join(appRoot, 'product.json');
	const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
	const commit = product.commit || 'unknown';
	const signature = sha256(PATCHER_VERSION + JSON.stringify(dict)).toString('hex').slice(0, 16);
	const backupRoot = path.join(stateDir(), 'backup', commit);
	const results = [];
	let changed = false;
	writeRescueScript(appRoot);

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
		for (const value of findCandidates(fs.readFileSync(file, 'utf8'))) {
			seen.add(value);
		}
	}
	return [...seen];
}

module.exports = { apply, restore, status, extract, patchSource, findCandidates, scan, classify, isDisabled, bundlePatchingBlocked, defaultAppRoot, stateDir, TARGET_FILES };
