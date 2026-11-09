#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s <offline-ca-directory> <output-directory>\n' "$0" >&2
  exit 2
fi

readonly CA_DIR=$1
readonly OUTPUT_DIR=$2
readonly CA_CERT="$CA_DIR/internal_tls_ca.crt"
readonly CA_KEY="$CA_DIR/internal_tls_ca.key"
readonly REQUIRED_CA_FILES=("$CA_CERT" "$CA_KEY")
readonly GENERATED_FILES=(
  development_security_api_tls.crt
  development_security_api_tls.key
  development_security_database_tls.crt
  development_security_database_tls.key
)

for file in "${REQUIRED_CA_FILES[@]}"; do
  [[ -f $file && ! -L $file && -r $file ]] || {
    printf 'Offline TLS CA material is missing or invalid: %s\n' "$file" >&2
    exit 1
  }
done

mkdir -p -- "$OUTPUT_DIR"
for file in "${GENERATED_FILES[@]}"; do
  if [[ -e "$OUTPUT_DIR/$file" || -L "$OUTPUT_DIR/$file" ]]; then
    printf 'Refusing to overwrite existing Development Security TLS material: %s\n' "$OUTPUT_DIR/$file" >&2
    exit 1
  fi
done

readonly TEMP_DIR=$(mktemp -d "$OUTPUT_DIR/.development-security-tls.XXXXXX")
cleanup() {
  rm -rf -- "$TEMP_DIR"
}
trap cleanup EXIT
install -m 0600 "$CA_CERT" "$TEMP_DIR/internal_tls_ca.crt"
install -m 0600 "$CA_KEY" "$TEMP_DIR/internal_tls_ca.key"

create_leaf_certificate() {
  local service=$1 san=$2
  openssl req -new -newkey rsa:2048 -nodes -sha256 \
    -keyout "$TEMP_DIR/development_security_${service}_tls.key" \
    -out "$TEMP_DIR/development_security_${service}_tls.csr" \
    -subj "/CN=$service"
  cat > "$TEMP_DIR/development_security_${service}_tls.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:$san
EOF
  openssl x509 -req -sha256 -days 397 \
    -in "$TEMP_DIR/development_security_${service}_tls.csr" \
    -CA "$TEMP_DIR/internal_tls_ca.crt" \
    -CAkey "$TEMP_DIR/internal_tls_ca.key" \
    -CAserial "$TEMP_DIR/internal_tls_ca.srl" \
    -CAcreateserial \
    -extfile "$TEMP_DIR/development_security_${service}_tls.ext" \
    -out "$TEMP_DIR/development_security_${service}_tls.crt"
}

create_leaf_certificate api development-security-api
create_leaf_certificate database development-security-database

for file in "${GENERATED_FILES[@]}"; do
  install -m 0600 "$TEMP_DIR/$file" "$OUTPUT_DIR/$file"
done
chmod 0644 \
  "$OUTPUT_DIR/development_security_api_tls.crt" \
  "$OUTPUT_DIR/development_security_database_tls.crt"

printf 'Created Desarrollo Seguro leaf certificates signed by the offline CA in %s. Keep the CA key offline.\n' "$OUTPUT_DIR"
