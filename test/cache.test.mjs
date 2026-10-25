import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isFresh, readCache, writeCache } from "../src/cache.mjs";
import { collect, parseArgs, run } from "../src/cli.mjs";

const BODY = {
	success: true,
	data: {
		limits: [
			{ type: "five_hour", percentUsed: 12, resetsAt: "2026-07-16T15:00:00Z" },
			{ type: "weekly", percentUsed: 25, resetsAt: "2026-07-20T00:00:00Z" },
			{ type: "monthly", percentUsed: 40, resetsAt: null },
		],
	},
};

/** Fresh cache dir per test, plus a fake credential so no real file is read. */
function tempEnv(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clinepass-status-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return { CLINEPASS_STATUS_CACHE_DIR: dir, CLINE_API_KEY: "sk-test" };
}

function okFetch(calls) {
	return async () => {
		calls.count += 1;
		return { ok: true, status: 200, json: async () => BODY };
	};
}

test("isFresh compares against the ttl", () => {
	const snapshot = { fetchedAt: 1_000, limits: {} };
	assert.equal(isFresh(snapshot, 60_000, 30_000), true);
	assert.equal(isFresh(snapshot, 60_000, 90_000), false);
	assert.equal(isFresh(null, 60_000, 0), false);
});

test("writeCache/readCache round-trips a snapshot", (t) => {
	const env = tempEnv(t);
	const snapshot = { fetchedAt: 1_234, limits: { fiveHour: { usedPercent: 5 } } };

	writeCache(snapshot, env);
	assert.deepEqual(readCache(env), snapshot);
});

test("collect serves a fresh cache without touching the network", async (t) => {
	const env = tempEnv(t);
	const now = 10_000_000;
	writeCache(
		{ fetchedAt: now - 5_000, limits: { weekly: { usedPercent: 25, resetsAt: null } } },
		env,
	);

	const calls = { count: 0 };
	const snapshot = await collect({ env, now, fetchImpl: okFetch(calls) });

	assert.equal(calls.count, 0);
	assert.equal(snapshot.source, "cache");
	assert.equal(snapshot.stale, false);
	assert.equal(snapshot.limits.weekly.usedPercent, 25);
});

test("collect fetches and caches when the snapshot is stale", async (t) => {
	const env = tempEnv(t);
	const now = 10_000_000;
	writeCache({ fetchedAt: now - 120_000, limits: { weekly: { usedPercent: 1 } } }, env);

	const calls = { count: 0 };
	const snapshot = await collect({ env, now, fetchImpl: okFetch(calls) });

	assert.equal(calls.count, 1);
	assert.equal(snapshot.source, "api");
	assert.equal(snapshot.limits.fiveHour.usedPercent, 12);
	assert.equal(readCache(env).fetchedAt, now);
});

test("collect --refresh ignores a fresh cache", async (t) => {
	const env = tempEnv(t);
	const now = 10_000_000;
	writeCache({ fetchedAt: now - 1_000, limits: { weekly: { usedPercent: 1 } } }, env);

	const calls = { count: 0 };
	const snapshot = await collect({
		env,
		now,
		options: { refresh: true },
		fetchImpl: okFetch(calls),
	});

	assert.equal(calls.count, 1);
	assert.equal(snapshot.source, "api");
});

test("collect falls back to stale cache when the API fails", async (t) => {
	const env = tempEnv(t);
	const now = 10_000_000;
	writeCache({ fetchedAt: now - 600_000, limits: { fiveHour: { usedPercent: 9 } } }, env);

	const snapshot = await collect({
		env,
		now,
		fetchImpl: async () => {
			throw new Error("ENOTFOUND");
		},
	});

	assert.equal(snapshot.source, "cache");
	assert.equal(snapshot.stale, true);
	assert.equal(snapshot.limits.fiveHour.usedPercent, 9);
	assert.match(snapshot.error, /ENOTFOUND/);
});

test("collect throws when the API fails and nothing is cached", async (t) => {
	const env = tempEnv(t);
	await assert.rejects(
		collect({
			env,
			fetchImpl: async () => {
				throw new Error("ENOTFOUND");
			},
		}),
		/ENOTFOUND/,
	);
});

test("run renders a plain line and marks stale data", async (t) => {
	const env = tempEnv(t);
	// Pinned near the fixture's reset timestamps so countdowns are meaningful.
	const now = Date.parse("2026-07-16T12:00:00Z");

	const fresh = await run(["--plain"], { env, now, fetchImpl: okFetch({ count: 0 }) });
	assert.equal(fresh.exitCode, 0);
	assert.match(
		fresh.output,
		/^5h 12% in 3h {2}wk 25% in 3d 12h {2}mo 40%$/,
	);

	writeCache({ fetchedAt: now - 600_000, limits: { monthly: { usedPercent: 40, resetsAt: null } } }, env);
	const stale = await run(["--plain"], {
		env,
		now,
		fetchImpl: async () => {
			throw new Error("offline");
		},
	});
	assert.equal(stale.exitCode, 0);
	assert.match(stale.output, /mo 40% \(stale\)$/);
});

test("run --json emits the normalized snapshot", async (t) => {
	const env = tempEnv(t);
	const result = await run(["--json", "--plain"], {
		env,
		now: 10_000_000,
		fetchImpl: okFetch({ count: 0 }),
	});

	const parsed = JSON.parse(result.output);
	assert.equal(parsed.fiveHour.usedPercent, 12);
	assert.equal(parsed.source, "api");
	assert.equal(parsed.stale, false);
	assert.equal(parsed.fetchedAt, 10_000_000);
});

test("parseArgs validates --ttl and rejects unknown flags", () => {
	assert.equal(parseArgs(["--ttl", "30"]).ttlMs, 30_000);
	assert.throws(() => parseArgs(["--ttl", "soon"]), /non-negative number/);
	assert.throws(() => parseArgs(["--nope"]), /Unknown option/);
});

test("parseArgs requires a path for --line-file", () => {
	assert.equal(parseArgs(["--line-file", "/tmp/x"]).lineFile, "/tmp/x");
	assert.throws(() => parseArgs(["--line-file"]), /needs a path/);
	assert.throws(() => parseArgs(["--line-file", "--short"]), /needs a path/);
});

test("--line-file writes the same line it prints, without ANSI", async (t) => {
	const env = tempEnv(t);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clinepass-line-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const target = path.join(dir, "nested", "line.txt");

	const result = await run(["--line-file", target], {
		env,
		now: Date.parse("2026-07-16T12:00:00Z"),
		fetchImpl: okFetch({ count: 0 }),
	});

	const written = fs.readFileSync(target, "utf8");
	assert.equal(written, `${result.output}\n`);
	assert.doesNotMatch(written, /\u001b\[/);
	assert.equal(result.exitCode, 0);
});

test("--line-file honours --short", async (t) => {
	const env = tempEnv(t);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clinepass-line-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const target = path.join(dir, "line.txt");

	await run(["--line-file", target, "--short"], {
		env,
		now: 10_000_000,
		fetchImpl: okFetch({ count: 0 }),
	});

	assert.equal(fs.readFileSync(target, "utf8"), "12% / 25% / 40%\n");
});
