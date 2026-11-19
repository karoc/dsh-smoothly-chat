window.__ModuleLoader__.load({
	id: "dsh-smoothly-chat",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/client/styles.ts
		/**
		* Design-token styles for the Smoothly Chat panel.
		*
		* Injected as a module-top-level side effect (never inside a ctx.effect
		* closure): rolldown can drop a closure-only call together with the module,
		* which historically crashed the whole web client. `import './styles.ts'`
		* pins it.
		*/
		const ID = "dsh-smoothly-chat";
		const CSS = `
.dsc-root {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  font-size: 13px;
}
.dsc-peers {
  width: 264px;
  flex: 0 0 264px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--dsw-alias-border-l2);
}
.dsc-peers-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dsc-peers-title {
  flex: 1;
  font-weight: 600;
  font-size: 13px;
}
.dsc-requests {
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--dsw-alias-bg-layer-2);
}
.dsc-requests-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 4px;
  border: none;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dsc-request {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
}
.dsc-peer-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  padding: 4px;
}
.dsc-peer-list::-webkit-scrollbar { display: none; }
.dsc-peer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
}
.dsc-peer:hover { background: var(--dsw-alias-bg-layer-2); }
.dsc-peer.active {
  background: var(--dsw-alias-bg-module-platform);
  border-color: var(--dsw-alias-border-l3);
}
.dsc-peer-main { flex: 1; min-width: 0; }
.dsc-peer-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsc-peer-preview {
  margin-top: 2px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsc-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
}
.dsc-dot.on { background: var(--dsw-alias-state-success-primary, #22c55e); }
.dsc-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: var(--dsw-alias-state-error-primary);
}
.dsc-self {
  padding: 8px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  font-size: 11px;
  color: var(--dsw-alias-text-tertiary, var(--dsw-alias-label-tertiary));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsc-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.dsc-chat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dsc-chat-title { font-weight: 600; }
.dsc-chat-sub { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dsc-spacer { flex: 1; }
.dsc-banner {
  margin: 8px 14px 0;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
}
.dsc-banner.warn { border-color: var(--dsw-alias-state-warning-primary, #d97706); }
.dsc-banner.error { border-color: var(--dsw-alias-state-error-primary); }
.dsc-thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsc-thread::-webkit-scrollbar { display: none; }
.dsc-msg { display: flex; flex-direction: column; max-width: 72%; }
.dsc-msg.in { align-self: flex-start; align-items: flex-start; }
.dsc-msg.out { align-self: flex-end; align-items: flex-end; }
.dsc-bubble {
  padding: 8px 11px;
  border-radius: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
  background: var(--dsw-alias-bg-module-platform);
}
.dsc-msg.out .dsc-bubble {
  background: var(--dsw-alias-button-primary-fill);
  color: #fff;
}
.dsc-file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 11px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-module-platform);
  border: 1px solid var(--dsw-alias-border-l2);
  min-width: 200px;
}
.dsc-file-name { font-weight: 500; word-break: break-all; }
.dsc-file-size { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dsc-file-action {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--dsw-alias-brand-primary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
}
.dsc-status { margin-top: 3px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dsc-status.failed { color: var(--dsw-alias-state-error-primary); }
.dsc-progress {
  display: inline-block;
  width: 96px;
  height: 4px;
  border-radius: 2px;
  background: var(--dsw-alias-border-l2);
  overflow: hidden;
  vertical-align: middle;
}
.dsc-progress-fill {
  display: block;
  height: 100%;
  background: var(--dsw-alias-brand-primary);
  transition: width 120ms linear;
}
.dsc-upload {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsc-upload .dsc-progress { flex: 1; }
.dsc-transfer { display: inline-flex; align-items: center; }
.dsc-transfer .dsc-progress { width: 64px; }
.dsc-composer {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsc-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: none;
  min-height: 38px;
  max-height: 160px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  outline: none;
}
.dsc-textarea:focus { border-color: var(--dsw-alias-brand-primary); }
.dsc-composer-row { display: flex; align-items: center; gap: 8px; }
.dsc-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.dsc-btn:hover { background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2)); }
.dsc-btn.primary {
  background: var(--dsw-alias-button-primary-fill);
  border-color: transparent;
  color: #fff;
}
.dsc-btn:disabled { opacity: 0.5; cursor: default; }
.dsc-icon-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  justify-content: center;
}
.dsc-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.dsc-check input { accent-color: var(--dsw-alias-button-primary-fill); }
.dsc-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 18px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: 12px;
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
  padding: 24px;
}
.dsc-empty strong { color: var(--dsw-alias-label-secondary); font-weight: 500; }
.dsc-add-panel {
  margin: 0 14px 8px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--dsw-alias-bg-layer-2);
}
.dsc-add-title { font-weight: 600; font-size: 12px; }
.dsc-input {
  width: 100%;
  box-sizing: border-box;
  height: 30px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.dsc-input:focus { border-color: var(--dsw-alias-brand-primary); }
.dsc-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); line-height: 1.4; }
.dsc-row { display: flex; align-items: center; gap: 6px; }
.dsc-icon { position: relative; display: inline-flex; align-items: center; justify-content: center; }
.dsc-icon-dot {
  position: absolute;
  top: -2px;
  right: -3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-state-error-primary);
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-1);
}
.dsc-dragover { outline: 2px dashed var(--dsw-alias-brand-primary); outline-offset: -6px; }
`;
		if (typeof document !== "undefined" && document.querySelector(`style[data-dsh-plugin-css="dsh-smoothly-chat"]`) === null) {
			const style = document.createElement("style");
			style.setAttribute("data-dsh-plugin-css", ID);
			style.textContent = CSS;
			document.head.appendChild(style);
		}
		// src/client/EnvelopeIcon.tsx
		/** A 24-unit stroke envelope that follows the current text color. */
		function EnvelopeIcon({ size = 18 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.6,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				focusable: "false",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "3",
					y: "5",
					width: "18",
					height: "14",
					rx: "2"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m4 7.2 7.1 5.1a1.6 1.6 0 0 0 1.8 0L20 7.2" })]
			});
		}
		// src/client/state.ts
		/**
		* Client-side mailbox store.
		*
		* One module-level snapshot consumed through `useSyncExternalStore` (the
		* snapshot object is replaced only on publish, satisfying React's stable-
		* reference contract). Freshness comes from SSE with a 5-second polling
		* fallback, so a dropped stream degrades to "a few seconds late" instead of a
		* silently frozen panel.
		*/
		/** API prefix owned by the host half. */
		const API = "/smoothly-chat/api";
		let snapshot = {
			state: void 0,
			threads: {},
			selected: null,
			loading: true,
			error: void 0,
			progress: {}
		};
		const listeners = /* @__PURE__ */ new Set();
		let inflight;
		let refreshSeq = 0;
		let started = false;
		let panelVisible = false;
		const autoRead = /* @__PURE__ */ new Set();
		/** Subscribe to snapshot replacements. */
		function subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		/** Current snapshot (stable until the next publish). */
		function getSnapshot() {
			return snapshot;
		}
		function publish(patch) {
			snapshot = {
				...snapshot,
				...patch
			};
			for (const listener of [...listeners]) try {
				listener();
			} catch (error) {
				console.error("[smoothly-chat] store listener threw:", error);
			}
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/** Call one API route and unwrap the `{ ok }` envelope. */
		async function request(path, init) {
			const response = await fetch(`${API}${path}`, {
				credentials: "same-origin",
				...init,
				headers: {
					...init?.body === void 0 ? {} : { "content-type": "application/json" },
					...init?.headers ?? {}
				}
			});
			const text = await response.text();
			let body;
			try {
				body = text === "" ? {} : JSON.parse(text);
			} catch {
				throw new Error(`unexpected response (HTTP ${String(response.status)})`);
			}
			const record = body;
			if (!response.ok || record.ok === false) throw new Error(typeof record.error === "string" ? record.error : `HTTP ${String(response.status)}`);
			return body;
		}
		/** Reload state and the selected thread. */
		function refresh() {
			if (inflight !== void 0) return inflight;
			const seq = ++refreshSeq;
			inflight = (async () => {
				try {
					const state = await request("/state");
					if (seq !== refreshSeq) return;
					const selected = snapshot.selected ?? state.peers[0]?.deviceId ?? null;
					const threads = { ...snapshot.threads };
					if (selected !== null) threads[selected] = (await request(`/thread?peer=${encodeURIComponent(selected)}&limit=300`)).messages;
					publish({
						state,
						threads,
						selected,
						loading: false,
						error: void 0
					});
					maybeAutoRead();
				} catch (error) {
					publish({
						loading: false,
						error: messageOf(error)
					});
				} finally {
					inflight = void 0;
				}
			})();
			return inflight;
		}
		/** Tell the store whether the mailbox panel is on screen. */
		function setPanelVisible(visible) {
			panelVisible = visible;
			if (visible) maybeAutoRead();
		}
		/**
		* Read the selected thread while its panel is actually being watched: an open
		* panel whose window is visible marks incoming messages read without the user
		* having to click the already-selected row. Hidden windows and other panels
		* keep accumulating unread, which is the point of the dot.
		*/
		function maybeAutoRead() {
			if (!panelVisible) return;
			if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
			const deviceId = snapshot.selected;
			if (deviceId === null) return;
			if ((snapshot.state?.peers.find((peer) => peer.deviceId === deviceId)?.unread ?? 0) === 0 || autoRead.has(deviceId)) return;
			autoRead.add(deviceId);
			request("/read", {
				method: "POST",
				body: JSON.stringify({ peerId: deviceId })
			}).then(() => refresh()).catch(() => {}).finally(() => {
				autoRead.delete(deviceId);
			});
		}
		/** Select one peer, load its thread and clear its unread mark. */
		async function selectPeer(deviceId) {
			publish({ selected: deviceId });
			try {
				const thread = await request(`/thread?peer=${encodeURIComponent(deviceId)}&limit=300`);
				publish({ threads: {
					...snapshot.threads,
					[deviceId]: thread.messages
				} });
			} catch (error) {
				publish({ error: messageOf(error) });
				return;
			}
			if ((snapshot.state?.peers.find((peer) => peer.deviceId === deviceId)?.unread ?? 0) > 0) await markRead(deviceId);
		}
		/** Clear the unread mark of one peer. */
		async function markRead(deviceId) {
			try {
				await request("/read", {
					method: "POST",
					body: JSON.stringify({ peerId: deviceId })
				});
				await refresh();
			} catch (error) {
				publish({ error: messageOf(error) });
			}
		}
		/** Send text to the selected peer, or to every peer when `broadcast` is set. */
		async function sendText(text, broadcast) {
			const peerIds = broadcast ? void 0 : snapshot.selected === null ? void 0 : [snapshot.selected];
			await request("/send", {
				method: "POST",
				body: JSON.stringify({
					text,
					...peerIds === void 0 ? {} : { peerIds }
				})
			});
			await refresh();
		}
		/**
		* Upload one file per target peer. `fetch` cannot report upload progress, so
		* this uses XMLHttpRequest; the caller draws a bar from the callback and the
		* host reports the peer-delivery half over SSE.
		*/
		function uploadTo(peerId, file, onProgress) {
			return new Promise((resolve, reject) => {
				const xhr = new XMLHttpRequest();
				xhr.open("POST", `${API}/upload?peer=${encodeURIComponent(peerId)}&name=${encodeURIComponent(file.name)}`);
				xhr.setRequestHeader("content-type", "application/octet-stream");
				xhr.upload.onprogress = (event) => {
					if (event.lengthComputable) onProgress?.(event.loaded, event.total);
				};
				xhr.onload = () => {
					let body = {};
					try {
						body = JSON.parse(xhr.responseText);
					} catch {}
					if (xhr.status >= 200 && xhr.status < 300 && body.ok !== false) resolve();
					else reject(new Error(typeof body.error === "string" ? body.error : `HTTP ${String(xhr.status)}`));
				};
				xhr.onerror = () => {
					reject(/* @__PURE__ */ new Error("upload failed"));
				};
				xhr.send(file);
			});
		}
		/** Upload one file to the selected peer, or to every peer when `broadcast` is set. */
		async function sendFile(file, broadcast, onProgress) {
			const target = broadcast ? (snapshot.state?.peers ?? []).filter((peer) => peer.pairedAt !== void 0).map((peer) => peer.deviceId) : snapshot.selected === null ? [] : [snapshot.selected];
			if (target.length === 0) throw new Error("no peer selected");
			for (const peerId of target) await uploadTo(peerId, file, onProgress);
			await refresh();
		}
		/** Mint this machine's invitation string. */
		async function createInvite() {
			return request("/invite", { method: "POST" });
		}
		/** Pair with the machine named by an invitation string; returns the peer row. */
		async function pairWith(invitation) {
			const result = await request("/pair", {
				method: "POST",
				body: JSON.stringify({ invitation })
			});
			await refresh();
			return result.peer;
		}
		/** Approve one pending pairing request. */
		async function approveRequest(deviceId) {
			await request("/requests/approve", {
				method: "POST",
				body: JSON.stringify({ deviceId })
			});
			await refresh();
		}
		/** Decline one pending pairing request. */
		async function denyRequest(deviceId) {
			await request("/requests/deny", {
				method: "POST",
				body: JSON.stringify({ deviceId })
			});
			await refresh();
		}
		/** Remove one pair. */
		async function unpairPeer(deviceId) {
			await request("/unpair", {
				method: "POST",
				body: JSON.stringify({ deviceId })
			});
			publish({ selected: null });
			await refresh();
		}
		/** Ask the host to compare the installed build with the repository's main. */
		async function checkUpdates() {
			return request("/update");
		}
		/** Ask the host to run the outbox now. */
		async function retryDelivery() {
			await request("/retry", { method: "POST" });
			await refresh();
		}
		/** Fetch one received file as a blob and hand it to the browser. */
		async function downloadFile(message) {
			if (message.file === void 0) return;
			const response = await fetch(`${API}/file?peer=${encodeURIComponent(message.peerId)}&id=${encodeURIComponent(message.id)}`, { credentials: "same-origin" });
			if (!response.ok) throw new Error(`download failed (HTTP ${String(response.status)})`);
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = message.file.name;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			window.setTimeout(() => {
				URL.revokeObjectURL(url);
			}, 15e3);
		}
		/**
		* Start freshness: one immediate load, then SSE (instant) with a polling
		* fallback (a dropped stream means "seconds late", never "frozen").
		*/
		function startClient() {
			if (started || typeof window === "undefined") return;
			started = true;
			refresh();
			window.setInterval(() => {
				if (document.visibilityState !== "hidden") refresh();
			}, 5e3);
			window.addEventListener("focus", () => {
				refresh();
			});
			window.addEventListener("online", () => {
				refresh();
			});
			document.addEventListener("visibilitychange", () => {
				if (document.visibilityState === "visible") refresh();
			});
			try {
				const source = new EventSource(`${API}/events`);
				source.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data);
						if (data.type === "progress" && typeof data.messageId === "string") {
							publish({ progress: {
								...snapshot.progress,
								[data.messageId]: {
									sent: data.sent ?? 0,
									total: data.total ?? 0
								}
							} });
							return;
						}
						if (data.type === "status" && typeof data.messageId === "string") {
							const next = { ...snapshot.progress };
							delete next[data.messageId];
							publish({ progress: next });
						}
						if (data.type !== "ready") refresh();
					} catch {}
				};
			} catch {}
		}
		/** React hook over the snapshot. */
		function useInbox() {
			return (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
		}
		/** Human-readable byte size. */
		function formatSize(bytes) {
			if (bytes < 1024) return `${String(bytes)} B`;
			if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
		}
		/** Short relative time for list rows and status lines. */
		function formatTime(at, now = Date.now(), nowLabel = "now") {
			const delta = Math.max(0, now - at);
			if (delta < 6e4) return nowLabel;
			if (delta < 36e5) return `${String(Math.floor(delta / 6e4))}m`;
			if (delta < 864e5) return `${String(Math.floor(delta / 36e5))}h`;
			return new Date(at).toLocaleDateString();
		}
		// src/client/InboxPage.tsx
		/**
		* The Smoothly Chat panel: peer list on the left, one thread on the right,
		* composer at the bottom. Everything it shows comes from the host's mailbox
		* API — no conversation is created, read, or written by this component.
		*/
		/** Replace `{name}` placeholders in a translated template. */
		function fill(template, vars) {
			return template.replace(/\{(\w+)\}/gu, (match, key) => key in vars ? String(vars[key]) : match);
		}
		/** Build a translator with a raw-key fallback (the framework supplies one in practice). */
		function translator(t) {
			return (key, vars) => fill(t === void 0 ? key : t(key), vars ?? {});
		}
		/** The panel body. */
		function InboxPage(props) {
			const tr = translator(props.t);
			const snapshot = useInbox();
			const { state, threads, selected, loading, error } = snapshot;
			const [draft, setDraft] = (0, react.useState)("");
			const [broadcast, setBroadcast] = (0, react.useState)(false);
			const [panel, setPanel] = (0, react.useState)("none");
			const [invitation, setInvitation] = (0, react.useState)("");
			const [inviteString, setInviteString] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [actionError, setActionError] = (0, react.useState)(null);
			const [copied, setCopied] = (0, react.useState)(false);
			const [dragging, setDragging] = (0, react.useState)(false);
			const [confirmUnpair, setConfirmUnpair] = (0, react.useState)(false);
			const [requestsOpen, setRequestsOpen] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)(null);
			const [upload, setUpload] = (0, react.useState)(null);
			const fileRef = (0, react.useRef)(null);
			const threadRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				setPanelVisible(true);
				return () => {
					setPanelVisible(false);
				};
			}, []);
			const peers = state?.peers ?? [];
			const requests = state?.requests ?? [];
			const peer = peers.find((candidate) => candidate.deviceId === selected);
			const messages = selected === null ? [] : threads[selected] ?? [];
			(0, react.useEffect)(() => {
				if (threadRef.current !== null) threadRef.current.scrollTop = threadRef.current.scrollHeight;
			}, [messages.length, selected]);
			(0, react.useEffect)(() => {
				if (panel !== "invite" || inviteString !== "") return;
				let active = true;
				createInvite().then((invite) => {
					if (active) setInviteString(invite.string);
				}).catch((cause) => {
					if (active) setActionError(cause instanceof Error ? cause.message : String(cause));
				});
				return () => {
					active = false;
				};
			}, [panel, inviteString]);
			const run = (0, react.useCallback)(async (task) => {
				setBusy(true);
				setActionError(null);
				try {
					await task();
				} catch (cause) {
					setActionError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy(false);
				}
			}, []);
			const submit = () => {
				const text = draft.trim();
				if (text === "" || busy) return;
				run(async () => {
					await sendText(text, broadcast);
					setDraft("");
				});
			};
			const attach = (files) => {
				const file = files?.[0];
				if (file === void 0) return;
				setUpload({
					sent: 0,
					total: file.size
				});
				run(async () => {
					try {
						await sendFile(file, broadcast, (sent, total) => {
							setUpload({
								sent,
								total
							});
						});
					} finally {
						setUpload(null);
					}
				});
			};
			const submitPair = () => {
				const value = invitation.trim();
				if (value === "") return;
				run(async () => {
					const paired = await pairWith(value);
					setInvitation("");
					setPanel("none");
					if (paired !== void 0 && paired.pairedAt === void 0) setNotice(tr("pairRequestSent"));
				});
			};
			const copyInvite = () => {
				if (inviteString === "") return;
				navigator.clipboard.writeText(inviteString).then(() => {
					setCopied(true);
					window.setTimeout(() => {
						setCopied(false);
					}, 1500);
				}).catch(() => {
					setActionError("clipboard unavailable");
				});
			};
			const startUnpair = () => {
				if (peer === void 0) return;
				if (!confirmUnpair) {
					setConfirmUnpair(true);
					return;
				}
				setConfirmUnpair(false);
				run(async () => {
					await unpairPeer(peer.deviceId);
				});
			};
			const download = (message) => {
				downloadFile(message).catch((cause) => {
					setActionError(cause instanceof Error ? cause.message : String(cause));
				});
			};
			const preview = (candidate) => {
				const last = (threads[candidate.deviceId] ?? []).at(-1);
				if (candidate.pairedAt === void 0) return tr("pairPending");
				if (last === void 0) return candidate.host;
				if (last.kind === "file") return `📎 ${last.file?.name ?? tr("file")}`;
				return last.text ?? "";
			};
			const peerName = (candidate) => candidate.name !== "" ? candidate.name : candidate.deviceId.slice(0, 8);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `dsc-root${dragging ? " dsc-dragover" : ""}`,
				"data-dsc-root": "smoothly-chat",
				onDragOver: (event) => {
					event.preventDefault();
					setDragging(true);
				},
				onDragLeave: (event) => {
					event.preventDefault();
					setDragging(false);
				},
				onDrop: (event) => {
					event.preventDefault();
					setDragging(false);
					attach(event.dataTransfer.files);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
					className: "dsc-peers",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsc-peers-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsc-peers-title",
								children: tr("peers")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsc-btn dsc-icon-btn",
								title: tr("addPeer"),
								onClick: () => {
									setPanel(panel === "pair" ? "none" : "pair");
									setConfirmUnpair(false);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 14 })
							})]
						}),
						panel !== "none" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsc-add-panel",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsc-row",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsc-add-title",
										children: panel === "pair" ? tr("addPeerTitle") : tr("inviteTitle")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsc-spacer" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsc-btn dsc-icon-btn",
										onClick: () => {
											setPanel("none");
											setInviteString("");
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular, { size: 13 })
									})
								]
							}), panel === "pair" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsc-hint",
									children: tr("pairHint")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "dsc-input",
									placeholder: tr("pairPlaceholder"),
									value: invitation,
									onChange: (event) => {
										setInvitation(event.target.value);
									},
									onKeyDown: (event) => {
										if (event.key === "Enter") submitPair();
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsc-row",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsc-btn primary",
										disabled: busy || invitation.trim() === "",
										onClick: submitPair,
										children: busy ? tr("pairing") : tr("pairAction")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsc-btn",
										onClick: () => {
											setPanel("invite");
											setInviteString("");
										},
										children: tr("invite")
									})]
								})
							] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsc-hint",
									children: tr("inviteHint")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "dsc-input",
									readOnly: true,
									value: inviteString,
									onFocus: (event) => {
										event.target.select();
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsc-row",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: "dsc-btn",
										disabled: inviteString === "",
										onClick: copyInvite,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutlineRegular, { size: 13 }), copied ? tr("copied") : tr("copy")]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsc-btn",
										onClick: () => {
											setPanel("pair");
										},
										children: tr("addPeer")
									})]
								})
							] })]
						}),
						requests.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsc-requests",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dsc-requests-head",
								onClick: () => {
									setRequestsOpen((open) => !open);
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsc-badge",
										children: requests.length
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: tr("requestsTitle", { count: requests.length }) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsc-spacer" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsc-hint",
										children: requestsOpen ? "▾" : "▸"
									})
								]
							}), requestsOpen && requests.map((request) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsc-request",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsc-peer-main",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dsc-peer-name",
											children: request.name !== "" ? request.name : request.deviceId.slice(0, 8)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dsc-peer-preview",
											children: tr("requestAddress", {
												address: request.host,
												port: request.port
											})
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsc-btn primary",
										disabled: busy,
										onClick: () => {
											run(async () => {
												await approveRequest(request.deviceId);
											});
										},
										children: tr("approve")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsc-btn",
										disabled: busy,
										onClick: () => {
											run(async () => {
												await denyRequest(request.deviceId);
											});
										},
										children: tr("deny")
									})
								]
							}, request.deviceId))]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsc-peer-list",
							children: [peers.map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: `dsc-peer${candidate.deviceId === selected ? " active" : ""}`,
								onClick: () => {
									selectPeer(candidate.deviceId);
									setConfirmUnpair(false);
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `dsc-dot${candidate.reachable ? " on" : ""}` }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsc-peer-main",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dsc-peer-name",
											children: peerName(candidate)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dsc-peer-preview",
											children: preview(candidate)
										})]
									}),
									candidate.unread > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsc-badge",
										children: candidate.unread > 99 ? "99+" : String(candidate.unread)
									})
								]
							}, candidate.deviceId)), peers.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsc-hint",
								style: { padding: "10px" },
								children: tr("emptyPeers")
							})]
						}),
						state !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsc-self",
							children: tr("selfLine", {
								name: state.self.name,
								address: state.addresses.find((row) => !row.internal && row.family === "IPv4")?.address ?? "127.0.0.1",
								port: state.settings.port
							})
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dsc-main",
					children: [
						state?.serverError != null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsc-banner error",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningTriangleOutlineRegular, { size: 13 }),
								" ",
								tr("serverError", { message: state.serverError })
							]
						}),
						state !== void 0 && !state.lanReachable && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsc-banner warn",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningTriangleOutlineRegular, { size: 13 }),
								" ",
								tr("lanWarn")
							]
						}),
						notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsc-banner",
							children: [notice, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsc-file-action",
								onClick: () => {
									setNotice(null);
								},
								children: tr("noticeDismiss")
							})]
						}),
						(actionError ?? error) !== void 0 && (actionError ?? error) !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsc-banner error",
							children: tr("actionFailed", { message: actionError ?? error ?? "" })
						}),
						peer === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsc-empty",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EnvelopeIcon, { size: 22 }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: tr("emptyThread") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: tr("emptyThreadHint") })
							]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsc-chat-head",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `dsc-dot${peer.reachable ? " on" : ""}` }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dsc-chat-title",
										children: peerName(peer)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsc-chat-sub",
										children: [
											peer.reachable ? tr("online") : tr("offline"),
											" · ",
											peer.host,
											":",
											peer.port
										]
									})] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsc-spacer" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: "dsc-btn",
										disabled: busy,
										onClick: () => {
											run(async () => {
												const info = await checkUpdates();
												const short = (commit) => commit === void 0 ? "?" : commit.slice(0, 7);
												if (info.error !== void 0) setNotice(tr("updateFailed", { message: info.error }));
												else if (info.upToDate) setNotice(tr("updateCurrent", {
													version: info.installed.version,
													commit: short(info.installed.commit)
												}));
												else setNotice(tr("updateAvailable", {
													commit: short(info.latest?.commit),
													date: info.latest?.date ?? ""
												}));
											});
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 13 }), tr("updateCheck")]
									}),
									confirmUnpair ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsc-row",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsc-hint",
												children: tr("unpairConfirm", { name: peerName(peer) })
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsc-btn",
												disabled: busy,
												onClick: startUnpair,
												children: tr("unpair")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsc-btn",
												onClick: () => {
													setConfirmUnpair(false);
												},
												children: tr("cancel")
											})
										]
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsc-btn dsc-icon-btn",
										title: tr("unpair"),
										onClick: startUnpair,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 13 })
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsc-thread",
								ref: threadRef,
								children: [messages.map((message) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: `dsc-msg ${message.dir === "in" ? "in" : "out"}`,
									children: [message.kind === "file" && message.file !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsc-file",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "dsc-file-name",
												children: message.file.name
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "dsc-file-size",
												children: formatSize(message.file.size)
											})] }),
											message.dir === "in" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsc-file-action",
												onClick: () => {
													download(message);
												},
												children: tr("download")
											}),
											message.dir === "out" && message.status === "pending" && (() => {
												const live = snapshot.progress[message.id];
												const percent = live !== void 0 && live.total > 0 ? Math.round(live.sent / live.total * 100) : void 0;
												return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsc-transfer",
													title: percent === void 0 ? void 0 : `${String(percent)}%`,
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsc-progress",
														children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsc-progress-fill",
															style: { width: `${String(percent ?? 8)}%` }
														})
													})
												});
											})()
										]
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dsc-bubble",
										children: message.text
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: `dsc-status${message.status === "failed" ? " failed" : ""}`,
										children: [formatTime(message.at, Date.now(), tr("timeNow")), message.dir === "out" && ` · ${message.status === "sent" ? tr("sent") : message.status === "pending" ? tr("pending") : tr("failed")}`]
									})]
								}, message.id)), messages.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsc-empty",
									style: { margin: "8px 0" },
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: tr("emptyThread") })
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsc-composer",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										className: "dsc-textarea",
										placeholder: tr("messagePlaceholder"),
										value: draft,
										onChange: (event) => {
											setDraft(event.target.value);
										},
										onKeyDown: (event) => {
											if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
												event.preventDefault();
												submit();
											}
										}
									}),
									upload !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsc-upload",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsc-hint",
											children: tr("uploadProgress", { percent: upload.total > 0 ? Math.round(upload.sent / upload.total * 100) : 0 })
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsc-progress",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsc-progress-fill",
												style: { width: `${String(upload.total > 0 ? Math.round(upload.sent / upload.total * 100) : 0)}%` }
											})
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsc-composer-row",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												ref: fileRef,
												type: "file",
												style: { display: "none" },
												onChange: (event) => {
													attach(event.target.files);
													event.target.value = "";
												}
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsc-btn dsc-icon-btn",
												title: tr("attach"),
												onClick: () => {
													fileRef.current?.click();
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPaperclipOutlineRegular, { size: 14 })
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: "dsc-check",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													checked: broadcast,
													onChange: (event) => {
														setBroadcast(event.target.checked);
													}
												}), tr("broadcast")]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsc-spacer" }),
											busy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsc-chat-sub",
												children: tr("sending")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "dsc-btn",
												disabled: busy,
												onClick: () => {
													run(async () => {
														await retryDelivery();
													});
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 13 }), tr("retry")]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "dsc-btn primary",
												disabled: busy || draft.trim() === "",
												onClick: submit,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSendOutlineRegular, { size: 13 }), tr("send")]
											})
										]
									})
								]
							})
						] }),
						loading && state === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsc-hint",
							style: { padding: "12px" },
							children: tr("loading")
						})
					]
				})]
			});
		}
		// src/client/InboxIcon.tsx
		/**
		* Sidebar entry for Smoothly Chat: a mail icon with an unread dot.
		*
		* The icon lives in a list slot that stays mounted while another panel is open,
		* so it is the one place the unread count is always visible — which is exactly
		* why freshness starts in the plugin entry rather than on first panel mount.
		*/
		/** The sidebar icon. */
		function InboxIcon({ size = 18 }) {
			const snapshot = useInbox();
			const unread = (snapshot.state?.peers ?? []).reduce((sum, peer) => sum + peer.unread, 0);
			const pendingRequests = snapshot.state?.requests?.length ?? 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "dsc-icon",
				title: unread > 0 ? String(unread) : void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EnvelopeIcon, { size }), (unread > 0 || pendingRequests > 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsc-icon-dot" })]
			});
		}
		// src/client/locales.ts
		/**
		* Locale dictionaries for DSH Smoothly Chat. The Chinese dictionary is the
		* key-set source of truth; English must stay key-identical.
		*/
		/** Dictionary namespace owned by this plugin. */
		const NS = "smoothly.chat";
		/** Simplified Chinese copy. */
		const zh = {
			panel: "思磨力讯",
			title: "思磨力讯",
			peers: "对端",
			addPeer: "添加对端",
			addPeerTitle: "添加对端",
			pairHint: "把另一台机器「添加对端」里生成的邀请串粘贴到这里。",
			pairPlaceholder: "dsh-peer://192.168.1.20:47811#…",
			pairAction: "配对",
			pairing: "配对中…",
			invite: "生成本机邀请串",
			inviteTitle: "本机邀请串",
			inviteHint: "在另一台机器上：思磨力讯 → 添加对端 → 粘贴这一串。24 小时内有效。",
			copy: "复制",
			copied: "已复制",
			cancel: "取消",
			close: "关闭",
			emptyPeers: "还没有对端。粘贴一条邀请串开始。",
			emptyThread: "选择左侧的对端开始发送。",
			emptyThreadHint: "只会进这台机器的信箱，不会触发任何会话。",
			messagePlaceholder: "输入消息…（Enter 发送，Shift+Enter 换行）",
			send: "发送",
			broadcast: "发给所有对端",
			attach: "添加文件",
			online: "在线",
			offline: "离线",
			pending: "发送中",
			sent: "已送达",
			failed: "发送失败",
			retry: "立即重试",
			unpair: "解除配对",
			unpairConfirm: "解除与 {name} 的配对？本地历史仍保留。",
			download: "下载",
			file: "文件",
			lanOk: "本机在局域网上可达",
			lanWarn: "没有找到局域网地址：另一台机器可能连不上本机",
			serverError: "信箱端口启动失败：{message}",
			port: "端口",
			selfLine: "本机 · {name} · {address}:{port}",
			loading: "加载中…",
			self: "本机",
			unread: "{count} 条未读",
			dropHint: "松开以发送文件",
			sending: "发送中…",
			pairFailed: "配对失败：{message}",
			actionFailed: "操作失败：{message}",
			noPeersForBroadcast: "还没有可发送的对端",
			requestsTitle: "{count} 个配对请求",
			requestLine: "{name} · {address}:{port}",
			approve: "接受",
			deny: "拒绝",
			pairPending: "等待对方确认",
			pairRequestSent: "配对请求已发送，等待对方接受。",
			noticeDismiss: "知道了",
			updateCheck: "检查更新",
			updateChecking: "检查中…",
			updateCurrent: "已是最新（{version} @ {commit}）",
			updateAvailable: "有新版本：{commit}（{date}）—— 在 Plugins 页更新插件",
			updateFailed: "检查失败：{message}",
			timeNow: "刚刚",
			requestAddress: "{address}:{port}",
			uploadProgress: "上传中 {percent}%"
		};
		/** English copy, key-identical to the Chinese source of truth. */
		const en = {
			panel: "Smoothly Chat",
			title: "Smoothly Chat",
			peers: "Peers",
			addPeer: "Add peer",
			addPeerTitle: "Add peer",
			pairHint: "Paste the invitation string generated by the other machine.",
			pairPlaceholder: "dsh-peer://192.168.1.20:47811#…",
			pairAction: "Pair",
			pairing: "Pairing…",
			invite: "Create invitation",
			inviteTitle: "This machine’s invitation",
			inviteHint: "On the other machine: Smoothly Chat → Add peer → paste this. Valid for 24 hours.",
			copy: "Copy",
			copied: "Copied",
			cancel: "Cancel",
			close: "Close",
			emptyPeers: "No peers yet. Paste an invitation to start.",
			emptyThread: "Pick a peer on the left to start.",
			emptyThreadHint: "Messages stay in this machine’s inbox and never start a conversation.",
			messagePlaceholder: "Message… (Enter to send, Shift+Enter for a new line)",
			send: "Send",
			broadcast: "Send to every peer",
			attach: "Attach a file",
			online: "online",
			offline: "offline",
			pending: "sending",
			sent: "delivered",
			failed: "failed",
			retry: "Retry now",
			unpair: "Unpair",
			unpairConfirm: "Unpair from {name}? Local history stays on disk.",
			download: "Download",
			file: "File",
			lanOk: "This machine is reachable on the LAN",
			lanWarn: "No LAN address found — the other machine may not reach this one",
			serverError: "Mailbox listener failed to start: {message}",
			port: "Port",
			selfLine: "This machine · {name} · {address}:{port}",
			loading: "Loading…",
			self: "This machine",
			unread: "{count} unread",
			dropHint: "Drop to send the file",
			sending: "Sending…",
			pairFailed: "Pairing failed: {message}",
			actionFailed: "Action failed: {message}",
			noPeersForBroadcast: "No peer to send to yet",
			requestsTitle: "{count} pairing request(s)",
			requestLine: "{name} · {address}:{port}",
			approve: "Approve",
			deny: "Decline",
			pairPending: "waiting for approval",
			pairRequestSent: "Pairing request sent — waiting for the other machine to approve.",
			noticeDismiss: "Got it",
			updateCheck: "Check for updates",
			updateChecking: "Checking…",
			updateCurrent: "Up to date ({version} @ {commit})",
			updateAvailable: "Update available: {commit} ({date}) — update the plugin from the Plugins page",
			updateFailed: "Update check failed: {message}",
			timeNow: "now",
			requestAddress: "{address}:{port}",
			uploadProgress: "Uploading {percent}%"
		};
		// src/client/index.ts
		/** Panel id; the sidebar row and the main panel share it. */
		const PANEL_ID = "smoothly-chat";
		/** Required client services: additive slots and the locale registry. */
		const inject = ["slots", "locale"];
		/** Client entry point. */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "smoothly-chat: locale");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				locale: NS
			}, InboxPage));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 45,
				locale: NS,
				label: () => t("panel")
			}, InboxIcon));
			startClient();
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map