// Fixture: the `single_use_var` check — a variable assigned once and read
// exactly once (UPPER_SNAKE_CASE constants and exports are exempt).
// Parsed, never executed.

const greeting = buildGreeting(); // expect: single_use_var
report(greeting);

const shared = buildShared();
report(shared);
archive(shared);

const MAX_RETRIES = 3;
report(MAX_RETRIES);

export const exportedTotal = computeTotal();
report(exportedTotal);
