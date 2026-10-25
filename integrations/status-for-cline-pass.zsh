#!/usr/bin/env zsh
#
# status-for-cline-pass — ClinePass usage in a spare terminal tab.
#
#   source integrations/status-for-cline-pass.zsh
#   status-for-cline-pass        # refresh every 60s
#   status-for-cline-pass 15     # or your own interval (minimum 5s)
#
# The prompt is never touched: this paints a block, leaves it behind like
# `git status`, and prints below it. Any key refreshes immediately, the timer
# refreshes on its own, Ctrl-C quits.
#
# Override the script location with CLINEPASS_BIN if this repo lives elsewhere.

status-for-cline-pass() {
  emulate -L zsh
  local bin="${CLINEPASS_BIN:-$HOME/clinepass-status/src/cli.mjs}"
  local interval=${1:-60}
  local started
  local -i drawn=0
  local -a rows

  if (( ! $+commands[node] )); then
    print -u2 "status-for-cline-pass: node is not on PATH"
    return 1
  fi

  if [[ $interval != <-> || $interval -lt 5 ]]; then
    print -u2 "usage: status-for-cline-pass [seconds >= 5]"
    return 1
  fi

  while true; do
    rows=("${(@f)$(node "$bin" --table --refresh 2>&1 | sed 's/^/  /')}")

    # Rewind over the frame we drew last time. Relative movement only: the
    # prompt and scrollback above the panel are never touched (ESC[H would
    # jump to screen row 1 and paint over them).
    (( drawn )) && printf '\e[%dA' $drawn

    printf '%s\n' "${rows[@]}"
    printf '\n  every %ss  ·  any key refreshes now  ·  Ctrl-C quits\n' "$interval"
    printf '\e[J'                     # erase leftovers if the frame shrank

    drawn=$(( ${#rows} + 2 ))

    started=$SECONDS
    read -k1 -s -t "$interval"

    (( $? == 0 )) && continue              # a key was pressed -> refresh now
    (( SECONDS - started >= interval )) && continue   # timed out -> normal tick
    break                                  # EOF or a read error -> stop
  done

  printf '\e[J'
}
