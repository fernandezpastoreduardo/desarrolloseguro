#!/usr/bin/env bash
set -euo pipefail

# This script prepares only the Development Seguro side of the D identity.
# It never enables the audit worker and never writes a Grumphya secret.

readonly SECRETS_DIR="${AUDIT_SECRETS_DIR:-/opt/desarrollo-seguro/secrets}"
readonly KID="${AUDIT_TECHNICAL_AUTH_KID:-ds-auditor-2026}"
readonly PRIVATE_KEY="$SECRETS_DIR/audit_jwt_private.pem"
readonly PUBLIC_KEY="$SECRETS_DIR/audit_jwt_public.pem"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  printf 'internal_audit_identity_requires_root\n' >&2
  exit 2
fi

if [[ ! "$KID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
  printf 'internal_audit_identity_kid_invalid\n' >&2
  exit 1
fi

if [[ -e "$PRIVATE_KEY" || -e "$PUBLIC_KEY" ]]; then
  printf 'internal_audit_identity_exists\n' >&2
  printf 'Remove neither key manually; use a reviewed rotation procedure.\n' >&2
  exit 1
fi

install -d -o root -g root -m 0700 "$SECRETS_DIR"
readonly PRIVATE_TEMP="$PRIVATE_KEY.tmp.$$"
readonly PUBLIC_TEMP="$PUBLIC_KEY.tmp.$$"
trap 'rm -f "$PRIVATE_TEMP" "$PUBLIC_TEMP"' EXIT

umask 077
openssl genpkey -algorithm Ed25519 -out "$PRIVATE_TEMP"
openssl pkey -in "$PRIVATE_TEMP" -pubout -out "$PUBLIC_TEMP"

chown root:root "$PRIVATE_TEMP" "$PUBLIC_TEMP"
chmod 0400 "$PRIVATE_TEMP"
chmod 0400 "$PUBLIC_TEMP"
mv "$PRIVATE_TEMP" "$PRIVATE_KEY"
mv "$PUBLIC_TEMP" "$PUBLIC_KEY"
trap - EXIT

readonly FINGERPRINT="$(openssl pkey -pubin -in "$PUBLIC_KEY" -outform DER | openssl dgst -sha256 -r | awk '{print $1}')"
printf 'internal_audit_identity_ready kid=%s public_key=%s sha256=%s enabled=false\n' \
  "$KID" "$PUBLIC_KEY" "$FINGERPRINT"
printf 'Share only the public PEM and this fingerprint with Grumphya.\n'
