#!/usr/bin/env node
/**
 * clinepass-status — ClinePass 5-hour / weekly / monthly usage.
 *
 * Doubles as the module tests import: `run()` returns `{ output, exitCode }`
 * and the executable block at the bottom only fires when this file is the
 * process entry point.
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { ApiError, fetchUsageLimits } from "./api.mjs";
import { AuthError, fingerprint, resolveToken } from "./auth.mjs";
import {
	DEFAULT_TTL_MS,
	ageSeconds,
	isFresh,
	readCache,
	writeAtomic,
	writeCache,
} from "./cache.mjs";
import { formatStatusLine, formatTable } from "./format.mjs";
import { DEFAULT_TOLERANCE, computeAllPace } from "./pace.mjs";
import { cacheFile, expandHome } from "./paths.mjs";

const HELP = `clinepass-status — ClinePass 5-hour / weekly / monthly usage

Usage:
  clinepass-status [options]

Options:
  --short            Compact output: "12% / 25% / 40%"
  --table            Multi-line block for a watch tab (includes pace)
  --pace             Add the pace tag to the single-line output
  --no-emoji         Use words instead of 🥶 / 😌 / 😎 / 😅 / 🥵
  --tolerance <pp>   Percentage points of slack counted as "on pace" (default 5)
  --json             Machine-readable snapshot
  --plain, --no-color  Disable ANSI color
  --line-file <path>  Also write the plain line here (atomic) for prompts
  --refresh          Ignore cache and fetch now
  --ttl <seconds>    Cache lifetime (default 60)
  --debug            Explain credential/cache resolution (stderr)
  -h, --help         Show this help
  -V, --version      Show version

Exit codes:
  0  printed a line (possibly from cache, possibly stale)
  1  missing or rejected credential
  2  network or API failure with no cache to fall back on

Environment:
  CLINE_API_KEY / CLINEPASS_API_KEY   Override the stored credential
  CLINE_DATA_DIR / CLINE_DIR          Where Cline keeps providers.json
  CLINEPASS_STATUS_CACHE_DIR          Cache location
  NO_COLOR                            Disable color
`;

export function parseArgs(argv) {
	const options = { json: false, color: undefined, short: false, table: false, pace: false, emoji: true, tolerance: undefined, refresh: false, debug: false, ttlMs: undefined, help: false, version: false };

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];

		switch (arg) {
			case "--json": options.json = true; break;
			case "--short": options.short = true; break;
			case "--table": options.table = true; break;
			case "--pace": options.pace = true; break;
			case "--no-emoji": options.emoji = false; break;
			case "--tolerance": {
				const raw = argv[index + 1];
				const points = Number(raw);
				if (!Number.isFinite(points) || points < 0) {
					throw new Error(
						`--tolerance needs a non-negative number of percentage points, got: ${raw ?? "(missing)"}`,
					);
				}
				options.tolerance = points;
				index += 1;
				break;
			}
			case "--plain":
			case "--no-color": options.color = false; break;
			case "--line-file": {
				const target = argv[index + 1];
				if (!target || target.startsWith("-")) {
					throw new Error("--line-file needs a path");
				}
				options.lineFile = target;
				index += 1;
				break;
			}
			case "--refresh": options.refresh = true; break;
			case "--debug": options.debug = true; break;
			case "--ttl": {
				const raw = argv[index + 1];
				const seconds = Number(raw);
				if (!Number.isFinite(seconds) || seconds < 0) {
					throw new Error(`--ttl needs a non-negative number of seconds, got: ${raw ?? "(missing)"}`);
				}
				options.ttlMs = seconds * 1000;
				index += 1;
				break;
			}
			case "-h":
			case "--help": options.help = true; break;
			case "-V":
			case "--version": options.version = true; break;
			default:
				if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
		}
	}

	return options;
}

/**
 * Resolve a snapshot: fresh cache, fresh API call, or stale cache on failure.
 * Returns { limits, fetchedAt, source, stale, error? }.
 */
export async function collect({ options = {}, env = process.env, now = Date.now(), fetchImpl } = {}) {
	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	const cached = readCache(env);

	if (cached && !options.refresh && isFresh(cached, ttlMs, now)) {
		return { ...cached, source: "cache", stale: false };
	}

	const { token } = resolveToken({ env });

	try {
		const snapshot = await fetchUsageLimits({ token, fetchImpl, now: () => now });
		try {
			writeCache(snapshot, env);
		} catch {
			// A read-only or full cache dir must not break the status line.
		}
		return { ...snapshot, source: "api", stale: false };
	} catch (error) {
		if (cached) {
			return { ...cached, source: "cache", stale: true, error: error.message };
		}
		throw error;
	}
}

export async function run(argv = [], { env = process.env, now = Date.now(), fetchImpl } = {}) {
	const options = parseArgs(argv);

	if (options.help) return { output: HELP, exitCode: 0 };
	if (options.version) return { output: "clinepass-status 0.1.0", exitCode: 0 };

	const useColor =
		options.color ?? (Boolean(process.stdout.isTTY) && !env.NO_COLOR);

	let snapshot;
	try {
		snapshot = await collect({ options, env, now, fetchImpl });
	} catch (error) {
		if (error instanceof AuthError) return { output: `clinepass-status: ${error.message}`, exitCode: 1, stderr: true };
		if (error instanceof ApiError) return { output: `clinepass-status: ${error.message}`, exitCode: 2, stderr: true };
		return { output: `clinepass-status: ${error.message}`, exitCode: 2, stderr: true };
	}

	if (options.debug) {
		const lines = [`source: ${snapshot.source}`, `cache: ${cacheFile(env)} (${ageSeconds(snapshot, now)}s old)`];
		try {
			const resolved = resolveToken({ env });
			const print = fingerprint(resolved.token);
			lines.push(`credential: ${resolved.via} [${print?.prefix ?? "?"} len=${print?.length ?? 0}]`);
		} catch (error) {
			lines.push(`credential: ${error.message}`);
		}
		if (snapshot.error) lines.push(`fallback reason: ${snapshot.error}`);
		process.stderr.write(`${lines.map((line) => `  ${line}`).join("\n")}\n`);
	}

	const pace = computeAllPace(snapshot.limits, {
		nowMs: now,
		tolerance: options.tolerance ?? DEFAULT_TOLERANCE,
	});

	if (options.json) {
		return {
			output: JSON.stringify(
				{
					fiveHour: snapshot.limits.fiveHour,
					weekly: snapshot.limits.weekly,
					monthly: snapshot.limits.monthly,
					fetchedAt: snapshot.fetchedAt,
					source: snapshot.source,
					stale: snapshot.stale,
					pace: {
						fiveHour: pace.fiveHour,
						weekly: pace.weekly,
						monthly: pace.monthly,
					},
				},
				null,
				2,
			),
			exitCode: 0,
		};
	}

	if (options.table) {
		const updatedAt = new Date(now).toLocaleTimeString("en-GB", {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
		const table = formatTable(snapshot.limits, {
			nowMs: now,
			color: useColor,
			updatedAt,
			pace,
			emoji: options.emoji,
		});
		return {
			output: snapshot.stale ? `${table}\n(stale — showing last known values)` : table,
			exitCode: 0,
		};
	}

	const line = formatStatusLine(snapshot.limits, {
		nowMs: now,
		color: useColor,
		short: options.short,
		pace: options.pace ? pace : undefined,
		emoji: options.emoji,
	});
	const output = snapshot.stale ? `${line} (stale)` : line;

	// Prompts read this file instead of spawning Node, so it must stay plain
	// text even when stdout is a TTY. A failure here must not break the prompt.
	if (options.lineFile) {
		try {
			writeAtomic(expandHome(options.lineFile), `${output}\n`);
		} catch (error) {
			process.stderr.write(
				`clinepass-status: could not write ${options.lineFile}: ${error.message}\n`,
			);
		}
	}

	return { output, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Executable entry
// ---------------------------------------------------------------------------

/**
 * True when this file was started directly (`node src/cli.mjs`) or through the
 * npm bin symlink, false when a test imports it. realpath matters: npm links
 * `node_modules/.bin/clinepass-status` to the file, and Node resolves the
 * symlink for `import.meta.url` but not for `process.argv[1]`.
 */
function isEntryPoint() {
	if (!process.argv[1]) return false;
	try {
		return pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
	} catch {
		return false;
	}
}

if (isEntryPoint()) {
	// `clinepass-status | head` closes the pipe early; that is normal, not a crash.
	for (const stream of [process.stdout, process.stderr]) {
		stream.on("error", (error) => {
			if (error.code === "EPIPE") process.exit(0);
			throw error;
		});
	}

	try {
		const { output, exitCode, stderr } = await run(process.argv.slice(2));

		if (output) {
			const stream = stderr ? process.stderr : process.stdout;
			stream.write(`${output}\n`);
		}

		process.exitCode = exitCode;
	} catch (error) {
		process.stderr.write(`clinepass-status: ${error.message}\n`);
		process.exitCode = 2;
	}
}
