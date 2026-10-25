# clinepass-status

One-line **ClinePass** usage for your terminal: 5-hour, weekly, and monthly limits.

```
5h 12% in 3h  wk 25% in 4d 2h  mo 40%
```

## Why this exists

Claude Code lets you point a `statusLine` command at anything:

```json
{ "statusLine": { "type": "command", "command": "~/.claude/statusline.sh" } }
```

**Cline CLI has no equivalent.** In v3.0.73 the TUI status bar is a fixed
component — `apps/cli/src/tui/components/status-bar.tsx` renders the model,
context bar, token/cost totals, Plan/Act toggle, workspace/branch, and git diff.
There is no config key or plugin capability to add a segment (plugins expose
`tools`, `hooks`, `commands`, `rules`, `events` only, and the hooks are agent
lifecycle hooks: `beforeRun`, `afterRun`, `beforeModel`, `afterModel`,
`beforeTool`, `afterTool`, `onEvent`).

So this tool does two jobs:

1. **Today** — prints the line on demand, ready to drop into a tmux
   `status-right`, a shell prompt, or a terminal title.
2. **Later** — it is exactly the command a patched Cline CLI would call once a
   `statusLine` setting lands upstream.

## Where the numbers come from

The same endpoint the Cline dashboard uses:

```
GET https://api.cline.bot/api/v1/users/me/plan/usage-limits
Authorization: Bearer <cline token>

{ "success": true,
  "data": { "limits": [
    { "type": "five_hour", "percentUsed": 12.5, "resetsAt": "2026-07-16T15:00:00Z" },
    { "type": "weekly",    "percentUsed": 25,   "resetsAt": "2026-07-20T00:00:00Z" },
    { "type": "monthly",   "percentUsed": 40,   "resetsAt": null }
  ] } }
```

Verified against a live ClinePass account:

- All three windows are returned with a `resetsAt` value, including `monthly`.
- `resetsAt` is RFC 3339 with **nanosecond** precision
  (`2026-10-25T05:46:55.218188012Z`). `Date.parse` truncates to milliseconds
  correctly; parsers that assume three fractional digits will not.
- The stored session is a long `workos:` bearer token (~1 KB), read from
  `auth.accessToken`. No token refresh is attempted.

Credentials are read the way Cline reads them, in this order:

1. `CLINE_API_KEY`
2. `CLINEPASS_API_KEY`
3. `~/.cline/data/settings/providers.json` → `providers.cline.settings`
   (`auth.accessToken` → `apiKey` → `auth.apiKey`)

Honouring Cline's own overrides: `CLINE_PROVIDER_SETTINGS_PATH`,
`CLINE_DATA_DIR`, `CLINE_DIR`. This tool never starts a login flow, never
refreshes tokens, and never writes to Cline's files — if the session expires,
run `cline auth`.

## Usage

```bash
node ./src/cli.mjs            # colored line
node ./src/cli.mjs --plain    # no ANSI
node ./src/cli.mjs --short    # 12% / 25% / 40%
node ./src/cli.mjs --table    # multi-line block for a watch tab
node ./src/cli.mjs --json     # snapshot
node ./src/cli.mjs --refresh  # ignore cache
node ./src/cli.mjs --debug    # credential/cache resolution
```

| Option | Effect |
|---|---|
| `--short` | Compact `12% / 25% / 40%` for narrow bars |
| `--table` | Multi-line block with ASCII bars and per-window countdowns |
| `--pace` | Add the pace tag to the single-line output |
| `--no-emoji` | Use words instead of 🥶 / 😌 / 😎 / 😅 / 🥵 |
| `--tolerance <pp>` | Slack (percentage points) still counted as on pace, default 5 |
| `--json` | `{fiveHour, weekly, monthly, fetchedAt, source, stale, pace}` |
| `--plain`, `--no-color` | Disable ANSI (also honours `NO_COLOR`) |
| `--line-file <path>` | Atomically write the plain line to `path` |
| `--refresh` | Skip the cache |
| `--ttl <seconds>` | Cache lifetime, default 60 |
| `--debug` | Explain credential and cache resolution on stderr |

Exit codes: `0` printed a line, `1` credential problem, `2` API/network failure
with no cache to fall back on.

## Pace: weekly and monthly

Only the slow windows get a verdict. The 5-hour window resets four-plus times a
day, so one burst of work paints it hot for an hour and then erases itself. Pace
therefore covers **weekly and monthly** only.

The reset timestamp anchors the window start, so expected usage is just elapsed
time:

```
start    = resetsAt - windowLength
expected = (now - start) / windowLength * 100
delta    = usedPercent - expected        // + hot, - cold
```

Five bands, anchored to `--tolerance` (default 5 pp) so widening it scales the
whole gradient rather than just the middle:

| Band | Face | Delta | Meaning |
|---|---|---|---|
| cold | 🥶 | ≤ −3t | Far under — lots of headroom banked |
| cool | 😌 | −3t … −t | Under — comfortable |
| on | 😎 | −t … +t | Goldilocks |
| warm | 😅 | +t … +3t | Over — worth watching |
| hot | 🥵 | ≥ +3t | Burning too fast; runs dry before the reset |

Halfway through the week with 25% used reads `😌` at the default tolerance; with
75% used it reads `🥵`.

The face carries no number on purpose. On-pace has no meaningful magnitude, so
printing the delta on some rows and not others looked like a rendering bug; the
exact `delta` is in `--json` if you want it.

`--no-emoji` swaps the faces for words (`cold`, `on pace`, `hot`) for fonts or
tmux status bars that do not render emoji.

Caveats, stated plainly:

- **Monthly is approximate.** That reset is a billing anniversary, not a fixed
  30-day month, so the denominator is 30 days.
- **No verdict in the first 2% of a window.** A single request right after a reset
  would otherwise read as wildly hot.
- **No verdict without a reset time**, or when the reset is already in the past
  (stale snapshot from a long outage).
- **It is a projection, not a promise.** One long agent run can swing it thirty
  points, which is why it is a face rather than a countdown.
- **The face gets its own column** between the percentage and the reset text, and
  every row reserves it — including the 5-hour row, which has no verdict — so the
  reset times line up. Width is measured in terminal cells, counting each emoji
  as two columns.

`--json` carries the same numbers for scripting:

```json
"pace": {
  "weekly":  { "state": "cold", "level": -2, "delta": -17.9, "expected": 18.9, "elapsedFraction": 0.19 },
  "monthly": { "state": "on",   "level": 0,  "delta": -4.4,  "expected": 4.4,  "elapsedFraction": 0.04 }
}
```

(That is a real reading from a lightly used account: 19% of the week elapsed
against 1% used, and 4.4% of the month elapsed against 0% used — close enough to
the clock to count as on pace.)

## Caching

Results are cached at `~/.cache/clinepass-status/usage.json` (override with
`CLINEPASS_STATUS_CACHE_DIR`). Renders read the cache; a fetch only happens once
the snapshot is older than the TTL.

If a refresh fails and an older snapshot exists, the stale line is still printed
with a `(stale)` suffix and exit code `0` — a status bar should degrade, not go
blank. The cache file is written atomically (temp file + rename) so concurrent
readers never see a partial write.

## Watching it in a tab

Recommended. A prompt hook is the wrong host for a network-backed number — measured
on this machine, a cached render costs **~145 ms** (Node startup dominates), and
even a fork-free `precmd` costs **~26 ms** if it shells out to `stat`/`date`. Paying
that on every Enter is not worth it.

Instead, keep a tab open:

```zsh
status-for-cline-pass        # refreshes every 60s
status-for-cline-pass 15     # or pick your own interval (minimum 5s)
```

```
  ClinePass usage  updated 22:36:47
  5h  [#---------]    4%      3h 10m
  wk  [#---------]    1%  🥶  5d 15h
  mo  [----------]    0%  😎  28d 15h

  every 60s  ·  any key refreshes now  ·  Ctrl-C quits
```

Any keypress fetches immediately; otherwise it ticks on the interval; Ctrl-C exits.
It redraws by rewinding over its own frame (`ESC[{n}A` from the current cursor
position) rather than homing to the top of the screen — so the prompt and
scrollback above the panel are never touched — and `ESC[J` clears leftovers when
the frame shrinks. It reads `$SECONDS` to tell a timeout apart from a real EOF.

The function lives in `~/.zshrc`; the canonical copy is
[`integrations/status-for-cline-pass.zsh`](integrations/status-for-cline-pass.zsh) —
`source` it or copy it. `CLINEPASS_BIN` overrides the script path if the repo
lives somewhere other than `~/clinepass-status`.

Two details carry the behaviour:

- `read -k1 -s -t "$interval"` — one un-echoed keypress with a timeout. Exit `0`
  is a key; a late non-zero is the timer; an early non-zero is EOF. That is why
  `$SECONDS` is compared instead of trusting the status alone: EOF and timeout
  are indistinguishable otherwise, and a closed stdin would spin the loop flat out.
- `ESC[{n}A` moves up relative to the cursor, so it can only land on the first row
  of its own frame. `ESC[H` would jump to screen row 1 and paint over the prompt.

**tmux alternative** — if you would rather have it always visible:

```tmux
set -g status-interval 30
set -g status-right '#(node $HOME/clinepass-status/src/cli.mjs --plain)  %H:%M'
```

That path is cache-only by design: tmux re-runs the command on every interval, so
it must never block on the network.

## Tests

```bash
npm test
```

Covers percent/countdown formatting, traffic-light thresholds, table and bar
rendering, response parsing (unknown window types, clamping, malformed payloads),
credential precedence, the cache TTL and stale fallback path, `--line-file`
atomicity, and `run()` output shapes. No network access.

## Upstream path

To get the line *inside* Cline's own status bar rather than beside it, the change
is small: an optional `statusLine: { command, intervalMs }` setting, a hook that
spawns the command with a JSON payload on stdin (500 ms timeout, last-good-value
retained, failures render nothing), and a one-line row in `status-bar.tsx`.

Per `CONTRIBUTING.md`, that starts as a feature request issue — not a PR — so the
design lands before the code does. This CLI is the piece that survives either way.
