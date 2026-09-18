const SEVERITY_ORDER = Object.freeze({ mild: 1, cruel: 2, diabolical: 3 });

function normalizeChallengeSeverity(severity) {
  return Object.hasOwn(SEVERITY_ORDER, severity) ? severity : 'diabolical';
}

function minSeverityAllowed(severity, minSeverity) {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[minSeverity];
}

export { SEVERITY_ORDER, minSeverityAllowed, normalizeChallengeSeverity };
