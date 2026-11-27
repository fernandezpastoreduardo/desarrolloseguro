import {
  assessPrivacy,
  isThirdPartyPrivacyHost,
  normalizePublicServiceProviderId,
  PRIVACY_EXCESS_THRESHOLDS,
  type PrivacyAssessment,
  type PrivacyCriterionId,
  type PrivacySeverity,
} from "@desarrolloseguro/core";
import { PRIVACY_KNOWLEDGE_RULES } from "./privacy-knowledge-catalog.js";
import { matchPrivacySignal, type PrivacyKnowledgeMatch } from "./privacy-knowledge-base.js";
import { identifyUnattributedProviderDestination } from "./provider-destination-identity.js";
import type { PrivacyBrowserFlowObservation, PrivacyBrowserObservation } from "./privacy-browser-observer.js";

type Finding = { id: string; severity: PrivacySeverity; confidence: "confirmed" | "unknown" };
type Criterion = { id: PrivacyCriterionId; status: "evaluated" | "unknown" | "not_applicable"; findings: Finding[] };

/** Converts bounded browser observations into the published v1 privacy score. */
export function assessPrivacyObservation(observation: PrivacyBrowserObservation): PrivacyAssessment {
  const initial = assessInitialActivity(observation);
  const excess = assessContextualExcess(observation);
  const parity = assessChoiceParity(observation.initial);
  const rejection = assessRejection(observation);
  const vendorControls = assessVendorControls(observation);
  const evidence = summarizePublicEvidence(observation);
  const cookieAudit = summarizeCookieAudit(observation);
  return assessPrivacy({ criteria: [initial, excess, parity, rejection, vendorControls], evidence: { ...evidence, cookieAudit } });
}

/** Returns known providers and stable destination records from completed third-party requests. */
export function getObservedPublicServices(
  observation: PrivacyBrowserObservation,
): Array<{ providerId: string; domain: string }> {
  const services = new Map<string, Set<string>>();
  for (const flow of [observation.initial, observation.accept, observation.reject]) {
    for (const hostname of flow.completedHostsAfterChoice) {
      if (!isThirdPartyPrivacyHost(observation.hostname, hostname) || !isSafeHostname(hostname)) continue;
      const confirmedMatches = matchRequestHost(hostname).filter(isConfirmedMatch);
      if (confirmedMatches.length === 0) {
        const { providerId, hostname: normalizedHostname } = identifyUnattributedProviderDestination(hostname);
        const domains = services.get(providerId) ?? new Set<string>();
        domains.add(normalizedHostname);
        services.set(providerId, domains);
      }
      for (const match of confirmedMatches) {
        const providerId = normalizePublicServiceProviderId(match.provider);
        if (!providerId) continue;
        const domains = services.get(providerId) ?? new Set<string>();
        domains.add(normalizeHostname(hostname));
        services.set(providerId, domains);
      }
    }
    for (const cookie of flow.cookiesAfterChoice) {
      if (!isThirdPartyPrivacyHost(observation.hostname, cookie.domain) || !isSafeHostname(cookie.domain)) continue;
      for (const match of matchCookie(cookie.name, cookie.domain, flow.completedHostsAfterChoice).filter(isConfirmedMatch)) {
        const providerId = normalizePublicServiceProviderId(match.provider);
        if (!providerId) continue;
        const domains = services.get(providerId) ?? new Set<string>();
        domains.add(normalizeHostname(cookie.domain));
        services.set(providerId, domains);
      }
    }
  }
  return [...services.entries()].flatMap(([providerId, domains]) =>
    [...domains].sort((left, right) => left.localeCompare(right, "en")).slice(0, 8)
      .map((domain) => ({ providerId, domain })),
  ).slice(0, 30);
}

function summarizePublicEvidence(observation: PrivacyBrowserObservation): PrivacyAssessment["evidence"] {
  const flows = [observation.initial, observation.accept, observation.reject];
  const cookieNames = new Set<string>();
  const providers = new Set<string>();
  const domains = new Set<string>();
  for (const flow of flows) {
    for (const name of flow.cookiesAfterChoice.map(({ name }) => name)) {
      if (name.length > 0 && name.length <= 128 && isCleanText(name)) cookieNames.add(name);
    }
    for (const hostname of [...flow.signalHostsAfterChoice, ...flow.completedHostsAfterChoice]) {
      if (isThirdPartyPrivacyHost(observation.hostname, hostname) && isSafeHostname(hostname)) domains.add(normalizeHostname(hostname));
    }
    for (const cookie of flow.cookiesAfterChoice) {
      if (isThirdPartyPrivacyHost(observation.hostname, cookie.domain) && isSafeHostname(cookie.domain)) domains.add(normalizeHostname(cookie.domain));
      for (const match of matchCookie(cookie.name, cookie.domain, cookieCorroboratingHosts(flow))) providers.add(match.provider);
    }
    for (const hostname of flow.completedHostsAfterChoice) {
      if (!isThirdPartyPrivacyHost(observation.hostname, hostname)) continue;
      for (const match of matchRequestHost(hostname)) providers.add(match.provider);
    }
  }
  for (const check of observation.vendorControls) {
    if (isCleanText(check.provider) && check.provider.length > 0 && check.provider.length <= 100) providers.add(check.provider);
    for (const hostname of [...check.signalHostsAfterDisable, ...check.completedHostsAfterDisable]) {
      if (isThirdPartyPrivacyHost(observation.hostname, hostname) && isSafeHostname(hostname)) domains.add(normalizeHostname(hostname));
    }
    for (const cookie of check.cookiesAfterDisable) {
      if (cookie.name.length > 0 && cookie.name.length <= 128 && isCleanText(cookie.name)) cookieNames.add(cookie.name);
      if (isThirdPartyPrivacyHost(observation.hostname, cookie.domain) && isSafeHostname(cookie.domain)) domains.add(normalizeHostname(cookie.domain));
    }
  }
  return {
    cookieNames: [...cookieNames].sort((left, right) => left.localeCompare(right, "en-US")).slice(0, 15),
    providers: [...providers].sort((left, right) => left.localeCompare(right, "en-US")).slice(0, 15),
    domains: [...domains].sort((left, right) => left.localeCompare(right, "en-US")).slice(0, 15),
  };
}

function summarizeCookieAudit(observation: PrivacyBrowserObservation): NonNullable<PrivacyAssessment["evidence"]["cookieAudit"]> {
  const catalog = new Map<string, NonNullable<PrivacyAssessment["evidence"]["cookieAudit"]>["catalog"][number]>();
  const initial = summarizeCookieSnapshot(observation.initial, "beforeChoice", catalog);
  const accept = summarizeCookieFlow(observation.accept, catalog);
  const reject = summarizeCookieFlow(observation.reject, catalog);
  return {
    catalog: [...catalog.values()].slice(0, 20),
    initial,
    accept,
    reject,
  };
}

function summarizeCookieFlow(
  flow: PrivacyBrowserFlowObservation,
  catalog: Map<string, NonNullable<PrivacyAssessment["evidence"]["cookieAudit"]>["catalog"][number]>,
): NonNullable<PrivacyAssessment["evidence"]["cookieAudit"]>["accept"] {
  const notApplicable = flow.consentPromptDetected === false;
  return {
    status: notApplicable ? "not_applicable" : flow.phaseEvidence.afterChoice ? "evaluated" : "unknown",
    beforeChoice: summarizeCookieSnapshot(flow, "beforeChoice", catalog),
    afterChoice: summarizeCookieSnapshot(flow, "afterChoice", catalog),
    afterReload: summarizeCookieSnapshot(flow, "afterReload", catalog),
  };
}

function summarizeCookieSnapshot(
  flow: PrivacyBrowserFlowObservation,
  phase: "beforeChoice" | "afterChoice" | "afterReload",
  catalog: Map<string, NonNullable<PrivacyAssessment["evidence"]["cookieAudit"]>["catalog"][number]>,
): NonNullable<PrivacyAssessment["evidence"]["cookieAudit"]>["initial"] {
  const snapshot = flow.phaseEvidence[phase];
  if (!snapshot) return null;
  const complete = snapshot.cookieReadComplete;
  const phaseByName = { beforeChoice: "before_choice", afterChoice: "after_choice", afterReload: "after_reload" } as const;
  const corroboratingHosts = [...new Set(flow.phaseEvidence.networkRequests
    .filter(({ phaseAtStart }) => phaseAtStart === phaseByName[phase])
    .map(({ hostname }) => hostname))];
  const allMatchedCookies = snapshot.cookies.flatMap((cookie) => {
    const matches = matchCookie(cookie.name, cookie.domain, corroboratingHosts);
    if (matches.length === 0) return [];
    const ruleIds = matches.map((match) => match.ruleId).slice(0, 3);
    for (const match of matches) {
      if (!catalog.has(match.ruleId) && catalog.size < 20) {
        catalog.set(match.ruleId, {
          ruleId: match.ruleId,
          datasetVersion: PRIVACY_KNOWLEDGE_RULES.find(({ ruleId }) => ruleId === match.ruleId)?.datasetVersion ?? "unknown",
          category: match.category,
          provider: match.provider,
          purpose: match.purpose,
          confidence: match.confidence,
          classification: match.classification,
          sourceUrl: match.source.url,
          reviewedAt: match.source.reviewedAt,
        });
      }
    }
    return [{ name: cookie.name, domain: cookie.domain, secure: cookie.secure, httpOnly: cookie.httpOnly, ruleIds }];
  });
  return {
    capturedAtMs: snapshot.capturedAtMs,
    complete,
    cookieCount: complete ? snapshot.cookies.length : null,
    matchedCookieCount: allMatchedCookies.length,
    cookies: allMatchedCookies.slice(0, 3),
  };
}

function isSafeHostname(value: string): boolean {
  let normalized = value;
  while (normalized.startsWith(".")) normalized = normalized.slice(1);
  while (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
  return normalized.length <= 253 && /^[a-z0-9.-]+$/iu.test(normalized);
}

function normalizeHostname(value: string): string {
  let normalized = value.toLowerCase();
  while (normalized.startsWith(".")) normalized = normalized.slice(1);
  while (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
  return normalized;
}

function isCleanText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

function assessInitialActivity(observation: PrivacyBrowserObservation): Criterion {
  const flow = observation.initial;
  if (flow.status !== "evaluated" || !flow.cookieReadComplete || !flow.storageReadComplete) {
    return criterion("preference-before-tracking", "unknown");
  }
  const thirdPartyAttempts = thirdPartyHosts(observation.hostname, flow.signalHostsAfterChoice);
  const completedHosts = thirdPartyHosts(observation.hostname, flow.completedHostsAfterChoice);
  const completedHostSet = new Set(completedHosts);
  const blockedHosts = new Set(flow.phaseEvidence.networkRequests
    .filter(({ blockedByAudit, phaseAtStart }) => blockedByAudit && phaseAtStart === "before_choice")
    .map(({ hostname }) => hostname));
  const findings: Finding[] = [];
  for (const [index, hostname] of thirdPartyAttempts.entries()) {
    const matches = matchRequestHost(hostname);
    if (matches.some(isConsentMatch)) continue;
    if (!completedHostSet.has(hostname) && blockedHosts.has(hostname) && matches.some(isConfirmedMatch)) {
      for (const match of matches.filter(isConfirmedMatch)) findings.push(finding(`initial-blocked-host-attempt:${match.ruleId}:${index}`, "medium"));
    } else if (!completedHostSet.has(hostname)) {
      findings.push(finding(`initial-request-unconfirmed:${index}`, "low", "unknown"));
    } else if (matches.some(isConfirmedMatch)) {
      for (const match of matches.filter(isConfirmedMatch)) findings.push(finding(`initial-host:${match.ruleId}`, "high"));
    } else {
      findings.push(finding(`initial-host-unclassified:${index}`, "low", "unknown"));
    }
  }

  const initialCookies = flow.phaseEvidence.beforeChoice?.cookieReadComplete
    ? flow.phaseEvidence.beforeChoice.cookies
    : flow.cookiesAfterChoice;
  for (const [index, cookie] of initialCookies.entries()) {
    const matches = matchCookie(cookie.name, cookie.domain, cookieCorroboratingHosts(flow));
    const confirmed = matches.filter(isConfirmedMatch);
    if (matches.some(isConsentMatch)) continue;
    if (confirmed.length > 0) {
      findings.push(...confirmed.map(({ ruleId }) => finding(`initial-cookie:${ruleId}:${index}`, "medium")));
    } else {
      findings.push(finding(`initial-cookie-unclassified:${index}`, "low", "unknown"));
    }
  }
  for (const [index] of flow.storageKeysAfterChoice.entries()) findings.push(finding(`initial-storage-unclassified:${index}`, "low", "unknown"));
  return { ...criterion("preference-before-tracking", "evaluated"), findings };
}

function assessContextualExcess(observation: PrivacyBrowserObservation): Criterion {
  if (observation.initial.consentPromptDetected === false) return criterion("contextual-excess", "not_applicable");
  const flow = observation.accept;
  if (flow.status !== "evaluated" || !flow.cookieReadComplete || !flow.storageReadComplete) {
    return criterion("contextual-excess", "unknown");
  }
  const confirmed = flow.cookiesAfterChoice.flatMap((cookie) =>
    matchCookie(cookie.name, cookie.domain, cookieCorroboratingHosts(flow))
      .filter((match) => isConfirmedMatch(match) && !isConsentMatch(match))
      .map((match) => ({ ...match, cookieName: cookie.name })),
  );
  const findings: Finding[] = [];
  for (const [index, cookie] of flow.cookiesAfterChoice.entries()) {
    const matches = matchCookie(cookie.name, cookie.domain, cookieCorroboratingHosts(flow));
    if (!matches.some(isConfirmedMatch) && !matches.some(isConsentMatch)) {
      findings.push(finding(`accepted-cookie-unclassified:${index}`, "low", "unknown"));
    }
  }
  for (const [index] of flow.storageKeysAfterChoice.entries()) findings.push(finding(`accepted-storage-unclassified:${index}`, "low", "unknown"));
  const perProviderPurpose = new Map<string, Set<string>>();
  const perPurpose = new Map<string, Set<string>>();
  for (const item of confirmed) {
    const group = `${item.provider}\0${item.purpose}`;
    const providerCookies = perProviderPurpose.get(group) ?? new Set<string>();
    providerCookies.add(item.cookieName);
    perProviderPurpose.set(group, providerCookies);
    const purposeCookies = perPurpose.get(item.purpose) ?? new Set<string>();
    purposeCookies.add(`${item.provider}\0${item.cookieName}`);
    perPurpose.set(item.purpose, purposeCookies);
  }
  for (const [group, cookies] of perProviderPurpose) {
    if (cookies.size > PRIVACY_EXCESS_THRESHOLDS.cookiesPerProviderAndPurpose) findings.push(finding(`excess-provider:${group}`, "high"));
  }
  for (const [purpose, cookies] of perPurpose) {
    if (cookies.size > PRIVACY_EXCESS_THRESHOLDS.cookiesPerPurpose) findings.push(finding(`excess-purpose:${purpose}`, "high"));
  }
  return { ...criterion("contextual-excess", "evaluated"), findings };
}

function assessChoiceParity(flow: PrivacyBrowserFlowObservation): Criterion {
  if (flow.consentPromptDetected === false) return criterion("choice-parity", "not_applicable");
  if (flow.consentPromptDetected !== true || !flow.pageLoaded ||
      flow.acceptVisibleAtFirstLayer === null || flow.rejectVisibleAtFirstLayer === null ||
      flow.actionsToAccept === null || flow.actionsToReject === null) {
    return criterion("choice-parity", "unknown");
  }
  const findings: Finding[] = [];
  if (flow.acceptVisibleAtFirstLayer !== flow.rejectVisibleAtFirstLayer) {
    findings.push(finding("choice-visibility-differs", "high"));
  }
  if (flow.actionsToAccept !== flow.actionsToReject) {
    findings.push(finding("choice-action-count-differs", "medium"));
  }
  return { ...criterion("choice-parity", "evaluated"), findings };
}

function assessRejection(observation: PrivacyBrowserObservation): Criterion {
  if (observation.initial.consentPromptDetected === false) return criterion("rejection-persistence", "not_applicable");
  const flow = observation.reject;
  if (flow.status !== "evaluated" || flow.rejectionPersistedAfterReload === null ||
      !flow.cookieReadComplete || !flow.storageReadComplete) {
    return criterion("rejection-persistence", "unknown");
  }
  const confirmedHosts = thirdPartyHosts(observation.hostname, flow.completedHostsAfterChoice)
    .flatMap((hostname) => matchRequestHost(hostname))
    .filter((match) => isConfirmedMatch(match) && !isConsentMatch(match));
  const confirmedCookies = flow.cookiesAfterChoice.flatMap((cookie) =>
    matchCookie(cookie.name, cookie.domain, cookieCorroboratingHosts(flow))
      .filter((match) => isConfirmedMatch(match) && !isConsentMatch(match)),
  );
  const findings: Finding[] = [];
  if (!flow.rejectionPersistedAfterReload) findings.push(finding("rejection-not-persisted", "high"));
  for (const match of [...confirmedHosts, ...confirmedCookies]) {
    findings.push(finding(`rejected-provider-active:${match.ruleId}`, "high"));
  }
  for (const [index, cookie] of flow.cookiesAfterChoice.entries()) {
    const matches = matchCookie(cookie.name, cookie.domain, cookieCorroboratingHosts(flow));
    if (!matches.some(isConfirmedMatch) && !matches.some(isConsentMatch)) {
      findings.push(finding(`rejected-cookie-unclassified:${index}`, "low", "unknown"));
    }
  }
  for (const [index] of flow.storageKeysAfterChoice.entries()) findings.push(finding(`rejected-storage-unclassified:${index}`, "low", "unknown"));
  return { ...criterion("rejection-persistence", "evaluated"), findings };
}

function assessVendorControls(observation: PrivacyBrowserObservation): Criterion {
  if (observation.initial.consentPromptDetected === false) return criterion("vendor-controls", "not_applicable");
  if (observation.initial.consentPromptDetected !== true) return criterion("vendor-controls", "unknown");
  if (observation.vendorControlCoverage !== "complete" || observation.vendorControls.length === 0 ||
      observation.vendorControls.some(({ status, disabled, persistedDisabled }) =>
        status !== "evaluated" || disabled !== true || persistedDisabled !== true)) {
    return {
      ...criterion("vendor-controls", "unknown"),
      findings: [finding("vendor-control-coverage-incomplete", "low", "unknown")],
    };
  }
  const findings: Finding[] = [];
  for (const [index, check] of observation.vendorControls.entries()) {
    const baselineActive = hasConfirmedProviderActivity(check.provider, observation.accept.cookiesAfterChoice, observation.accept.completedHostsAfterChoice);
    const activityAfterDisable = hasConfirmedProviderActivity(check.provider, check.cookiesAfterDisable, check.completedHostsAfterDisable);
    if (!baselineActive && !activityAfterDisable) {
      return {
        ...criterion("vendor-controls", "unknown"),
        findings: [finding(`provider-baseline-unobserved:${index}`, "low", "unknown")],
      };
    }
    for (const [step] of Array.from({ length: check.actionsToDisable ?? 0 }).entries()) {
      findings.push(finding(`provider-toggle-action:${index}:${step}`, "low"));
    }
    if (activityAfterDisable) findings.push(finding(`provider-active-after-disable:${index}`, "high"));
  }
  return { ...criterion("vendor-controls", "evaluated"), findings };
}

function hasConfirmedProviderActivity(
  provider: string,
  cookies: readonly { name: string; domain: string }[],
  completedHostnames: readonly string[],
): boolean {
  const hostMatches = completedHostnames.flatMap(matchRequestHost)
    .some((match) => match.provider === provider && isConfirmedMatch(match));
  if (hostMatches) return true;
  return cookies.some((cookie) => matchCookie(cookie.name, cookie.domain, completedHostnames)
    .some((match) => match.provider === provider && isConfirmedMatch(match)));
}

function matchCookie(name: string, domain: string, corroboratingHostnames: readonly string[]): PrivacyKnowledgeMatch[] {
  return matchPrivacySignal({
    signalType: "cookie_name",
    value: name,
    observedHostname: domain,
    corroboratingHostnames,
  }, PRIVACY_KNOWLEDGE_RULES);
}

function matchRequestHost(hostname: string): PrivacyKnowledgeMatch[] {
  return matchPrivacySignal({ signalType: "request_host", value: hostname, observedHostname: hostname }, PRIVACY_KNOWLEDGE_RULES);
}

function cookieCorroboratingHosts(flow: PrivacyBrowserFlowObservation): string[] {
  return [...new Set([
    ...flow.completedHostsAfterChoice,
    ...flow.phaseEvidence.networkRequests
      .filter(({ blockedByAudit, phaseAtStart }) => blockedByAudit && phaseAtStart !== "after_policy_link")
      .map(({ hostname }) => hostname),
  ])];
}

function thirdPartyHosts(requestedHostname: string, hostnames: readonly string[]): string[] {
  return [...new Set(hostnames.filter((hostname) => isThirdPartyPrivacyHost(requestedHostname, hostname)))];
}

function isConfirmedMatch(match: PrivacyKnowledgeMatch): boolean {
  return match.classification === "confirmed" && match.confidence === "high";
}

function isConsentMatch(match: PrivacyKnowledgeMatch): boolean {
  return match.classification === "confirmed" && match.category === "consent";
}

function criterion(id: PrivacyCriterionId, status: Criterion["status"]): Criterion {
  return { id, status, findings: [] };
}

function finding(id: string, severity: PrivacySeverity, confidence: Finding["confidence"] = "confirmed"): Finding {
  return { id, severity, confidence };
}
