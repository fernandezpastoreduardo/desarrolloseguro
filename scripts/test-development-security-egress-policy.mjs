import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [networkScript, firewallScript, deployScript, compose] = await Promise.all([
  readFile("scripts/create-development-security-egress-network.sh", "utf8"),
  readFile("scripts/configure-development-security-egress-firewall.sh", "utf8"),
  readFile("scripts/deploy-development-security-analysis.sh", "utf8"),
  readFile("compose.production.yaml", "utf8"),
]);

assert.match(networkScript, /NETWORK_NAME="development-security-egress"/u);
assert.match(networkScript, /BRIDGE_NAME="br-ds-egress"/u);
assert.match(networkScript, /--ipv6=false/u);
assert.match(networkScript, /--label io\.desarrolloseguro\.role=egress/u);
assert.match(networkScript, /"bridge\|false\|false\|\$BRIDGE_NAME\|egress"/u);
assert.doesNotMatch(networkScript, /grumphya|DOCKER-USER|iptables|ufw/iu);

assert.match(firewallScript, /BRIDGE_NAME="br-ds-egress"/u);
assert.match(firewallScript, /CHAIN_NAME="DS_DEVSEC_EGRESS"/u);
assert.match(firewallScript, /NETWORK_NAME="development-security-egress"/u);
assert.match(firewallScript, /10\.0\.0\.0\/8/u);
assert.match(firewallScript, /172\.16\.0\.0\/12/u);
assert.match(firewallScript, /192\.168\.0\.0\/16/u);
assert.match(firewallScript, /--dports 80,443 -j RETURN/u);
assert.match(firewallScript, /iptables -A "\$CHAIN_NAME" -j DROP/u);
assert.match(firewallScript, /DOCKER-USER -i "\$BRIDGE_NAME" -j "\$CHAIN_NAME"/u);
assert.match(firewallScript, /iptables -I DOCKER-USER 1 -i "\$BRIDGE_NAME" -j "\$CHAIN_NAME"/u);
assert.match(firewallScript, /ip6tables -I FORWARD 1 -o "\$BRIDGE_NAME" -j DROP/u);
assert.match(firewallScript, /INPUT -i "\$BRIDGE_NAME" -j DROP/u);
assert.match(firewallScript, /ip6tables FORWARD -i "\$BRIDGE_NAME" -j DROP/u);
assert.match(firewallScript, /ip6tables FORWARD -o "\$BRIDGE_NAME" -j DROP/u);
assert.doesNotMatch(
  firewallScript,
  /iptables\s+(-F\s+DOCKER-USER|-P\s+(?:INPUT|FORWARD|OUTPUT)|.*grumphya)|ufw/iu,
);
assert.match(deployScript, /create-development-security-egress-network\.sh verify/u);
assert.match(deployScript, /configure-development-security-egress-firewall\.sh verify/u);
assert.match(deployScript, /DEVELOPMENT_SECURITY_SECRETS_DIR="\/opt\/desarrollo-seguro\/secrets"/u);
assert.match(deployScript, /development-security-api development-security-runtime-coordinator development-security-worker development-security-web/u);
assert.doesNotMatch(deployScript, /(?:down|--volumes|grumphya|development-security-database)/u);
assert.match(compose, /DS_RUNTIME_EGRESS_NETWORK:\s*development-security-egress/u);
assert.match(compose, /development-security-analysis-egress:\n    name: development-security-egress\n    external: true/u);
for (const serviceName of [
  "development-security-web",
  "development-security-api",
  "development-security-worker",
  "development-security-database",
]) {
  const service = compose.match(
    new RegExp(`^  ${serviceName}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|^networks:)`, "mu"),
  )?.[1];
  assert.ok(service, `Compose must define ${serviceName}`);
  assert.doesNotMatch(service, /development-security-egress/u);
}

process.stdout.write("Development Seguro egress policy passed.\n");
