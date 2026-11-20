import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = await readFile("scripts/probe-development-security-egress.sh", "utf8");

assert.match(script, /DEFAULT_HOSTNAME="grumphya\.com"/u);
assert.match(script, /DEFAULT_URL="https:\/\/grumphya\.com\/"/u);
assert.match(script, /egress_probe_target_invalid/u);
assert.match(script, /--connect-timeout 5 --max-time 15 --retry 0/u);
assert.match(script, /--output \/dev\/null/u);
assert.match(script, /%\{http_code\}/u);
assert.match(script, /%\{remote_ip\}/u);
assert.match(script, /dns_resolution_failed/u);
assert.match(script, /tcp_connection_failed/u);
assert.match(script, /tls_negotiation_failed/u);
assert.doesNotMatch(script, /--include|--dump-header|--trace|response_body|authorization|cookie/iu);

process.stdout.write("Development Seguro egress probe policy passed.\n");
