/**
 * Filesystem locations used by Cline and by this tool.
 *
 * Cline honours several overrides for where provider settings live. We mirror
 * that precedence so the status line reads the same credential Cline uses:
 *
 *   1. CLINE_PROVIDER_SETTINGS_PATH  (a file)
 *   2. CLINE_DATA_DIR                -> <dir>/settings/providers.json
 *   3. CLINE_DIR                     -> <dir>/data/settings/providers.json
 *   4. ~/.cline/data/settings/providers.json
 */

import os from "node:os";
import path from "node:path";

export function expandHome(input) {
	if (!input) return input;
	if (input === "~") return os.homedir();
	if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
	return input;
}

/** Every candidate settings file, in precedence order. */
export function settingsCandidates(env = process.env) {
	const candidates = [];

	if (env.CLINE_PROVIDER_SETTINGS_PATH) {
		candidates.push({
			source: "CLINE_PROVIDER_SETTINGS_PATH",
			file: expandHome(env.CLINE_PROVIDER_SETTINGS_PATH),
		});
	}

	if (env.CLINE_DATA_DIR) {
		candidates.push({
			source: "CLINE_DATA_DIR",
			file: path.join(expandHome(env.CLINE_DATA_DIR), "settings", "providers.json"),
		});
	}

	if (env.CLINE_DIR) {
		candidates.push({
			source: "CLINE_DIR",
			file: path.join(expandHome(env.CLINE_DIR), "data", "settings", "providers.json"),
		});
	}

	candidates.push({
		source: "default",
		file: path.join(os.homedir(), ".cline", "data", "settings", "providers.json"),
	});

	return candidates;
}

/** Cache directory for the fetched snapshot. */
export function cacheDir(env = process.env) {
	if (env.CLINEPASS_STATUS_CACHE_DIR) {
		return expandHome(env.CLINEPASS_STATUS_CACHE_DIR);
	}
	const base = env.XDG_CACHE_HOME
		? expandHome(env.XDG_CACHE_HOME)
		: path.join(os.homedir(), ".cache");
	return path.join(base, "clinepass-status");
}

export function cacheFile(env = process.env) {
	return path.join(cacheDir(env), "usage.json");
}
