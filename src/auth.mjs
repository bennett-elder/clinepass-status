/**
 * Credential discovery for the Cline API.
 *
 * Order (matching Cline's own resolver and CodexBar's ClinePass provider):
 *   1. CLINE_API_KEY        (environment)
 *   2. CLINEPASS_API_KEY    (environment)
 *   3. cline-auth session   (~/.cline/data/settings/providers.json)
 *        auth.accessToken -> apiKey -> auth.apiKey
 *
 * Only the `providers.cline` entry is read. Refresh tokens and unrelated
 * providers are ignored, and this module never starts a login flow.
 */

import fs from "node:fs";
import { settingsCandidates } from "./paths.mjs";

export class AuthError extends Error {}

/** Non-reversible fingerprint, safe to log. */
export function fingerprint(secret) {
	if (typeof secret !== "string" || secret.length === 0) return null;
	return { prefix: `${secret.slice(0, 6)}…`, length: secret.length };
}

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Pick a token out of a `providers.cline.settings` object. */
export function tokenFromSettings(settings) {
	if (!settings || typeof settings !== "object") {
		return { token: null, via: null };
	}

	const nested = settings.auth?.accessToken;
	if (typeof nested === "string" && nested.length > 0) {
		return { token: nested, via: "auth.accessToken" };
	}

	if (typeof settings.apiKey === "string" && settings.apiKey.length > 0) {
		return { token: settings.apiKey, via: "apiKey" };
	}

	const fallback = settings.auth?.apiKey;
	if (typeof fallback === "string" && fallback.length > 0) {
		return { token: fallback, via: "auth.apiKey" };
	}

	return { token: null, via: null };
}

/**
 * Resolve the bearer token, or throw an AuthError explaining what to run.
 * `env` and `fileExists` are injectable for tests.
 */
export function resolveToken({
	env = process.env,
	fileExists = fs.existsSync,
	readFile = readJson,
} = {}) {
	if (env.CLINE_API_KEY) {
		return { token: env.CLINE_API_KEY, via: "env CLINE_API_KEY", source: "env" };
	}

	if (env.CLINEPASS_API_KEY) {
		return {
			token: env.CLINEPASS_API_KEY,
			via: "env CLINEPASS_API_KEY",
			source: "env",
		};
	}

	const candidates = settingsCandidates(env);
	const existing = candidates.filter((candidate) => fileExists(candidate.file));

	if (existing.length === 0) {
		throw new AuthError(
			"No Cline credentials found. Run `cline auth` to sign in, or set CLINE_API_KEY.",
		);
	}

	const chosen = existing[0];
	let parsed;
	try {
		parsed = readFile(chosen.file);
	} catch (error) {
		throw new AuthError(`Could not read ${chosen.file}: ${error.message}`);
	}

	const settings = parsed?.providers?.cline?.settings;
	const { token, via } = tokenFromSettings(settings);

	if (!token) {
		throw new AuthError(
			`No Cline token in ${chosen.file}. Run \`cline auth\` to sign in again.`,
		);
	}

	return {
		token,
		via: `${via} (${chosen.source})`,
		source: "file",
		file: chosen.file,
	};
}
