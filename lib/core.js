import { hostname, networkInterfaces } from "node:os";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createServer } from "node:http";
import { pipeline } from "node:stream/promises";
// src/core/protocol.ts
/**
* Wire protocol v1 for DSH Smoothly Chat (思磨力讯).
*
* Design constraints this file encodes:
*  - plain HTTP, one request per action — no long-lived sockets;
*  - every authenticated request is signed with the *per-pair* key, so a
*    message from C can never be replayed to B;
*  - the signature covers method, path, timestamp, nonce and the body digest,
*    so a captured request cannot be re-aimed or re-sent;
*  - files are signed through their SHA-256 header, which lets both sides
*    stream the body instead of buffering it in memory.
*/
/** Current protocol version. Both sides must agree before exchanging bodies. */
const PROTOCOL_VERSION = 1;
/** Header carrying the protocol version. */
const PROTO_HEADER = "x-dsc-proto";
/** Header carrying the sending device id. */
const DEVICE_HEADER = "x-dsc-device";
/** Header carrying the millisecond timestamp used by the signature. */
const TS_HEADER = "x-dsc-ts";
/** Header carrying the single-use nonce used by the signature. */
const NONCE_HEADER = "x-dsc-nonce";
/** Header carrying the base64url HMAC-SHA256 signature. */
const SIG_HEADER = "x-dsc-sig";
/** Header carrying the URI-encoded file name of a file upload. */
const FILE_NAME_HEADER = "x-dsc-file-name";
/** Header carrying the byte size of a file upload. */
const FILE_SIZE_HEADER = "x-dsc-file-size";
/** Header carrying the hex SHA-256 of a file upload body. */
const FILE_SHA_HEADER = "x-dsc-file-sha256";
/** Accepted clock skew for a signed request. */
const TS_WINDOW_MS = 9e4;
/** Default largest accepted text envelope. */
const MAX_TEXT_BYTES = 1048576;
/** Default largest accepted file body. */
const MAX_FILE_BYTES = 209715200;
/** How long a pairing invitation stays usable. */
const INVITE_TTL_MS = 864e5;
/** Generate a random base64url identifier. */
function randomId(bytes = 16) {
	return randomBytes(bytes).toString("base64url");
}
/** Hex SHA-256 of a string or byte view. */
function sha256Hex(data) {
	return createHash("sha256").update(data).digest("hex");
}
/** Canonical string a signature is computed over. */
function canonical(method, pathname, ts, nonce, bodySha) {
	return `${method.toUpperCase()}\n${pathname}\n${String(ts)}\n${nonce}\n${bodySha}`;
}
/** HMAC-SHA256 signature (base64url) for one canonical string. */
function sign(key, canonicalText) {
	return createHmac("sha256", Buffer.from(key, "base64url")).update(canonicalText).digest("base64url");
}
/** Constant-time signature comparison that never throws on length mismatch. */
function verifySignature(key, canonicalText, signature) {
	const expected = sign(key, canonicalText);
	const a = Buffer.from(expected, "utf8");
	const b = Buffer.from(signature, "utf8");
	return a.length === b.length && timingSafeEqual(a, b);
}
/** Render the invitation string a peer pastes into the other machine. */
function formatPairingString(input) {
	return `dsh-peer://${input.host.includes(":") ? `[${input.host}]` : input.host}:${String(input.port)}#${input.deviceId}.${input.key}`;
}
/**
* Parse a pasted invitation. Accepts only the `dsh-peer:` scheme and requires
* a concrete host, a numeric port, a device id and a key; anything else is a
* user-facing format error rather than a silent half-pairing.
*/
function parsePairingString(value) {
	const trimmed = value.trim();
	if (!trimmed.startsWith("dsh-peer://")) throw new Error("pairing string must start with dsh-peer://");
	let url;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error("pairing string is not a valid URL");
	}
	if (url.protocol !== "dsh-peer:") throw new Error("pairing string must start with dsh-peer://");
	const hash = url.hash.slice(1);
	const dot = hash.indexOf(".");
	if (dot <= 0) throw new Error("pairing string is missing the device id or key");
	const deviceId = hash.slice(0, dot);
	const key = hash.slice(dot + 1);
	if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) throw new Error("pairing string has an invalid device id");
	if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new Error("pairing string has an invalid key");
	if (url.hostname === "") throw new Error("pairing string is missing the host");
	const port = Number(url.port);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("pairing string has an invalid port");
	return {
		host: url.hostname.replace(/^\[|\]$/gu, ""),
		port,
		deviceId,
		key
	};
}
/**
* Reduce an arbitrary file name to one safe path segment: no separators, no
* control characters, no leading dots and a bounded length. The message id is
* the directory, so even a hostile name cannot escape it.
*/
function safeFileName(raw) {
	const cleaned = (raw.split(/[\\/]/u).pop() ?? raw).replace(/[\u0000-\u001f\u007f<>:"|?*]/gu, "_").replace(/^\.+/u, "").trim().slice(0, 120);
	return cleaned === "" ? "file" : cleaned;
}
/** Normalize a socket remote address (`::ffff:1.2.3.4` → `1.2.3.4`). */
function normalizeRemoteAddress(address) {
	if (address === void 0) return "";
	return address.startsWith("::ffff:") ? address.slice(7) : address;
}
/** Format a host/port pair as an origin, bracketing IPv6 literals. */
function originOf(host, port) {
	return `http://${host.includes(":") ? `[${host}]` : host}:${String(port)}`;
}
// src/core/server.ts
/**
* The peer-facing HTTP server: the only surface another machine can reach.
*
* It exists as its own listener (instead of a route on DSH's web server) on
* purpose: DSH's server refuses wildcard binds precisely because it fronts an
* agent that can run commands. This server exposes nothing but an inbox —
* four signed endpoints — so opening it to the LAN cannot reach a session, a
* tool, or the GUI.
*
* Every endpoint except `pair` requires an already established pair; `pair`
* itself requires a key minted by this machine (the invitation), so an
* unpaired machine cannot compute a valid signature at all.
*/
/** Delay before a failed-auth IP is refused outright. */
const BAN_MS = 6e4;
/** Failed authentications that trigger a ban. */
const FAILURES_TO_BAN = 5;
/** Requests per IP per minute. */
const RATE_LIMIT = 240;
/** Pairing candidate requests may be large enough for a long device name. */
const MAX_PAIR_BYTES = 65536;
/** Transport-level failure mapped to one HTTP response. */
var HttpError = class extends Error {
	status;
	code;
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
};
function errorBody(code, message) {
	return {
		ok: false,
		error: {
			code,
			message
		}
	};
}
function sendJson$1(res, status, value) {
	if (res.writableEnded) return;
	const text = JSON.stringify(value);
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("content-length", String(Buffer.byteLength(text)));
	res.end(text);
}
function header(req, name) {
	const value = req.headers[name];
	return typeof value === "string" ? value : void 0;
}
/** Read a request body with a hard byte ceiling. */
async function readBody(req, limit) {
	const declared = Number(header(req, "content-length"));
	if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, "too-large", `body exceeds ${String(limit)} bytes`);
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const bytes = chunk;
		total += bytes.length;
		if (total > limit) throw new HttpError(413, "too-large", `body exceeds ${String(limit)} bytes`);
		chunks.push(bytes);
	}
	return Buffer.concat(chunks);
}
/** The mailbox listener owned by one ChatNode. */
var PeerServer = class {
	store;
	host;
	logger;
	onInbox;
	maxTextBytes;
	maxFileBytes;
	now;
	http;
	rate = /* @__PURE__ */ new Map();
	bans = /* @__PURE__ */ new Map();
	failures = /* @__PURE__ */ new Map();
	seenNonces = /* @__PURE__ */ new Map();
	boundPort;
	constructor(options) {
		this.store = options.store;
		this.host = options.host ?? "0.0.0.0";
		this.logger = options.logger ?? (() => {});
		this.onInbox = options.onInbox;
		this.maxTextBytes = options.maxTextBytes ?? 1048576;
		this.maxFileBytes = options.maxFileBytes ?? 209715200;
		this.now = options.now ?? (() => Date.now());
		this.boundPort = options.port;
		this.http = createServer((req, res) => {
			this.handle(req, res);
		});
	}
	/** Port actually bound (useful when constructed with port 0). */
	get port() {
		return this.boundPort;
	}
	/**
	* Begin listening; resolves with the bound port.
	* @param ports - candidate ports in preference order; a busy port falls
	* through to the next one so a taken default never disables the mailbox.
	*/
	async start(ports) {
		const candidates = ports ?? [this.boundPort];
		let lastError;
		for (const candidate of candidates) try {
			await new Promise((resolve, reject) => {
				const onError = (error) => {
					reject(error);
				};
				this.http.once("error", onError);
				this.http.listen(candidate, this.host, () => {
					this.http.off("error", onError);
					resolve();
				});
			});
			const address = this.http.address();
			if (address !== null && typeof address === "object") this.boundPort = address.port;
			this.logger(`[smoothly-chat] peer server listening on ${this.host}:${String(this.boundPort)}`);
			return this.boundPort;
		} catch (error) {
			lastError = error;
			if (error.code !== "EADDRINUSE") throw error;
			this.logger(`[smoothly-chat] port ${String(candidate)} is busy, trying the next one`);
		}
		throw lastError instanceof Error ? lastError : new Error(String(lastError));
	}
	/** Stop listening and drop open sockets. */
	async stop() {
		if (!this.http.listening) return;
		this.http.closeAllConnections();
		await new Promise((resolve) => {
			this.http.close(() => {
				resolve();
			});
		});
	}
	async handle(req, res) {
		const remote = normalizeRemoteAddress(req.socket.remoteAddress);
		let pathname = "/";
		try {
			pathname = new URL(req.url ?? "/", "http://smoothly-chat.local").pathname;
			if (!this.admit(remote)) throw new HttpError(429, "rate-limited", "too many requests");
			switch (pathname) {
				case "/peer/v1/pair":
					await this.handlePair(req, res, remote);
					break;
				case "/peer/v1/hello":
					await this.handleHello(req, res, pathname, remote);
					break;
				case "/peer/v1/messages":
					await this.handleText(req, res, pathname, remote);
					break;
				case "/peer/v1/files":
					await this.handleFile(req, res, pathname, remote);
					break;
				case "/peer/v1/unpair":
					await this.handleUnpair(req, res, pathname, remote);
					break;
				default: throw new HttpError(404, "not-found", "unknown endpoint");
			}
		} catch (error) {
			const failure = error instanceof HttpError ? error : new HttpError(500, "internal", error instanceof Error ? error.message : String(error));
			if (failure.status === 401 || failure.status === 403) this.noteAuthFailure(remote);
			this.logger(`[smoothly-chat] ${pathname} from ${remote} → ${String(failure.status)} ${failure.code}`);
			sendJson$1(res, failure.status, errorBody(failure.code, failure.message));
			req.resume();
		}
	}
	/** Token bucket plus temporary bans, keyed by connect address. */
	admit(remote) {
		const now = this.now();
		const bannedUntil = this.bans.get(remote);
		if (bannedUntil !== void 0) {
			if (bannedUntil > now) return false;
			this.bans.delete(remote);
		}
		const bucket = this.rate.get(remote);
		if (bucket === void 0 || bucket.resetAt <= now) {
			this.rate.set(remote, {
				count: 1,
				resetAt: now + 6e4
			});
			return true;
		}
		bucket.count += 1;
		return bucket.count <= RATE_LIMIT;
	}
	noteAuthFailure(remote) {
		if (remote === "") return;
		const failures = (this.failures.get(remote) ?? 0) + 1;
		this.failures.set(remote, failures);
		if (failures >= FAILURES_TO_BAN) {
			this.bans.set(remote, this.now() + BAN_MS);
			this.failures.delete(remote);
			this.logger(`[smoothly-chat] ${remote} banned for ${String(BAN_MS / 1e3)}s after repeated auth failures`);
		}
	}
	/** Validate the signed-request headers that every route shares. */
	signedRequest(req) {
		const deviceId = header(req, "x-dsc-device") ?? "";
		const ts = Number(header(req, TS_HEADER));
		const nonce = header(req, "x-dsc-nonce") ?? "";
		const signature = header(req, "x-dsc-sig") ?? "";
		if (deviceId === "" || nonce === "" || signature === "" || !Number.isFinite(ts)) throw new HttpError(401, "unsigned", "signed request headers are required");
		if (header(req, "x-dsc-proto") !== String(1)) throw new HttpError(400, "unsupported-protocol", `expected protocol ${String(1)}`);
		if (Math.abs(this.now() - ts) > 9e4) throw new HttpError(401, "stale-timestamp", "request timestamp is outside the accepted window");
		return {
			deviceId,
			ts,
			nonce,
			signature
		};
	}
	/** Reject a nonce that was already accepted from this device. */
	claimNonce(deviceId, nonce) {
		this.pruneNonces();
		const key = `${deviceId}:${nonce}`;
		if (this.seenNonces.has(key)) throw new HttpError(401, "replayed-nonce", "this request was already delivered");
		this.seenNonces.set(key, this.now());
	}
	pruneNonces() {
		if (this.seenNonces.size < 4096) return;
		const cutoff = this.now() - 2 * TS_WINDOW_MS;
		for (const [key, at] of this.seenNonces) if (at < cutoff) this.seenNonces.delete(key);
	}
	/** Authenticate one request against the pair key; returns the peer row. */
	async authenticate(req, pathname, bodySha, remote) {
		const { deviceId, ts, nonce, signature } = this.signedRequest(req);
		const peer = this.store.peer(deviceId);
		if (peer === void 0) throw new HttpError(401, "unknown-device", "this machine is not paired with you");
		const text = canonical(req.method ?? "GET", pathname, ts, nonce, bodySha);
		if (!verifySignature(peer.key, text, signature)) throw new HttpError(401, "bad-signature", "request signature does not match the pair key");
		this.claimNonce(deviceId, nonce);
		const patch = { lastSeenAt: this.now() };
		if (peer.lastError !== void 0) patch.lastError = void 0;
		if (remote !== "" && remote !== peer.host) patch.host = remote;
		await this.store.patchPeer(deviceId, patch);
		return peer;
	}
	/**
	* Record a pairing request. Holding the invitation key proves the caller may
	* *ask*; a human on this machine still decides. Nothing is paired until
	* `approveRequest` runs, and a request never grants message access.
	*/
	async handlePair(req, res, remote) {
		if (req.method !== "POST") throw new HttpError(405, "method-not-allowed", "use POST");
		const signed = this.signedRequest(req);
		const body = await readBody(req, MAX_PAIR_BYTES);
		const bodySha = sha256Hex(body);
		let parsed;
		try {
			parsed = JSON.parse(body.toString("utf8"));
		} catch {
			throw new HttpError(400, "bad-body", "pair body must be JSON");
		}
		if (parsed.v !== 1 || typeof parsed.device?.deviceId !== "string" || typeof parsed.device.name !== "string" || !Number.isInteger(parsed.device.port) || parsed.device.port < 1 || parsed.device.port > 65535) throw new HttpError(400, "bad-body", "pair body is incomplete");
		if (signed.deviceId !== parsed.device.deviceId) throw new HttpError(401, "bad-signature", "device header does not match the pairing body");
		if (parsed.device.deviceId === this.store.self.deviceId) throw new HttpError(400, "self-pairing", "cannot pair a machine with itself");
		const now = this.now();
		const text = canonical(req.method ?? "POST", "/peer/v1/pair", signed.ts, signed.nonce, bodySha);
		const matched = [...this.store.invites(now).map((invite) => ({
			key: invite.key,
			invite: invite.key
		})), ...this.store.peers().map((peer) => ({
			key: peer.key,
			invite: void 0
		}))].find((candidate) => verifySignature(candidate.key, text, signed.signature));
		if (matched === void 0) throw new HttpError(401, "bad-signature", "no invitation on this machine matches the signature");
		this.claimNonce(signed.deviceId, signed.nonce);
		const replyBase = {
			ok: true,
			v: 1,
			self: {
				...this.store.self,
				port: this.boundPort
			},
			at: now
		};
		const existing = this.store.peer(parsed.device.deviceId);
		if (existing?.pairedAt !== void 0) {
			await this.store.patchPeer(parsed.device.deviceId, {
				name: parsed.device.name.slice(0, 64),
				port: parsed.device.port,
				lastSeenAt: now,
				...remote === "" ? {} : { host: remote }
			});
			sendJson$1(res, 200, {
				...replyBase,
				paired: true
			});
			return;
		}
		if (this.store.deniedAt(parsed.device.deviceId, now) !== void 0) throw new HttpError(403, "pair-denied", "this machine declined the pairing request");
		await this.store.upsertPairRequest({
			deviceId: parsed.device.deviceId,
			name: parsed.device.name.slice(0, 64),
			host: remote !== "" ? remote : existing?.host ?? "",
			port: parsed.device.port,
			key: matched.key,
			requestedAt: existing?.addedAt ?? now,
			lastSeenAt: now
		});
		this.logger(`[smoothly-chat] pairing request from ${parsed.device.name} (${parsed.device.deviceId.slice(0, 8)}…) awaits approval`);
		sendJson$1(res, 200, {
			...replyBase,
			pending: true
		});
	}
	/** Authenticated identity probe: presence plus address self-heal. */
	async handleHello(req, res, pathname, remote) {
		if (req.method !== "GET") throw new HttpError(405, "method-not-allowed", "use GET");
		await this.authenticate(req, pathname, sha256Hex(""), remote);
		sendJson$1(res, 200, {
			ok: true,
			v: 1,
			self: {
				...this.store.self,
				port: this.boundPort
			},
			at: this.now()
		});
	}
	/** Persist one text message. */
	async handleText(req, res, pathname, remote) {
		if (req.method !== "POST") throw new HttpError(405, "method-not-allowed", "use POST");
		this.signedRequest(req);
		const body = await readBody(req, this.maxTextBytes);
		const peer = await this.authenticate(req, pathname, sha256Hex(body), remote);
		if (peer.pairedAt === void 0) throw new HttpError(403, "not-paired", "pairing is not confirmed yet");
		let envelope;
		try {
			envelope = JSON.parse(body.toString("utf8"));
		} catch {
			throw new HttpError(400, "bad-body", "message body must be JSON");
		}
		if (envelope.v !== 1 || envelope.kind !== "text" || typeof envelope.id !== "string" || typeof envelope.text !== "string" || envelope.from?.deviceId !== peer.deviceId) throw new HttpError(400, "bad-body", "message envelope is incomplete");
		if (envelope.to?.deviceId !== this.store.self.deviceId) throw new HttpError(400, "wrong-recipient", "message is addressed to another machine");
		if (this.store.hasMessage(peer.deviceId, envelope.id)) {
			sendJson$1(res, 200, {
				ok: true,
				duplicate: true
			});
			return;
		}
		await this.store.appendMessage(peer.deviceId, {
			id: envelope.id,
			dir: "in",
			kind: "text",
			at: this.now(),
			text: envelope.text,
			...envelope.batchId === void 0 ? {} : { batchId: envelope.batchId }
		});
		this.onInbox?.(peer.deviceId, envelope.id);
		sendJson$1(res, 200, { ok: true });
	}
	/** Stream one file to disk, verify its digest, then persist the message. */
	async handleFile(req, res, pathname, remote) {
		if (req.method !== "POST") throw new HttpError(405, "method-not-allowed", "use POST");
		const id = header(req, "x-dsc-msg-id") ?? "";
		const rawName = header(req, "x-dsc-file-name") ?? "";
		const declaredSize = Number(header(req, FILE_SIZE_HEADER));
		const digest = header(req, "x-dsc-file-sha256") ?? "";
		if (id === "" || rawName === "" || !Number.isFinite(declaredSize) || !/^[0-9a-f]{64}$/u.test(digest)) throw new HttpError(400, "bad-headers", "file upload headers are incomplete");
		if (declaredSize > this.maxFileBytes) throw new HttpError(413, "too-large", `file exceeds ${String(this.maxFileBytes)} bytes`);
		this.signedRequest(req);
		const name = safeFileName(decodeURIComponent(rawName));
		const peer = await this.authenticate(req, pathname, digest, remote);
		if (peer.pairedAt === void 0) throw new HttpError(403, "not-paired", "pairing is not confirmed yet");
		if (this.store.hasMessage(peer.deviceId, id)) {
			req.resume();
			sendJson$1(res, 200, {
				ok: true,
				duplicate: true
			});
			return;
		}
		const staged = this.store.tmpPath(id);
		const hash = createHash("sha256");
		let received = 0;
		try {
			await pipeline(req, async function* (source) {
				for await (const chunk of source) {
					received += chunk.length;
					if (received > declaredSize) throw new HttpError(413, "too-large", "file body is larger than announced");
					hash.update(chunk);
					yield chunk;
				}
			}, createWriteStream(staged, { mode: 384 }));
			if (received !== declaredSize) throw new HttpError(400, "size-mismatch", "file body is shorter than announced");
			if (hash.digest("hex") !== digest) throw new HttpError(400, "digest-mismatch", "file digest does not match the signed value");
			const dir = this.store.fileDir(id);
			await mkdir(dir, {
				recursive: true,
				mode: 448
			});
			const finalPath = join(dir, name);
			await rename(staged, finalPath);
			await this.store.appendMessage(peer.deviceId, {
				id,
				dir: "in",
				kind: "file",
				at: this.now(),
				file: {
					name,
					size: declaredSize,
					sha256: digest
				}
			});
			this.onInbox?.(peer.deviceId, id);
			sendJson$1(res, 200, {
				ok: true,
				size: declaredSize
			});
		} catch (error) {
			await rm(staged, { force: true });
			throw error;
		}
	}
	/** Remove a pair (the caller's side and ours). */
	async handleUnpair(req, res, pathname, remote) {
		if (req.method !== "POST") throw new HttpError(405, "method-not-allowed", "use POST");
		this.signedRequest(req);
		const body = await readBody(req, MAX_PAIR_BYTES);
		const peer = await this.authenticate(req, pathname, sha256Hex(body), remote);
		let parsed;
		try {
			parsed = JSON.parse(body.toString("utf8"));
		} catch {
			throw new HttpError(400, "bad-body", "unpair body must be JSON");
		}
		if (parsed.v !== 1 || parsed.device?.deviceId !== peer.deviceId) throw new HttpError(400, "bad-body", "unpair body does not match the caller");
		await this.store.removePeer(peer.deviceId);
		this.logger(`[smoothly-chat] unpaired ${peer.name}`);
		sendJson$1(res, 200, { ok: true });
	}
};
/** Compute the signed header set for an outbound call (also used by tests). */
function signedHeaderSet(input) {
	const ts = input.now ?? Date.now();
	const nonce = `${ts.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
	const text = canonical(input.method, input.pathname, ts, nonce, input.bodySha);
	return {
		[PROTO_HEADER]: String(1),
		[DEVICE_HEADER]: input.deviceId,
		[TS_HEADER]: String(ts),
		[NONCE_HEADER]: nonce,
		[SIG_HEADER]: sign(input.key, text)
	};
}
// src/core/outbox.ts
/**
* Outbound delivery queue.
*
* Every logical message gets one durable record under `outbox/` *and* one
* thread row with status `pending`. Delivery is per peer: a dead peer only
* stalls its own queue, never the others, and a restart resumes whatever is
* still on disk. Permanent failures (auth, wrong endpoint) stop retrying and
* surface as `failed`; transport failures keep retrying with capped backoff.
*/
/** Outbound queue owned by one ChatNode. */
var Outbox = class {
	store;
	fetchImpl;
	logger;
	now;
	onStatus;
	timer;
	inflight;
	running = false;
	stopped = false;
	constructor(options) {
		this.store = options.store;
		this.fetchImpl = options.fetch ?? fetch;
		this.logger = options.logger ?? (() => {});
		this.now = options.now ?? (() => Date.now());
		this.onStatus = options.onStatus;
	}
	/** Queue one text message for one peer and return its thread row. */
	async enqueueText(peerId, text, batchId) {
		const id = randomId(16);
		const at = this.now();
		const message = await this.store.appendMessage(peerId, {
			id,
			dir: "out",
			kind: "text",
			at,
			text,
			...batchId === void 0 ? {} : { batchId }
		});
		await this.store.saveOutbox({
			id,
			peerId,
			kind: "text",
			at,
			attempts: 0,
			...batchId === void 0 ? {} : { batchId },
			text
		});
		this.wake();
		return message;
	}
	/** Queue one file for one peer. The digest is computed once, up front. */
	async enqueueFile(peerId, path, name, batchId) {
		const info = await stat(path);
		if (!info.isFile()) throw new Error(`not a file: ${path}`);
		const digest = await hashFile(path);
		const id = randomId(16);
		const at = this.now();
		const fileName = (name ?? basename(path)).slice(0, 120);
		const message = await this.store.appendMessage(peerId, {
			id,
			dir: "out",
			kind: "file",
			at,
			file: {
				name: fileName,
				size: info.size,
				sha256: digest
			},
			...batchId === void 0 ? {} : { batchId }
		});
		await this.store.saveOutbox({
			id,
			peerId,
			kind: "file",
			at,
			attempts: 0,
			...batchId === void 0 ? {} : { batchId },
			file: {
				path,
				name: fileName,
				size: info.size,
				sha256: digest
			}
		});
		this.wake();
		return message;
	}
	/** Run one delivery pass now, ignoring backoff (used by tests and "retry"). */
	async flush() {
		if (this.inflight !== void 0) await this.inflight;
		await this.launch(true);
	}
	/** Stop scheduling further retries. */
	stop() {
		this.stopped = true;
		if (this.timer !== void 0) clearTimeout(this.timer);
		this.timer = void 0;
	}
	/** Schedule a pass soon; safe to call repeatedly. */
	wake(delayMs = 0) {
		if (this.stopped) return;
		if (this.timer !== void 0) return;
		this.timer = setTimeout(() => {
			this.timer = void 0;
			if (this.inflight !== void 0) {
				this.wake(200);
				return;
			}
			this.launch(false);
		}, delayMs);
		this.timer.unref?.();
	}
	/** Run one pass, remembering it so flush() can wait for an in-flight pass. */
	launch(ignoreSchedule) {
		if (this.inflight !== void 0) return this.inflight;
		const run = this.pass(ignoreSchedule).finally(() => {
			if (this.inflight === run) this.inflight = void 0;
		});
		this.inflight = run;
		return run;
	}
	async pass(ignoreSchedule) {
		if (this.running || this.stopped) return;
		this.running = true;
		try {
			const records = await this.store.listOutbox();
			let nextWake = Number.POSITIVE_INFINITY;
			for (const record of records) {
				if (this.stopped) return;
				const due = record.nextAt ?? 0;
				if (!ignoreSchedule && due > this.now()) {
					nextWake = Math.min(nextWake, due);
					continue;
				}
				const siblings = records.filter((candidate) => candidate.peerId === record.peerId);
				if (siblings[0]?.id !== record.id) continue;
				for (const candidate of siblings) {
					const outcome = await this.attempt(candidate);
					if (outcome.kind === "sent") {
						await this.store.appendStatus(candidate.peerId, candidate.id, "sent", this.now());
						await this.store.deleteOutbox(candidate.id);
						if (candidate.kind === "file" && candidate.file !== void 0 && this.store.isStaged(candidate.file.path)) await rm(candidate.file.path, { force: true });
						this.onStatus?.(candidate.peerId, candidate.id, "sent");
						continue;
					}
					const attempts = candidate.attempts + 1;
					if (outcome.kind === "permanent") {
						await this.store.appendStatus(candidate.peerId, candidate.id, "failed", this.now(), outcome.error);
						await this.store.patchPeer(candidate.peerId, { lastError: outcome.error });
						await this.store.deleteOutbox(candidate.id);
						this.onStatus?.(candidate.peerId, candidate.id, "failed", outcome.error);
						this.logger(`[smoothly-chat] delivery failed permanently: ${outcome.error}`);
						continue;
					}
					const delay = Math.min(6e4, 1e3 * 2 ** Math.min(attempts, 6));
					const nextAt = this.now() + Math.round(delay / 2 + Math.random() * delay / 2);
					await this.store.saveOutbox({
						...candidate,
						attempts,
						nextAt
					});
					nextWake = Math.min(nextWake, nextAt);
					this.logger(`[smoothly-chat] delivery retry in ${String(Math.round((nextAt - this.now()) / 1e3))}s: ${outcome.error}`);
					break;
				}
			}
			if (Number.isFinite(nextWake)) this.wake(Math.max(250, nextWake - this.now()));
		} finally {
			this.running = false;
		}
	}
	async attempt(record) {
		const peer = this.store.peer(record.peerId);
		if (peer === void 0) return {
			kind: "permanent",
			error: "peer is no longer paired"
		};
		try {
			if (record.kind === "text") return await this.deliverText(record, peer);
			return await this.deliverFile(record, peer);
		} catch (error) {
			return {
				kind: "retry",
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async deliverText(record, peer) {
		const body = JSON.stringify({
			v: 1,
			id: record.id,
			...record.batchId === void 0 ? {} : { batchId: record.batchId },
			from: { ...this.store.self },
			to: { deviceId: record.peerId },
			at: record.at,
			kind: "text",
			text: record.text ?? ""
		});
		const digest = sha256Hex(body);
		const headers = signedHeaderSet({
			deviceId: this.store.self.deviceId,
			key: peer.key,
			method: "POST",
			pathname: "/peer/v1/messages",
			bodySha: digest
		});
		const response = await this.fetchImpl(`${originOf(peer.host, peer.port)}/peer/v1/messages`, {
			method: "POST",
			headers: {
				...headers,
				"content-type": "application/json",
				"content-length": String(Buffer.byteLength(body))
			},
			body,
			signal: AbortSignal.timeout(15e3)
		});
		return this.classify(response);
	}
	async deliverFile(record, peer) {
		if (record.file === void 0) return {
			kind: "permanent",
			error: "outbox record has no file"
		};
		if ((await stat(record.file.path)).size !== record.file.size) return {
			kind: "permanent",
			error: "source file changed after it was queued"
		};
		const headers = signedHeaderSet({
			deviceId: this.store.self.deviceId,
			key: peer.key,
			method: "POST",
			pathname: "/peer/v1/files",
			bodySha: record.file.sha256
		});
		const response = await this.fetchImpl(`${originOf(peer.host, peer.port)}/peer/v1/files`, {
			method: "POST",
			headers: {
				...headers,
				"content-type": "application/octet-stream",
				"content-length": String(record.file.size),
				"x-dsc-msg-id": record.id,
				[FILE_NAME_HEADER]: encodeURIComponent(record.file.name),
				[FILE_SIZE_HEADER]: String(record.file.size),
				[FILE_SHA_HEADER]: record.file.sha256
			},
			body: createReadStream(record.file.path),
			duplex: "half",
			signal: AbortSignal.timeout(12e4)
		});
		return this.classify(response);
	}
	async classify(response) {
		if (response.ok) return { kind: "sent" };
		const detail = await response.text().catch(() => "");
		const error = `HTTP ${String(response.status)}${detail === "" ? "" : `: ${detail.slice(0, 200)}`}`;
		if (response.status === 401 || response.status === 403) return {
			kind: "permanent",
			error
		};
		if (response.status === 400 || response.status === 404 || response.status === 405 || response.status === 413) return {
			kind: "permanent",
			error
		};
		return {
			kind: "retry",
			error
		};
	}
};
/** Stream-hash one file (used once per queued file). */
async function hashFile(path) {
	const { createHash } = await import("node:crypto");
	const hash = createHash("sha256");
	await new Promise((resolve, reject) => {
		const stream = createReadStream(path);
		stream.on("data", (chunk) => {
			hash.update(chunk);
		});
		stream.on("error", reject);
		stream.on("end", () => {
			resolve();
		});
	});
	return hash.digest("hex");
}
// src/core/store.ts
/**
* Disk store for DSH Smoothly Chat.
*
* Layout under the plugin data root (default `~/.dsh/smoothly-chat`):
*
*   config.json           0600 — device identity, peer table (with keys), invites
*   state.json            0600 — per-peer read marks
*   threads/<peer>.jsonl  append-only message + delivery-status rows
*   files/<msgId>/<name>  received file bodies, one directory per message
*   outbox/<msgId>.json   pending outbound deliveries (survive restarts)
*   tmp/                  staging for atomic writes and incoming streams
*
* Every mutation goes through one mutex and lands with write-temp + rename, so
* a crash leaves either the old or the new file, never half of one. Thread
* rows are append-only and folded on read; the message id index is rebuilt at
* open, which is what makes redelivery idempotent.
*/
/** Serializes every state mutation in one process. */
var Mutex = class {
	chain = Promise.resolve();
	run(task) {
		const next = this.chain.then(task, task);
		this.chain = next.then(() => void 0, () => void 0);
		return next;
	}
};
/** Derive the default display name of this machine. */
function defaultDeviceName() {
	const raw = hostname().trim();
	return raw === "" ? "dsh" : raw;
}
/** Parse one JSONL file into rows, ignoring torn trailing lines. */
async function readJsonl(path) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
	const rows = [];
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		try {
			rows.push(JSON.parse(line));
		} catch {}
	}
	return rows;
}
/** Fold raw thread rows into messages with their latest delivery status. */
function foldThread(rows) {
	const status = /* @__PURE__ */ new Map();
	for (const row of rows) {
		if (row.t !== "status") continue;
		status.set(row.id, row.error === void 0 ? { status: row.status } : {
			status: row.status,
			error: row.error
		});
	}
	const messages = [];
	for (const row of rows) {
		if (row.t === "status") continue;
		messages.push({
			seq: row.seq,
			id: row.id,
			dir: row.dir,
			kind: row.kind,
			peerId: row.peerId,
			at: row.at,
			...row.batchId === void 0 ? {} : { batchId: row.batchId },
			...row.text === void 0 ? {} : { text: row.text },
			...row.file === void 0 ? {} : { file: row.file },
			status: row.dir === "in" ? "sent" : status.get(row.id)?.status ?? "pending",
			...status.get(row.id)?.error === void 0 ? {} : { error: status.get(row.id)?.error }
		});
	}
	return messages.sort((left, right) => left.seq - right.seq);
}
/** The disk-backed domain store. */
var Store = class Store {
	root;
	mutex = new Mutex();
	config;
	read;
	seqs = /* @__PURE__ */ new Map();
	messageIds = /* @__PURE__ */ new Map();
	unread = /* @__PURE__ */ new Map();
	constructor(root, config, read) {
		this.root = root;
		this.config = config;
		this.read = read;
	}
	/** Open (or initialize) the store at `root`. */
	static async open(root) {
		await mkdir(root, {
			recursive: true,
			mode: 448
		});
		for (const dir of [
			"threads",
			"files",
			"outbox",
			"tmp"
		]) await mkdir(join(root, dir), {
			recursive: true,
			mode: 448
		});
		const config = await loadConfig(root);
		const state = await loadState(root);
		const store = new Store(root, config, state.read);
		await store.reindex();
		return store;
	}
	/** This machine's identity. */
	get self() {
		return {
			deviceId: this.config.deviceId,
			name: this.config.name
		};
	}
	/** Peer table (defensive copy). */
	peers() {
		return this.config.peers.map((peer) => ({ ...peer }));
	}
	/** One peer by device id. */
	peer(deviceId) {
		const peer = this.config.peers.find((candidate) => candidate.deviceId === deviceId);
		return peer === void 0 ? void 0 : { ...peer };
	}
	/** Rename this machine. */
	async setName(name) {
		const trimmed = name.trim();
		if (trimmed === "") throw new Error("device name must not be empty");
		await this.mutex.run(async () => {
			this.config = {
				...this.config,
				name: trimmed.slice(0, 64)
			};
			await this.saveConfig();
		});
	}
	/** Insert or replace one peer. */
	async upsertPeer(peer) {
		return this.mutex.run(async () => {
			const index = this.config.peers.findIndex((candidate) => candidate.deviceId === peer.deviceId);
			const next = index === -1 ? [...this.config.peers, peer] : this.config.peers.map((candidate, at) => at === index ? peer : candidate);
			this.config = {
				...this.config,
				peers: next
			};
			await this.saveConfig();
			return { ...peer };
		});
	}
	/** Merge a patch into an existing peer without dropping its key. */
	async patchPeer(deviceId, patch) {
		return this.mutex.run(async () => {
			const current = this.config.peers.find((candidate) => candidate.deviceId === deviceId);
			if (current === void 0) return void 0;
			const next = {
				...current,
				...patch,
				deviceId: current.deviceId,
				key: current.key
			};
			this.config = {
				...this.config,
				peers: this.config.peers.map((candidate) => candidate.deviceId === deviceId ? next : candidate)
			};
			await this.saveConfig();
			return { ...next };
		});
	}
	/** Remove one peer (history files stay on disk until cleared). */
	async removePeer(deviceId) {
		await this.mutex.run(async () => {
			this.config = {
				...this.config,
				peers: this.config.peers.filter((peer) => peer.deviceId !== deviceId)
			};
			await this.saveConfig();
		});
	}
	/** Pairing requests waiting for approval, newest last. */
	pairRequests() {
		return this.config.requests.map((request) => ({ ...request }));
	}
	/** Insert or refresh a pending pairing request. */
	async upsertPairRequest(request) {
		await this.mutex.run(async () => {
			const others = this.config.requests.filter((candidate) => candidate.deviceId !== request.deviceId);
			this.config = {
				...this.config,
				requests: [...others, request]
			};
			await this.saveConfig();
		});
	}
	/** Remove one pending request (approved or denied). */
	async removePairRequest(deviceId) {
		await this.mutex.run(async () => {
			this.config = {
				...this.config,
				requests: this.config.requests.filter((candidate) => candidate.deviceId !== deviceId)
			};
			await this.saveConfig();
		});
	}
	/** Remember a refusal for one hour so the requesting machine learns. */
	async noteDenial(deviceId, now) {
		await this.mutex.run(async () => {
			const denied = { ...this.config.denied };
			denied[deviceId] = now;
			this.config = {
				...this.config,
				denied
			};
			await this.saveConfig();
		});
	}
	/** Whether this machine refused pairing with `deviceId` recently. */
	deniedAt(deviceId, now) {
		const at = this.config.denied[deviceId];
		return at !== void 0 && now - at < 36e5 ? at : void 0;
	}
	/** Mint a new invitation. */
	async createInvite(ttlMs, now) {
		const invite = {
			key: randomId(32),
			createdAt: now,
			expiresAt: now + ttlMs
		};
		await this.mutex.run(async () => {
			const kept = this.config.invites.filter((candidate) => candidate.expiresAt > now - 864e5);
			this.config = {
				...this.config,
				invites: [...kept, invite]
			};
			await this.saveConfig();
		});
		return { ...invite };
	}
	/** Invitations that are still usable. */
	invites(now) {
		return this.config.invites.filter((invite) => invite.usedBy === void 0 && invite.expiresAt > now).map((invite) => ({ ...invite }));
	}
	/** Mark an invitation consumed by a peer. */
	async markInviteUsed(key, deviceId, now) {
		await this.mutex.run(async () => {
			this.config = {
				...this.config,
				invites: this.config.invites.map((invite) => invite.key === key ? {
					...invite,
					usedBy: deviceId,
					usedAt: now
				} : invite)
			};
			await this.saveConfig();
		});
	}
	/** Append one message to a peer thread and return its stored form. */
	async appendMessage(peerId, input) {
		return this.mutex.run(async () => {
			const seq = (this.seqs.get(peerId) ?? 0) + 1;
			this.seqs.set(peerId, seq);
			const row = {
				t: "msg",
				seq,
				id: input.id,
				dir: input.dir,
				kind: input.kind,
				peerId,
				at: input.at,
				...input.batchId === void 0 ? {} : { batchId: input.batchId },
				...input.text === void 0 ? {} : { text: input.text },
				...input.file === void 0 ? {} : { file: input.file }
			};
			await this.appendThreadRow(peerId, row);
			const ids = this.messageIds.get(peerId) ?? /* @__PURE__ */ new Set();
			ids.add(input.id);
			this.messageIds.set(peerId, ids);
			if (input.dir === "in") this.unread.set(peerId, (this.unread.get(peerId) ?? 0) + 1);
			return {
				seq,
				id: input.id,
				dir: input.dir,
				kind: input.kind,
				peerId,
				at: input.at,
				...input.batchId === void 0 ? {} : { batchId: input.batchId },
				...input.text === void 0 ? {} : { text: input.text },
				...input.file === void 0 ? {} : { file: input.file },
				status: input.dir === "in" ? "sent" : "pending"
			};
		});
	}
	/** Append one delivery-status row. */
	async appendStatus(peerId, id, status, at, error) {
		await this.mutex.run(async () => {
			await this.appendThreadRow(peerId, {
				t: "status",
				id,
				status,
				at,
				...error === void 0 ? {} : { error }
			});
		});
	}
	/** Read one thread, newest window last. */
	async readThread(peerId, options = {}) {
		const folded = foldThread(await readJsonl(this.threadPath(peerId)));
		const before = options.beforeSeq ?? Number.POSITIVE_INFINITY;
		const window = folded.filter((message) => message.seq < before);
		const limit = options.limit ?? 200;
		return window.slice(Math.max(0, window.length - limit));
	}
	/** Number of unread inbound messages per peer. */
	unreadCounts() {
		return Object.fromEntries(this.unread);
	}
	/** Mark a thread read up to its current end. */
	async markRead(peerId) {
		await this.mutex.run(async () => {
			this.read = {
				...this.read,
				[peerId]: this.seqs.get(peerId) ?? 0
			};
			this.unread.set(peerId, 0);
			await this.saveState();
		});
	}
	/** One message by id within a thread. */
	async messageById(peerId, id) {
		return foldThread(await readJsonl(this.threadPath(peerId))).find((message) => message.id === id);
	}
	/** Whether a path lives inside this store's staging directory. */
	isStaged(path) {
		return path.startsWith(join(this.root, "tmp"));
	}
	/** Whether a message id already landed in a thread (idempotent redelivery). */
	hasMessage(peerId, id) {
		return this.messageIds.get(peerId)?.has(id) ?? false;
	}
	/** Absolute directory that owns one message's files. */
	fileDir(msgId) {
		return join(this.root, "files", safeSegment(msgId));
	}
	/** Stage path for an incoming file stream. */
	tmpPath(tag) {
		return join(this.root, "tmp", `${safeSegment(tag)}-${randomId(6)}.part`);
	}
	/** Persist one outbox record. */
	async saveOutbox(record) {
		await this.mutex.run(async () => {
			await this.writeJsonAtomic(join(this.root, "outbox", `${safeSegment(record.id)}.json`), record);
		});
	}
	/** All pending outbox records. */
	async listOutbox() {
		const dir = join(this.root, "outbox");
		let names;
		try {
			names = await readdir(dir);
		} catch (error) {
			if (error.code === "ENOENT") return [];
			throw error;
		}
		const records = [];
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			try {
				records.push(JSON.parse(await readFile(join(dir, name), "utf8")));
			} catch {}
		}
		return records.sort((left, right) => left.at - right.at);
	}
	/** Drop a delivered (or abandoned) outbox record. */
	async deleteOutbox(id) {
		await this.mutex.run(async () => {
			await rm(join(this.root, "outbox", `${safeSegment(id)}.json`), { force: true });
		});
	}
	threadPath(peerId) {
		return join(this.root, "threads", `${safeSegment(peerId)}.jsonl`);
	}
	async appendThreadRow(peerId, row) {
		await writeFile(this.threadPath(peerId), `${JSON.stringify(row)}\n`, {
			flag: "a",
			mode: 384
		});
	}
	async reindex() {
		const dir = join(this.root, "threads");
		const names = await readdir(dir).catch(() => []);
		for (const name of names) {
			if (!name.endsWith(".jsonl")) continue;
			const peerId = name.slice(0, -6);
			const rows = await readJsonl(join(dir, name));
			let lastSeq = 0;
			const ids = /* @__PURE__ */ new Set();
			let unread = 0;
			const readMark = this.read[peerId] ?? 0;
			for (const row of rows) {
				if (row.t !== "msg") continue;
				lastSeq = Math.max(lastSeq, row.seq);
				ids.add(row.id);
				if (row.dir === "in" && row.seq > readMark) unread += 1;
			}
			this.seqs.set(peerId, lastSeq);
			this.messageIds.set(peerId, ids);
			if (unread > 0) this.unread.set(peerId, unread);
		}
	}
	async saveConfig() {
		await this.writeJsonAtomic(join(this.root, "config.json"), this.config, 384);
	}
	async saveState() {
		const state = {
			version: 1,
			read: this.read
		};
		await this.writeJsonAtomic(join(this.root, "state.json"), state, 384);
	}
	async writeJsonAtomic(path, value, mode = 384) {
		const staged = join(this.root, "tmp", `${randomId(8)}.json`);
		await writeFile(staged, JSON.stringify(value, null, 2), { mode });
		await chmod(staged, mode);
		await rename(staged, path);
	}
};
/** Replace path separators and traversal dots in an id used as a path segment. */
function safeSegment(value) {
	return value.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 128);
}
async function loadConfig(root) {
	const path = join(root, "config.json");
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		if (parsed.version !== 1 || typeof parsed.deviceId !== "string" || !Array.isArray(parsed.peers)) throw new Error("config.json has an unsupported shape");
		return {
			...parsed,
			invites: Array.isArray(parsed.invites) ? parsed.invites : [],
			requests: Array.isArray(parsed.requests) ? parsed.requests : [],
			denied: typeof parsed.denied === "object" && parsed.denied !== null ? parsed.denied : {}
		};
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		const config = {
			version: 1,
			deviceId: randomId(16),
			name: defaultDeviceName(),
			peers: [],
			invites: [],
			requests: [],
			denied: {}
		};
		await writeFile(path, JSON.stringify(config, null, 2), { mode: 384 });
		await chmod(path, 384);
		return config;
	}
}
async function loadState(root) {
	try {
		const parsed = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
		if (parsed.version === 1 && typeof parsed.read === "object" && parsed.read !== null) return parsed;
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	return {
		version: 1,
		read: {}
	};
}
// src/core/node.ts
/**
* ChatNode — one machine's mailbox: identity, peer table, peer-facing server,
* outbox and presence. Everything the host half and the tests drive lives
* here; the DSH plugin entry is a thin adapter over this class.
*/
/** Whether an address belongs to a private (LAN / VPN / NAT) range. */
function isPrivate(address) {
	if (address.includes(":")) return address.startsWith("fd") || address.startsWith("fc") || address.startsWith("fe80");
	const [a, b] = address.split(".").map(Number);
	if (a === 10) return true;
	if (a === 192 && b === 168) return true;
	if (a === 172 && b !== void 0 && b >= 16 && b <= 31) return true;
	if (a === 169 && b === 254) return true;
	return false;
}
/** Cadence of the peer presence probe. */
const PRESENCE_INTERVAL_MS = 15e3;
/** One machine's mailbox. */
var ChatNode = class ChatNode {
	store;
	server;
	outbox;
	logger;
	now;
	onEvent;
	advertiseHost;
	presence = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	started = false;
	startFailure;
	presenceTimer;
	constructor(options, store) {
		this.store = store;
		this.logger = options.logger ?? (() => {});
		this.now = options.now ?? (() => Date.now());
		this.onEvent = options.onEvent;
		this.advertiseHost = options.advertiseHost;
		this.server = new PeerServer({
			store,
			port: options.port ?? 47810,
			...options.bindHost === void 0 ? {} : { host: options.bindHost },
			logger: this.logger,
			...options.maxFileBytes === void 0 ? {} : { maxFileBytes: options.maxFileBytes },
			now: this.now,
			onInbox: (peerId, messageId) => {
				this.emit({
					type: "inbox",
					peerId,
					messageId
				});
			}
		});
		this.outbox = new Outbox({
			store,
			...options.fetch === void 0 ? {} : { fetch: options.fetch },
			logger: this.logger,
			now: this.now,
			onStatus: (peerId, messageId, status, error) => {
				this.emit(error === void 0 ? {
					type: "status",
					peerId,
					messageId,
					status
				} : {
					type: "status",
					peerId,
					messageId,
					status,
					error
				});
			}
		});
	}
	/** Open the store and construct the node (does not listen yet). */
	static async create(options) {
		const store = await Store.open(options.root);
		if (options.name !== void 0) await store.setName(options.name);
		return new ChatNode(options, store);
	}
	/** Add a listener for mailbox events (the UI's SSE hub). */
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** Fan an event out to the constructor callback and every subscriber. */
	emit(event) {
		this.onEvent?.(event);
		for (const listener of this.listeners) try {
			listener(event);
		} catch {}
	}
	/** Identity of this machine. */
	get self() {
		return this.store.self;
	}
	/** Port the peer server listens on (0 before start). */
	get port() {
		return this.server.port;
	}
	/** Why the listener failed to start, if it did. */
	get lastError() {
		return this.startFailure;
	}
	/** Start listening and resume whatever the outbox still holds. */
	async start() {
		if (this.started) return this.server.port;
		let port;
		try {
			const preferred = this.server.port;
			port = await this.server.start(Array.from({ length: 10 }, (_, offset) => preferred + offset));
		} catch (error) {
			this.startFailure = error instanceof Error ? error.message : String(error);
			throw error;
		}
		this.started = true;
		this.retryPendingPairs();
		this.presenceTimer = setInterval(() => {
			this.probeAll();
			this.retryPendingPairs();
		}, PRESENCE_INTERVAL_MS);
		this.presenceTimer.unref?.();
		this.probeAll();
		return port;
	}
	/** Stop listening and cancel retries. */
	async stop() {
		if (this.presenceTimer !== void 0) clearInterval(this.presenceTimer);
		this.presenceTimer = void 0;
		this.outbox.stop();
		await this.server.stop();
		this.started = false;
	}
	/** Run one outbox pass immediately (tests, or the UI's retry button). */
	async flush() {
		await this.outbox.flush();
	}
	/** Retry pair confirmations that never completed, then drain the outbox. */
	async retryPendingPairs() {
		for (const peer of this.store.peers()) {
			if (peer.pairedAt !== void 0) continue;
			try {
				await this.confirm(peer.deviceId);
			} catch (error) {
				this.logger(`[smoothly-chat] pending pair with ${peer.name || peer.deviceId.slice(0, 8)} still failing: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		this.outbox.wake(50);
	}
	/** Local addresses, for the reachability self-check shown in the UI. */
	addresses() {
		const rows = [];
		for (const list of Object.values(networkInterfaces())) for (const info of list ?? []) {
			if (info.family !== "IPv4" && info.family !== "IPv6") continue;
			const address = info.address;
			const scope = address === "::1" || address.startsWith("127.") || address === "::" ? "loopback" : isPrivate(address) ? "private" : "public";
			rows.push({
				address,
				family: info.family,
				internal: info.internal,
				scope
			});
		}
		return rows.sort((left, right) => Number(left.internal) - Number(right.internal));
	}
	/** Address to advertise in invitations. */
	advertisedHost() {
		if (this.advertiseHost !== void 0 && this.advertiseHost !== "") return this.advertiseHost;
		const lan = this.addresses().find((row) => !row.internal && row.scope === "private" && row.family === "IPv4");
		const any = this.addresses().find((row) => !row.internal && row.family === "IPv4");
		return lan?.address ?? any?.address ?? "127.0.0.1";
	}
	/** Mint an invitation string for another machine. */
	async invite() {
		if (!this.started) throw new Error("start the peer server before minting an invitation");
		const invite = await this.store.createInvite(INVITE_TTL_MS, this.now());
		return {
			string: formatPairingString({
				host: this.advertisedHost(),
				port: this.server.port,
				deviceId: this.store.self.deviceId,
				key: invite.key
			}),
			key: invite.key,
			expiresAt: invite.expiresAt
		};
	}
	/**
	* Paste an invitation from the other machine. Stores the pending peer first
	* (so the pairing survives an offline peer) and then confirms it.
	*/
	async pair(invitation) {
		if (!this.started) throw new Error("start the peer server before pairing");
		const parsed = parsePairingString(invitation);
		if (parsed.deviceId === this.store.self.deviceId) throw new Error("this is this machine's own invitation");
		const existing = this.store.peer(parsed.deviceId);
		await this.store.upsertPeer({
			deviceId: parsed.deviceId,
			name: existing?.name ?? "",
			host: parsed.host,
			port: parsed.port,
			key: parsed.key,
			addedAt: existing?.addedAt ?? this.now(),
			...existing?.pairedAt === void 0 ? {} : { pairedAt: existing.pairedAt }
		});
		return this.confirm(parsed.deviceId);
	}
	/** Send (or retry) the confirmation half of a pairing. */
	async confirm(deviceId) {
		const peer = this.store.peer(deviceId);
		if (peer === void 0) throw new Error("unknown peer");
		const body = JSON.stringify({
			v: 1,
			device: {
				...this.store.self,
				port: this.server.port
			},
			at: this.now()
		});
		const headers = signedHeaderSet({
			deviceId: this.store.self.deviceId,
			key: peer.key,
			method: "POST",
			pathname: "/peer/v1/pair",
			bodySha: sha256Hex(body)
		});
		const response = await fetch(`${originOf(peer.host, peer.port)}/peer/v1/pair`, {
			method: "POST",
			headers: {
				...headers,
				"content-type": "application/json"
			},
			body,
			signal: AbortSignal.timeout(1e4)
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			const error = `pairing rejected: HTTP ${String(response.status)} ${detail.slice(0, 200)}`;
			await this.store.patchPeer(deviceId, {
				lastError: error,
				...response.status === 403 ? { pairDenied: true } : {}
			});
			throw new Error(error);
		}
		const reply = await response.json();
		if (reply.pending === true && reply.paired !== true) return await this.store.patchPeer(deviceId, {
			name: reply.self.name,
			port: reply.self.port,
			lastError: void 0
		}) ?? peer;
		const updated = await this.store.patchPeer(deviceId, {
			name: reply.self.name,
			port: reply.self.port,
			pairedAt: peer.pairedAt ?? this.now(),
			lastError: void 0,
			pairDenied: false
		});
		this.logger(`[smoothly-chat] paired with ${reply.self.name} (${deviceId.slice(0, 8)}…)`);
		this.emit({ type: "peers" });
		return updated ?? peer;
	}
	/** Approve a pending pairing request (the prompt shown in the panel). */
	async approveRequest(deviceId) {
		const request = this.store.pairRequests().find((candidate) => candidate.deviceId === deviceId);
		if (request === void 0) throw new Error("no such pairing request");
		const now = this.now();
		const peer = {
			deviceId: request.deviceId,
			name: request.name,
			host: request.host,
			port: request.port,
			key: request.key,
			addedAt: now,
			pairedAt: now,
			lastSeenAt: request.lastSeenAt
		};
		await this.store.upsertPeer(peer);
		await this.store.removePairRequest(deviceId);
		await this.store.markInviteUsed(request.key, deviceId, now);
		this.logger(`[smoothly-chat] approved pairing with ${peer.name} (${deviceId.slice(0, 8)}…)`);
		this.emit({ type: "peers" });
		return peer;
	}
	/** Decline a pending pairing request; the asking machine learns on its retry. */
	async denyRequest(deviceId) {
		await this.store.removePairRequest(deviceId);
		await this.store.noteDenial(deviceId, this.now());
		this.emit({ type: "peers" });
	}
	/** Pending pairing requests awaiting a human decision. */
	pairRequests() {
		return this.store.pairRequests().map((request) => ({
			deviceId: request.deviceId,
			name: request.name,
			host: request.host,
			port: request.port,
			requestedAt: request.requestedAt
		}));
	}
	/** Remove one pair on both sides (remote best effort). */
	async unpair(deviceId) {
		const peer = this.store.peer(deviceId);
		if (peer !== void 0) {
			const body = JSON.stringify({
				v: 1,
				device: { deviceId: this.store.self.deviceId },
				at: this.now()
			});
			const headers = signedHeaderSet({
				deviceId: this.store.self.deviceId,
				key: peer.key,
				method: "POST",
				pathname: "/peer/v1/unpair",
				bodySha: sha256Hex(body)
			});
			try {
				await fetch(`${originOf(peer.host, peer.port)}/peer/v1/unpair`, {
					method: "POST",
					headers: {
						...headers,
						"content-type": "application/json"
					},
					body,
					signal: AbortSignal.timeout(5e3)
				});
			} catch {}
		}
		await this.store.removePeer(deviceId);
		this.presence.delete(deviceId);
		this.emit({ type: "peers" });
	}
	/** Queue one text message for each peer; returns one row per peer. */
	async sendText(peerIds, text) {
		const batchId = randomId(8);
		const messages = [];
		for (const peerId of peerIds) {
			const peer = this.store.peer(peerId);
			if (peer === void 0 || peer.pairedAt === void 0) continue;
			messages.push(await this.outbox.enqueueText(peerId, text, batchId));
		}
		if (messages.length === 0) throw new Error("no paired peer to send to");
		this.outbox.flush().catch(() => {});
		return {
			batchId,
			messages
		};
	}
	/** Queue one file for each peer; returns one row per peer. */
	async sendFile(peerIds, path, name) {
		const batchId = randomId(8);
		const messages = [];
		for (const peerId of peerIds) {
			const peer = this.store.peer(peerId);
			if (peer === void 0 || peer.pairedAt === void 0) continue;
			messages.push(await this.outbox.enqueueFile(peerId, path, name, batchId));
		}
		if (messages.length === 0) throw new Error("no paired peer to send to");
		this.outbox.flush().catch(() => {});
		return {
			batchId,
			messages
		};
	}
	/** Probe one peer's peer server; updates the live presence map. */
	async probe(deviceId) {
		const peer = this.store.peer(deviceId);
		if (peer === void 0 || peer.pairedAt === void 0) return false;
		const headers = signedHeaderSet({
			deviceId: this.store.self.deviceId,
			key: peer.key,
			method: "GET",
			pathname: "/peer/v1/hello",
			bodySha: sha256Hex("")
		});
		try {
			const response = await fetch(`${originOf(peer.host, peer.port)}/peer/v1/hello`, {
				headers,
				signal: AbortSignal.timeout(5e3)
			});
			if (!response.ok) {
				this.presence.set(deviceId, {
					reachable: false,
					at: this.now()
				});
				return false;
			}
			const reply = await response.json();
			this.presence.set(deviceId, {
				reachable: true,
				at: this.now()
			});
			const patch = {
				lastSeenAt: this.now(),
				lastError: void 0
			};
			if (reply.self.name !== peer.name) patch.name = reply.self.name;
			if (reply.self.port !== peer.port) patch.port = reply.self.port;
			if (Object.keys(patch).length > 2 || reply.self.name !== peer.name || reply.self.port !== peer.port) await this.store.patchPeer(deviceId, patch);
			return true;
		} catch {
			this.presence.set(deviceId, {
				reachable: false,
				at: this.now()
			});
			return false;
		}
	}
	/** Probe every paired peer. */
	async probeAll() {
		await Promise.all(this.store.peers().map((peer) => this.probe(peer.deviceId)));
		return this.presenceSnapshot();
	}
	/** Current presence snapshot. */
	presenceSnapshot() {
		return Object.fromEntries(this.presence);
	}
};
// src/core/api.ts
/**
* Same-origin UI API for DSH Smoothly Chat.
*
* These routes are registered on DSH's own web server (so the page talks to its
* own origin with the normal boot token) and only manipulate the local mailbox.
* The peer-facing listener is a different server entirely; nothing here is
* reachable from another machine.
*
* The handler is deliberately DSH-free (plain node:http) so the repository
* scripts can mount it on a throwaway server and test it end to end.
*/
/** Default ceiling for one uploaded file. */
const DEFAULT_MAX_UPLOAD_BYTES = 209715200;
/** Ceiling for JSON request bodies. */
const MAX_JSON_BYTES = 2097152;
/** One API failure mapped to an HTTP response. */
var ApiError = class extends Error {
	status;
	constructor(status, message) {
		super(message);
		this.status = status;
	}
};
function sendJson(res, status, value) {
	if (res.writableEnded) return;
	const text = JSON.stringify(value);
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("content-length", String(Buffer.byteLength(text)));
	res.end(text);
}
/** Read and parse a JSON body with a hard ceiling. */
async function readJson(req, limit = MAX_JSON_BYTES) {
	const declared = Number(req.headers["content-length"]);
	if (Number.isFinite(declared) && declared > limit) throw new ApiError(413, "request body is too large");
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const bytes = chunk;
		total += bytes.length;
		if (total > limit) throw new ApiError(413, "request body is too large");
		chunks.push(bytes);
	}
	if (total === 0) return {};
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new ApiError(400, "request body must be JSON");
	}
}
/** Public view of a peer: never leaks the pair key. */
function publicPeer(peer, extras) {
	return {
		deviceId: peer.deviceId,
		name: peer.name,
		host: peer.host,
		port: peer.port,
		addedAt: peer.addedAt,
		...peer.pairedAt === void 0 ? {} : { pairedAt: peer.pairedAt },
		...peer.lastSeenAt === void 0 ? {} : { lastSeenAt: peer.lastSeenAt },
		...peer.lastError === void 0 ? {} : { lastError: peer.lastError },
		unread: extras.unread,
		reachable: extras.reachable
	};
}
/**
* Build the request handler. The caller owns authentication (DSH's route
* policy) and the route prefix registration.
*/
function createApiHandler(node, options = {}) {
	const prefix = options.prefix ?? "/smoothly-chat/api";
	const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
	const now = options.now ?? (() => Date.now());
	const streams = /* @__PURE__ */ new Set();
	const unsubscribe = node.subscribe((event) => {
		const payload = `data: ${JSON.stringify(event)}\n\n`;
		for (const stream of streams) {
			if (stream.writableEnded || stream.destroyed) {
				streams.delete(stream);
				continue;
			}
			stream.write(payload);
		}
	});
	async function handle(req, res) {
		const url = new URL(req.url ?? "/", "http://smoothly-chat.local");
		if (!url.pathname.startsWith(prefix)) throw new ApiError(404, "not found");
		const route = url.pathname.slice(prefix.length).replace(/\/+$/u, "") || "/";
		const method = req.method ?? "GET";
		if (route === "/state" && method === "GET") {
			const unread = node.store.unreadCounts();
			const presence = node.presenceSnapshot();
			const addresses = node.addresses();
			const peers = node.store.peers().map((peer) => publicPeer(peer, {
				unread: unread[peer.deviceId] ?? 0,
				reachable: presence[peer.deviceId]?.reachable ?? false
			}));
			sendJson(res, 200, {
				ok: true,
				protocolVersion: 1,
				self: {
					...node.self,
					port: node.port
				},
				addresses,
				lanReachable: addresses.some((row) => !row.internal && row.scope === "private"),
				peers,
				requests: node.pairRequests(),
				settings: {
					port: node.port,
					maxUploadBytes
				},
				serverError: node.lastError ?? null
			});
			return;
		}
		if (route === "/invite" && method === "POST") {
			sendJson(res, 200, {
				ok: true,
				...await node.invite()
			});
			return;
		}
		if (route === "/pair" && method === "POST") {
			const body = await readJson(req);
			if (typeof body.invitation !== "string" || body.invitation.trim() === "") throw new ApiError(400, "invitation is required");
			sendJson(res, 200, {
				ok: true,
				peer: publicPeer(await node.pair(body.invitation.trim()), {
					unread: 0,
					reachable: false
				})
			});
			return;
		}
		if (route === "/requests/approve" && method === "POST") {
			const body = await readJson(req);
			if (typeof body.deviceId !== "string" || body.deviceId === "") throw new ApiError(400, "deviceId is required");
			sendJson(res, 200, {
				ok: true,
				peer: publicPeer(await node.approveRequest(body.deviceId), {
					unread: 0,
					reachable: false
				})
			});
			return;
		}
		if (route === "/requests/deny" && method === "POST") {
			const body = await readJson(req);
			if (typeof body.deviceId !== "string" || body.deviceId === "") throw new ApiError(400, "deviceId is required");
			await node.denyRequest(body.deviceId);
			sendJson(res, 200, { ok: true });
			return;
		}
		if (route === "/unpair" && method === "POST") {
			const body = await readJson(req);
			if (typeof body.deviceId !== "string" || body.deviceId === "") throw new ApiError(400, "deviceId is required");
			await node.unpair(body.deviceId);
			sendJson(res, 200, { ok: true });
			return;
		}
		if (route === "/send" && method === "POST") {
			const body = await readJson(req);
			const text = typeof body.text === "string" ? body.text : "";
			if (text.trim() === "") throw new ApiError(400, "text is required");
			const peerIds = Array.isArray(body.peerIds) && body.peerIds.length > 0 ? body.peerIds.filter((id) => typeof id === "string") : node.store.peers().filter((peer) => peer.pairedAt !== void 0).map((peer) => peer.deviceId);
			if (peerIds.length === 0) throw new ApiError(400, "no paired peer to send to");
			const sent = await node.sendText(peerIds, text);
			sendJson(res, 200, {
				ok: true,
				batchId: sent.batchId,
				ids: sent.messages.map((message) => message.id)
			});
			return;
		}
		if (route === "/upload" && method === "POST") {
			const peerId = url.searchParams.get("peer") ?? "";
			const rawName = url.searchParams.get("name") ?? "file";
			if (peerId === "") throw new ApiError(400, "peer is required");
			const declared = Number(req.headers["content-length"]);
			if (Number.isFinite(declared) && declared > maxUploadBytes) throw new ApiError(413, "file is too large");
			const staged = node.store.tmpPath(`upload-${Date.now().toString(36)}`);
			let received = 0;
			try {
				await pipeline(req, async function* (source) {
					for await (const chunk of source) {
						received += chunk.length;
						if (received > maxUploadBytes) throw new ApiError(413, "file is too large");
						yield chunk;
					}
				}, createWriteStream(staged, { mode: 384 }));
				const sent = await node.sendFile([peerId], staged, rawName);
				sendJson(res, 200, {
					ok: true,
					batchId: sent.batchId,
					ids: sent.messages.map((message) => message.id)
				});
			} catch (error) {
				await rm(staged, { force: true });
				throw error;
			}
			return;
		}
		if (route === "/thread" && method === "GET") {
			const peerId = url.searchParams.get("peer") ?? "";
			if (peerId === "") throw new ApiError(400, "peer is required");
			const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? "200") || 200));
			const beforeRaw = url.searchParams.get("before");
			const before = beforeRaw === null ? void 0 : Number(beforeRaw);
			const messages = await node.store.readThread(peerId, {
				limit,
				...before !== void 0 && Number.isFinite(before) && before > 0 ? { beforeSeq: before } : {}
			});
			const peer = node.store.peer(peerId);
			sendJson(res, 200, {
				ok: true,
				peer: peer === void 0 ? null : publicPeer(peer, {
					unread: node.store.unreadCounts()[peerId] ?? 0,
					reachable: false
				}),
				messages
			});
			return;
		}
		if (route === "/read" && method === "POST") {
			const body = await readJson(req);
			if (typeof body.peerId !== "string" || body.peerId === "") throw new ApiError(400, "peerId is required");
			await node.store.markRead(body.peerId);
			sendJson(res, 200, { ok: true });
			return;
		}
		if (route === "/retry" && method === "POST") {
			await node.flush();
			sendJson(res, 200, { ok: true });
			return;
		}
		if (route === "/file" && method === "GET") {
			const peerId = url.searchParams.get("peer") ?? "";
			const id = url.searchParams.get("id") ?? "";
			if (peerId === "" || id === "") throw new ApiError(400, "peer and id are required");
			const message = await node.store.messageById(peerId, id);
			if (message?.file === void 0) throw new ApiError(404, "file not found");
			const path = join(node.store.fileDir(id), message.file.name);
			const info = await stat(path).catch(() => void 0);
			if (info === void 0 || !info.isFile()) throw new ApiError(404, "file not found");
			res.statusCode = 200;
			res.setHeader("content-type", "application/octet-stream");
			res.setHeader("content-length", String(info.size));
			res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(message.file.name)}`);
			await pipeline(createReadStream(path), res).catch(() => {});
			return;
		}
		if (route === "/events" && method === "GET") {
			res.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-transform",
				connection: "keep-alive",
				"x-accel-buffering": "no"
			});
			res.write("retry: 3000\n\n");
			res.write(`data: ${JSON.stringify({
				type: "ready",
				at: now()
			})}\n\n`);
			streams.add(res);
			const heartbeat = setInterval(() => {
				if (res.writableEnded || res.destroyed) return;
				res.write(": keep-alive\n\n");
			}, 2e4);
			heartbeat.unref?.();
			const close = () => {
				clearInterval(heartbeat);
				streams.delete(res);
			};
			req.on("close", close);
			res.on("close", close);
			return;
		}
		if (route === "/settings" && method === "GET") {
			sendJson(res, 200, {
				ok: true,
				settings: {
					name: node.self.name,
					port: node.port,
					maxUploadBytes
				}
			});
			return;
		}
		if (route === "/settings" && method === "POST") {
			const body = await readJson(req);
			if (typeof body.name === "string" && body.name.trim() !== "") await node.store.setName(body.name);
			sendJson(res, 200, {
				ok: true,
				settings: {
					name: node.self.name,
					port: node.port,
					maxUploadBytes
				}
			});
			return;
		}
		throw new ApiError(404, `unknown route ${method} ${route}`);
	}
	const mounted = ((req, res) => {
		handle(req, res).catch((error) => {
			const status = error instanceof ApiError ? error.status : 500;
			const message = error instanceof Error ? error.message : String(error);
			if (status >= 500) console.error("[smoothly-chat] api error:", error);
			sendJson(res, status, {
				ok: false,
				error: message
			});
			req.resume();
		});
	});
	mounted.dispose = () => {
		unsubscribe();
		for (const stream of streams) try {
			stream.end();
		} catch {}
		streams.clear();
	};
	return mounted;
}
export { ChatNode, DEVICE_HEADER, FILE_NAME_HEADER, FILE_SHA_HEADER, FILE_SIZE_HEADER, INVITE_TTL_MS, MAX_FILE_BYTES, MAX_TEXT_BYTES, NONCE_HEADER, Outbox, PROTOCOL_VERSION, PROTO_HEADER, PeerServer, SIG_HEADER, Store, TS_HEADER, TS_WINDOW_MS, canonical, createApiHandler, defaultDeviceName, formatPairingString, normalizeRemoteAddress, originOf, parsePairingString, randomId, safeFileName, sha256Hex, sign, signedHeaderSet, verifySignature };
