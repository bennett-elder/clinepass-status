/**
 * Snapshot cache.
 *
 * The status line may be rendered on every prompt or every few seconds by a
 * terminal multiplexer, so reads must never touch the network. We store the
 * last successful fetch and serve it until it ages past the TTL.
 */

import fs from "node:fs";
import path from "node:path";
import { cacheFile } from "./paths.mjs";

export const DEFAULT_TTL_MS = 60_000;

/** Read the cached snapshot, or null when absent/corrupt. */
export function readCache(env = process.env) {
	const file = cacheFile(env);
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
		if (!parsed?.limits || typeof parsed.fetchedAt !== "number") return null;
		return parsed;
	} catch {
		return null;
	}
}

/**
 * Write text atomically: temp file in the same directory, then rename.
 * Renames within one directory are atomic on POSIX, so a concurrent reader
 * never observes a half-written file. Used for both the JSON cache and the
 * plain-text line file that prompts read.
 */
export function writeAtomic(file, text) {
	const dir = path.dirname(file);
	fs.mkdirSync(dir, { recursive: true });

	const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
	fs.writeFileSync(tmp, text, "utf8");
	fs.renameSync(tmp, file);
}

/**
 * Persist a snapshot.
 */
export function writeCache(snapshot, env = process.env) {
	writeAtomic(cacheFile(env), `${JSON.stringify(snapshot, null, 2)}\n`);
}

export function isFresh(snapshot, ttlMs = DEFAULT_TTL_MS, now = Date.now()) {
	if (!snapshot || typeof snapshot.fetchedAt !== "number") return false;
	return now - snapshot.fetchedAt < ttlMs;
}

/** Age in whole seconds, for "--debug" and stale warnings. */
export function ageSeconds(snapshot, now = Date.now()) {
	if (!snapshot || typeof snapshot.fetchedAt !== "number") return null;
	return Math.max(0, Math.round((now - snapshot.fetchedAt) / 1000));
}
