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

// A single-name destructure is a property access with a detour.
const { profile } = user; // expect: single_use_var
report(profile);

const [firstEntry] = entries; // expect: single_use_var
report(firstEntry);

const { data, error } = response;
report(data, error);

const { port = 3000 } = settings;
report(port);

// A no-op statement does not count as a use.
const padded = buildPadded(); // expect: single_use_var
void padded;
padded;
report(padded);

// A type-member name is not a read of the same-named variable.
const label = buildLabel(); // expect: single_use_var
render(label, { label: "", size: 1 } as { label: string; size: number });
