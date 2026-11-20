export function logOperation(level, operation, outcome) {
  // Callers supply fixed labels so neither visitor input nor storage errors reach the logs.
  console[level](JSON.stringify({ service: 'second-ink', operation, outcome }));
}
