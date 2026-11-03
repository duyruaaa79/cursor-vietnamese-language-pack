'use strict';

// Builds the script injected into Cursor's renderer. It translates text nodes and a few
// attributes whose whole (trimmed) text matches a dictionary entry, and re-translates
// whenever the UI framework writes the English text back.

function payload(dict, signature = '') {
	const exact = {};
	const templates = [];
	for (const [en, vi] of Object.entries(dict)) {
		if (typeof vi !== 'string' || en === vi || en.length > 400 || !/[A-Za-z]/.test(en)) {
			continue;
		}
		const key = en.replace(/&&/g, '');
		const value = vi.replace(/&&/g, '');
		if (/\{\d+\}/.test(key)) {
			if (/[A-Za-z]{3}/.test(key.replace(/\{\d+\}/g, ''))) {
				templates.push([key, value]);
			}
		} else {
			exact[key] = value;
		}
	}
	return `(${runtime.toString()})(${JSON.stringify(signature)}, ${JSON.stringify(exact)}, ${JSON.stringify(templates)});`;
}

/* eslint-disable no-undef */
function runtime(signature, exact, templateList) {
	if (window.__cursorVi) {
		if (window.__cursorVi.signature === signature) {
			return;
		}
		window.__cursorVi.dispose();
	}
	const D = new Map(Object.entries(exact));
	const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// Templates are bucketed by the first two characters of their literal prefix so a text
	// node is only tested against templates that can possibly match it.
	const buckets = new Map();
	const anyStart = [];
	for (const [en, vi] of templateList) {
		const order = [];
		const re = new RegExp('^' + en.split(/(\{\d+\})/).map(part => {
			const m = /^\{(\d+)\}$/.exec(part);
			if (m) {
				order.push(+m[1]);
				return '(.+?)';
			}
			return esc(part);
		}).join('') + '$', 's');
		const parts = en.split(/\{\d+\}/);
		const prefix = parts[0];
		const needle = parts.reduce((a, b) => (b.length > a.length ? b : a), '');
		const t = { re, order, vi, needle };
		if (prefix.length >= 2) {
			const k = prefix.slice(0, 2);
			if (!buckets.has(k)) {
				buckets.set(k, []);
			}
			buckets.get(k).push(t);
		} else {
			anyStart.push(t);
		}
	}
	const SKIP_SELECTOR = [
		'.monaco-editor .view-lines', '.xterm', '[contenteditable="true"]', 'textarea', 'input', 'script', 'style', 'code', 'pre',
		'.rendered-markdown', '.markdown-root', '.ui-markdown', '.markdown-sections', '.assistant-message',
		'.composer-human-message-content', '.agent-transcript-row-markdown', '.markdown-lexical-editor-root',
		'.markdown-editor-react', '.composer-message-codeblock', '[data-cursor-vi-skip]',
	].join(', ');
	const ATTRS = ['placeholder', 'title', 'aria-label'];
	const original = new WeakMap();

	function lookup(text) {
		const key = text.trim();
		if (!key || key.length > 400 || !/[A-Za-z]/.test(key)) {
			return undefined;
		}
		let vi = D.get(key);
		if (vi === undefined && key.length <= 200) {
			for (const t of (buckets.get(key.slice(0, 2)) || []).concat(anyStart)) {
				if (!key.includes(t.needle)) {
					continue;
				}
				const m = t.re.exec(key);
				if (m) {
					vi = t.vi.replace(/\{(\d+)\}/g, (s, n) => {
						const i = t.order.indexOf(+n);
						return i === -1 ? s : m[i + 1];
					});
					break;
				}
			}
		}
		if (vi === undefined) {
			return undefined;
		}
		const lead = text.match(/^\s*/)[0];
		const trail = text.match(/\s*$/)[0];
		return lead + vi + trail;
	}

	function skipped(el) {
		return !el || el.closest(SKIP_SELECTOR) !== null;
	}

	function textNode(node) {
		if (skipped(node.parentElement)) {
			return;
		}
		const vi = lookup(node.nodeValue);
		if (vi !== undefined && vi !== node.nodeValue) {
			original.set(node, node.nodeValue);
			node.nodeValue = vi;
		}
	}

	function attrs(el) {
		if (el.closest('.monaco-editor .view-lines, .xterm, .assistant-message, .composer-human-message-content, [data-cursor-vi-skip]')) {
			return;
		}
		for (const a of ATTRS) {
			const v = el.getAttribute(a);
			if (v) {
				const vi = lookup(v);
				if (vi !== undefined && vi !== v) {
					el.setAttribute(a, vi);
				}
			}
		}
	}

	function walk(root) {
		if (root.nodeType === 3) {
			textNode(root);
			return;
		}
		if (root.nodeType !== 1 && root.nodeType !== 11) {
			return;
		}
		if (root.nodeType === 1) {
			attrs(root);
			if (root.matches(SKIP_SELECTOR)) {
				return;
			}
		}
		const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
		let n;
		while ((n = w.nextNode())) {
			if (n.nodeType === 3) {
				textNode(n);
			} else {
				attrs(n);
				if (n.shadowRoot) {
					watch(n.shadowRoot);
				}
			}
		}
	}

	const observers = [];
	function watch(root) {
		const mo = new MutationObserver(records => {
			for (const r of records) {
				if (r.type === 'characterData') {
					textNode(r.target);
				} else if (r.type === 'attributes') {
					attrs(r.target);
				} else {
					r.addedNodes.forEach(walk);
				}
			}
		});
		mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
		observers.push(mo);
		walk(root);
	}

	function start() {
		watch(document.documentElement);
	}

	window.__cursorVi = {
		signature,
		dispose() {
			observers.forEach(o => o.disconnect());
		},
	};
	if (document.documentElement) {
		start();
	} else {
		document.addEventListener('DOMContentLoaded', start, { once: true });
	}
}

module.exports = { payload };
