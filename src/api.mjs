/**
 * ClinePass usage limits.
 *
 * Endpoint used by the Cline dashboard and by every third-party usage
 * tracker for this subscription:
 *
 *   GET https://api.cline.bot/api/v1/users/me/plan/usage-limits
 *   Authorization: Bearer <cline token>
 *
 * Response shape (only the fields we rely on):
 *   { "success": true,
 *     "data": { "limits": [
 *       { "type": "five_hour", "percentUsed": 12.5, "resetsAt": "2026-07-16T15:00:00Z" },
 *       { "type": "weekly",    "percentUsed": 25,   "resetsAt": "2026-07-20T00:00:00Z" },
 *       { "type": "monthly",   "percentUsed": 40,   "resetsAt": null }
 *     ] } }
 */

export const USAGE_URL =
	"https://api.cline.bot/api/v1/users/me/plan/usage-limits";

/** API `type` values mapped to our window keys. */
const WINDOW_BY_TYPE = {
	five_hour: "fiveHour",
	weekly: "weekly",
	monthly: "monthly",
};

export class ApiError extends Error {
	constructor(message, { status } = {}) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

function normalizeEntry(entry) {
	const percent = Number(entry?.percentUsed);
	if (!Number.isFinite(percent)) return null;

	const resetsAt =
		typeof entry?.resetsAt === "string" && entry.resetsAt.trim() !== ""
			? entry.resetsAt
			: null;

	return {
		usedPercent: Math.min(100, Math.max(0, percent)),
		resetsAt,
	};
}

/**
 * Turn a usage-limits response body into a fixed set of windows.
 * Unknown limit types are ignored, matching Cline's own consumers.
 */
export function parseLimits(body) {
	if (!body || body.success !== true) {
		throw new ApiError("ClinePass returned an unsuccessful response");
	}

	const entries = body.data?.limits;
	if (!Array.isArray(entries)) {
		throw new ApiError("ClinePass response missing data.limits");
	}

	const windows = { fiveHour: null, weekly: null, monthly: null };
	for (const entry of entries) {
		const key = WINDOW_BY_TYPE[entry?.type];
		if (!key) continue;
		const normalized = normalizeEntry(entry);
		if (normalized) windows[key] = normalized;
	}

	if (!windows.fiveHour && !windows.weekly && !windows.monthly) {
		throw new ApiError("ClinePass response contained no known usage windows");
	}

	return windows;
}

/** Fetch and normalize the current limits. */
export async function fetchUsageLimits({
	token,
	url = USAGE_URL,
	timeoutMs = 10_000,
	fetchImpl = globalThis.fetch,
	now = () => Date.now(),
} = {}) {
	if (!token) throw new ApiError("Missing Cline credential");

	let response;
	try {
		response = await fetchImpl(url, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
			},
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		throw new ApiError(`Request failed: ${error.message}`);
	}

	if (response.status === 401 || response.status === 403) {
		throw new ApiError(
			"Cline rejected the credential. Run `cline auth` to sign in again.",
			{ status: response.status },
		);
	}

	if (!response.ok) {
		throw new ApiError(`Cline API returned HTTP ${response.status}`, {
			status: response.status,
		});
	}

	let body;
	try {
		body = await response.json();
	} catch (error) {
		throw new ApiError(`Could not parse ClinePass response: ${error.message}`);
	}

	const windows = parseLimits(body);
	return { limits: windows, fetchedAt: now() };
}
