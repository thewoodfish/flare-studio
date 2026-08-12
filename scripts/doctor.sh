#!/usr/bin/env bash
# doctor.sh — is this machine ready to run the demo?
#
# `pnpm demo` touches four things that can each be independently broken: the
# toolchain, the enclave stack, the deployer's funding, and the deployed
# contracts. When one of them is wrong the symptom is usually a revert or a
# timeout several minutes in, which is the worst possible time to start
# bisecting.
#
# So this checks all four in a couple of seconds, before anything costs gas.
#
#     pnpm preflight
#
# NEVER prints a secret. Keys are reported as set or unset, never echoed --
# this output is the sort of thing that ends up pasted into a chat window.
#
# bash 3.2 compatible: no associative arrays, and no `case` inside `$( )`.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; OFF=$'\033[0m'

blocked=0
warned=0

pass() { printf '  %s✓%s %-34s %s\n' "$GREEN" "$OFF" "$1" "${2:-}"; }
warn() { printf '  %s!%s %-34s %s\n' "$YELLOW" "$OFF" "$1" "${2:-}"; warned=$((warned + 1)); }
fail() { printf '  %s✗%s %-34s %s\n' "$RED" "$OFF" "$1" "${2:-}"; blocked=$((blocked + 1)); }
fix()  { printf '      %s→ %s%s\n' "$DIM" "$1" "$OFF"; }
head_() { printf '\n%s%s%s\n' "$BOLD" "$1" "$OFF"; }

# Reads one KEY=value from an env file without sourcing it -- sourcing would run
# whatever is in there, and these files hold private keys.
env_value() {
  [ -f "$1" ] || return 1
  grep -E "^$2=" "$1" 2>/dev/null | head -1 | sed -E "s/^$2=//" | tr -d '"' | tr -d "'"
}

EXT_ENV=apps/extension/.env
EXT_CONFIG=apps/extension/config/extension.env
DEPLOYMENTS=packages/contracts/deployments/coston2.json

# --- toolchain --------------------------------------------------------------

head_ "Toolchain"

for tool in node pnpm forge cast go docker jq; do
  if command -v "$tool" >/dev/null 2>&1; then
    pass "$tool"
  else
    fail "$tool" "not installed"
  fi
done

if docker info >/dev/null 2>&1; then
  pass "docker daemon" "running"
else
  fail "docker daemon" "not running"
  fix "Start Docker Desktop. The enclave stack is three containers; nothing below it can come up without this."
fi

# --- extension configuration -------------------------------------------------

head_ "Extension configuration"

if [ -f "$EXT_ENV" ]; then
  pass "apps/extension/.env" "present"

  for var in DEPLOYMENT_PRIVATE_KEY INITIAL_OWNER CHAIN_URL EXT_PROXY_URL; do
    value=$(env_value "$EXT_ENV" "$var")
    if [ -z "$value" ]; then
      fail "  $var" "unset"
    elif printf '%s' "$value" | grep -qE '<|your-ngrok|\.\.\.|^0x123|^123'; then
      fail "  $var" "still the placeholder"
    else
      # Length only. The value itself is a secret in at least one of these cases.
      pass "  $var" "set"
    fi
  done
else
  fail "apps/extension/.env" "missing"
  fix "cp apps/extension/.env.example apps/extension/.env, then fill in a funded key and your tunnel URL."
fi

if [ -f "$EXT_CONFIG" ]; then
  sender=$(env_value "$EXT_CONFIG" INSTRUCTION_SENDER)
  if [ -n "$sender" ]; then
    pass "INSTRUCTION_SENDER" "$sender"
  else
    fail "INSTRUCTION_SENDER" "config/extension.env has no value"
  fi
else
  fail "config/extension.env" "absent — the pre-flight has not run"
  fix "cd apps/extension && ./scripts/pre-build.sh --chain coston2   (then post-build, then register-tee)"
  fix "This produces INSTRUCTION_SENDER, which the hand-off and pnpm demo both need."
fi

# --- the enclave itself ------------------------------------------------------

head_ "Enclave"

proxy=$(env_value "$EXT_ENV" EXT_PROXY_URL)
if [ -z "$proxy" ]; then
  warn "extension proxy" "no EXT_PROXY_URL to check"
else
  host=$(printf '%s' "$proxy" | sed -E 's|https?://||' | cut -d/ -f1)
  info=$(curl -s --max-time 10 "${proxy%/}/info" 2>/dev/null)
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${proxy%/}/info" 2>/dev/null)

  if [ "$code" = "200" ]; then
    pass "extension proxy" "$host"
    pubkey=$(printf '%s' "$info" | jq -r '.machineData.publicKey // empty' 2>/dev/null)
    if [ -n "$pubkey" ]; then
      pass "machine public key" "${pubkey:0:20}…"
    else
      fail "machine public key" "/info has no machineData.publicKey"
      fix "Without it the browser cannot seal a policy to the enclave."
    fi
  elif [ -z "$code" ] || [ "$code" = "000" ]; then
    fail "extension proxy" "$host unreachable"
    fix "Start the tunnel and the stack: cd apps/extension && ./scripts/start-services.sh --chain coston2"
  else
    fail "extension proxy" "$host returned HTTP $code"
    fix "The tunnel resolves but nothing is serving behind it — usually the containers are down."
  fi
fi

# --- funding -----------------------------------------------------------------

head_ "Deployer funding"

owner=$(env_value "$EXT_ENV" INITIAL_OWNER)
rpc=$(env_value "$EXT_ENV" CHAIN_URL)
rpc=${rpc:-https://coston2-api.flare.network/ext/C/rpc}

if [ -z "$owner" ] || ! command -v cast >/dev/null 2>&1; then
  warn "balances" "skipped (need INITIAL_OWNER and cast)"
else
  printf '  %s·%s %-34s %s\n' "$DIM" "$OFF" "address" "$owner"

  wei=$(cast balance "$owner" --rpc-url "$rpc" 2>/dev/null | head -1)
  if printf '%s' "$wei" | grep -qE '^[0-9]+$'; then
    flr=$(awk -v w="$wei" 'BEGIN { printf "%.2f", w / 1e18 }')
    # A deploy plus configure plus the instruction fee is well under a whole
    # C2FLR; 1 is a generous floor that still catches an empty account.
    if awk -v f="$flr" 'BEGIN { exit !(f >= 1) }'; then
      pass "C2FLR" "$flr"
    else
      fail "C2FLR" "$flr — not enough for gas"
      fix "https://faucet.flare.network/coston2"
    fi
  else
    warn "C2FLR" "could not read balance from $rpc"
  fi

  fxrp=$(env_value "$DEPLOYMENTS" '"fxrp"' 2>/dev/null)
  fxrp=$(jq -r '.fxrp // empty' "$DEPLOYMENTS" 2>/dev/null)
  fxrp=${fxrp:-0x0b6A3645c240605887a5532109323A3E12273dc7}

  raw=$(cast call "$fxrp" "balanceOf(address)(uint256)" "$owner" --rpc-url "$rpc" 2>/dev/null | head -1 | awk '{print $1}')
  if printf '%s' "$raw" | grep -qE '^[0-9]+$'; then
    # FXRP is 6 decimals -- see packages/policy/src/assets.ts, verified on-chain.
    human=$(awk -v r="$raw" 'BEGIN { printf "%.6f", r / 1e6 }')
    if [ "$raw" = "0" ]; then
      fail "FXRP" "0 — pnpm demo needs at least 1"
      fix "https://faucet.flare.network/coston2"
    else
      pass "FXRP" "$human"
    fi
  else
    warn "FXRP" "could not read balance"
  fi
fi

# --- our contracts -----------------------------------------------------------

head_ "Deployed contracts"

if [ ! -f "$DEPLOYMENTS" ]; then
  fail "deployments/coston2.json" "missing"
  fix "cd packages/contracts && forge script script/Deploy.s.sol --rpc-url coston2 --broadcast"
else
  pass "deployments/coston2.json" "present"

  # timestampTrigger postdates the first deployment. Its absence means the file
  # was written by an older Deploy.s.sol, so template #2 has no trigger to
  # deploy against and the addresses should be refreshed.
  if jq -e '.timestampTrigger' "$DEPLOYMENTS" >/dev/null 2>&1; then
    pass "timestampTrigger" "$(jq -r '.timestampTrigger' "$DEPLOYMENTS")"
  else
    fail "timestampTrigger" "absent — this deployment predates it"
    fix "Redeploy: cd packages/contracts && forge script script/Deploy.s.sol --rpc-url coston2 --broadcast"
    fix "Until then, Scheduled Distribution cannot be deployed at all."
  fi

  for key in policyFactory teeAttestorGate manualHeartbeatTrigger fxrp; do
    addr=$(jq -r ".$key // empty" "$DEPLOYMENTS" 2>/dev/null)
    if [ -z "$addr" ]; then
      fail "  $key" "not in the deployments file"
    elif command -v cast >/dev/null 2>&1; then
      code=$(cast code "$addr" --rpc-url "$rpc" 2>/dev/null | head -1)
      if [ "$code" = "0x" ] || [ -z "$code" ]; then
        fail "  $key" "$addr has no code on this chain"
      else
        pass "  $key" "$addr"
      fi
    fi
  done
fi

# --- summary -----------------------------------------------------------------

printf '\n'
if [ "$blocked" -gt 0 ]; then
  printf '%s%d blocking%s' "$RED" "$blocked" "$OFF"
  [ "$warned" -gt 0 ] && printf ', %d to check' "$warned"
  printf '. Fix the ✗ lines above, then run pnpm preflight again.\n\n'
  exit 1
fi

if [ "$warned" -gt 0 ]; then
  printf '%sReady, with %d thing(s) worth checking.%s\n\n' "$YELLOW" "$warned" "$OFF"
  exit 0
fi

printf '%sReady. pnpm demo should run end to end.%s\n\n' "$GREEN" "$OFF"
