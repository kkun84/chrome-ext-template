#!/usr/bin/env bash
#
# github-settings.sh — manage repository security settings and the "main
# protection" ruleset as code.
#
# Default mode is read-only --check: it GETs the current state, compares it to
# the JSON files under .github/settings/, prints a human-readable diff and exits
# non-zero on drift. --apply writes the desired state.
#
# Requires: gh, jq.
#
# Note: the Actions policy "Require lockfile" cannot be set via the API
# (https://github.com/github/rest-api-description/issues/7366). Set it in
# Settings > Actions > Policies in the UI.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SETTINGS_DIR="${REPO_ROOT}/.github/settings"
SECURITY_JSON="${SETTINGS_DIR}/security.json"
RULESET_JSON="${SETTINGS_DIR}/ruleset-main.json"
RULESET_NAME="main protection"

MODE="check"
REPO=""

usage() {
  cat <<'EOF'
Usage: github-settings.sh [--check|--apply] [--repo OWNER/REPO]

  --check   (default) read-only; compare live state to .github/settings/*.json
            and exit non-zero on drift.
  --apply   write the desired state.
  --repo    target repository (default: gh repo view).
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
  --check)
    MODE="check"
    ;;
  --apply)
    MODE="apply"
    ;;
  --repo)
    REPO="${2:-}"
    if [ -z "${REPO}" ]; then
      echo "error: --repo requires OWNER/REPO" >&2
      exit 2
    fi
    shift
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  --*)
    echo "error: unknown option: $1" >&2
    usage >&2
    exit 2
    ;;
  *)
    if [ -z "${REPO}" ]; then
      REPO="$1"
    else
      echo "error: unexpected argument: $1" >&2
      exit 2
    fi
    ;;
  esac
  shift
done

command -v gh >/dev/null 2>&1 || {
  echo "error: gh is required" >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo "error: jq is required" >&2
  exit 1
}

if [ -z "${REPO}" ]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi

for f in "${SECURITY_JSON}" "${RULESET_JSON}"; do
  if [ ! -f "${f}" ]; then
    echo "error: missing ${f}" >&2
    exit 1
  fi
done

DRIFT=0

warn_lockfile_policy() {
  cat <<'EOF'
NOTE: The Actions policy "Require lockfile" cannot be set via the API
      (https://github.com/github/rest-api-description/issues/7366).
      Set it in Settings > Actions > Policies in the UI.
EOF
}

# Canonicalize JSON for order-insensitive comparison.
canon() { jq -cS .; }

# --- security settings ------------------------------------------------------

# vulnerability-alerts: 204 = enabled, 404 = disabled.
vuln_alerts_state() {
  local code
  code="$(gh api -i "repos/${REPO}/vulnerability-alerts" -q . 2>/dev/null |
    head -n 1 | awk '{print $2}' || true)"
  if [ "${code}" = "204" ]; then
    echo "true"
  else
    echo "false"
  fi
}

check_security() {
  local vuln_alerts live_vuln auto_fixes live_auto pvr_code
  local security_and_analysis live_saa actions_perms live_actions
  local workflow_perms live_workflow

  vuln_alerts="$(jq -r '.vulnerability_alerts' "${SECURITY_JSON}")"
  live_vuln="$(vuln_alerts_state)"
  if [ "${vuln_alerts}" != "${live_vuln}" ]; then
    echo "drift: vulnerability_alerts desired=${vuln_alerts} live=${live_vuln}"
    DRIFT=1
  fi

  auto_fixes="$(jq -cS '.automated_security_fixes' "${SECURITY_JSON}")"
  live_auto="$(gh api "repos/${REPO}/automated-security-fixes" | canon)"
  if [ "${auto_fixes}" != "${live_auto}" ]; then
    echo "drift: automated_security_fixes desired=${auto_fixes} live=${live_auto}"
    DRIFT=1
  fi

  # private-vulnerability-reporting: 204/200 = enabled, 404 = disabled.
  pvr_code="$(gh api -i "repos/${REPO}/private-vulnerability-reporting" -q . 2>/dev/null |
    head -n 1 | awk '{print $2}' || true)"
  if [ "${pvr_code}" != "200" ] && [ "${pvr_code}" != "204" ]; then
    echo "drift: private_vulnerability_reporting not enabled (HTTP ${pvr_code})"
    DRIFT=1
  fi

  security_and_analysis="$(jq -cS '.security_and_analysis' "${SECURITY_JSON}")"
  live_saa="$(gh api "repos/${REPO}" | jq -c '.security_and_analysis | with_entries(select(.key != "dependabot_security_updates"))' | canon)"
  if [ "${security_and_analysis}" != "${live_saa}" ]; then
    echo "drift: security_and_analysis desired=${security_and_analysis}"
    echo "                            live=${live_saa}"
    DRIFT=1
  fi

  actions_perms="$(jq -cS '.actions_permissions' "${SECURITY_JSON}")"
  live_actions="$(gh api "repos/${REPO}/actions/permissions" | canon)"
  if [ "${actions_perms}" != "${live_actions}" ]; then
    echo "drift: actions_permissions desired=${actions_perms} live=${live_actions}"
    DRIFT=1
  fi

  workflow_perms="$(jq -cS '.workflow_permissions' "${SECURITY_JSON}")"
  live_workflow="$(gh api "repos/${REPO}/actions/permissions/workflow" | canon)"
  if [ "${workflow_perms}" != "${live_workflow}" ]; then
    echo "drift: workflow_permissions desired=${workflow_perms} live=${live_workflow}"
    DRIFT=1
  fi
}

apply_security() {
  local saa
  gh api --method PUT "repos/${REPO}/vulnerability-alerts" >/dev/null
  gh api --method PUT "repos/${REPO}/automated-security-fixes" >/dev/null
  gh api --method PUT "repos/${REPO}/private-vulnerability-reporting" >/dev/null

  saa="$(jq -c '{security_and_analysis: .security_and_analysis}' "${SECURITY_JSON}")"
  gh api --method PATCH "repos/${REPO}" --input - <<<"${saa}" >/dev/null

  jq -c '.actions_permissions' "${SECURITY_JSON}" |
    gh api --method PUT "repos/${REPO}/actions/permissions" --input - >/dev/null

  jq -c '.workflow_permissions' "${SECURITY_JSON}" |
    gh api --method PUT "repos/${REPO}/actions/permissions/workflow" --input - >/dev/null
}

# --- ruleset ----------------------------------------------------------------

# Normalize the live ruleset to the semantic fields stored in the JSON file.
normalize_ruleset() {
  jq -cS '{
    name,
    target,
    enforcement,
    bypass_actors,
    conditions,
    rules
  }'
}

ruleset_id() {
  gh api "repos/${REPO}/rulesets" |
    jq -r --arg name "${RULESET_NAME}" '.[] | select(.name == $name) | .id' |
    head -n 1
}

check_ruleset() {
  local id desired live
  id="$(ruleset_id)"
  desired="$(normalize_ruleset <"${RULESET_JSON}")"
  if [ -z "${id}" ]; then
    echo "drift: ruleset '${RULESET_NAME}' not found"
    DRIFT=1
    return
  fi
  live="$(gh api "repos/${REPO}/rulesets/${id}" | normalize_ruleset)"
  if [ "${desired}" != "${live}" ]; then
    echo "drift: ruleset '${RULESET_NAME}' differs (id=${id})"
    diff <(jq -S . <<<"${desired}") <(jq -S . <<<"${live}") || true
    DRIFT=1
  fi
}

apply_ruleset() {
  local id
  id="$(ruleset_id)"
  if [ -z "${id}" ]; then
    gh api --method POST "repos/${REPO}/rulesets" \
      --input "${RULESET_JSON}" >/dev/null
  else
    gh api --method PUT "repos/${REPO}/rulesets/${id}" \
      --input "${RULESET_JSON}" >/dev/null
  fi
}

# --- main -------------------------------------------------------------------

echo "repository: ${REPO}"
echo "mode: ${MODE}"
echo

if [ "${MODE}" = "apply" ]; then
  apply_security
  apply_ruleset
  echo "applied security settings and ruleset '${RULESET_NAME}'"
else
  check_security
  check_ruleset
  if [ "${DRIFT}" -ne 0 ]; then
    echo
    echo "drift detected (run with --apply to reconcile)"
  else
    echo "no drift: live state matches .github/settings/*.json"
  fi
fi

echo
warn_lockfile_policy

if [ "${MODE}" = "check" ] && [ "${DRIFT}" -ne 0 ]; then
  exit 1
fi
