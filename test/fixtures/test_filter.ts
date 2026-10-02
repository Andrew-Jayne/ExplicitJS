// Fixture: the `filter` check — truthiness predicates in .filter/.find/
// .some/.every. Parsed, never executed; marker grammar in test/README.md.

report(entries.filter(Boolean)); // expect: filter
report(entries.filter(isPresent));

// Builtins that coerce, however the call is spelled.
report(entries.filter(globalThis.Boolean)); // expect: filter
report(entries["filter"](Boolean)); // expect: filter
report(names.filter(String)); // expect: filter
report(amounts.filter(Number)); // expect: filter
report(entries.some(Boolean)); // expect: filter
report([user, session].every(Boolean)); // expect: filter
report(entries.find(Boolean)); // expect: filter
report(entries.map(Boolean));

// Callbacks returning a bare value are the same filter with extra steps.
report(entries.filter((entry) => entry)); // expect: filter
report(users.filter((user) => user.email)); // expect: filter
report(users.findIndex((user) => user.isActive())); // expect: filter
report(entries.filter((entry) => entry !== null));
report(users.some((user) => user.email.length > 0));
report(users.every((user) => true));
report(
  entries.filter(function (entry) {
    if (entry === null) {
      return false;
    }
    return entry.label; // expect: filter
  }),
);
report(
  entries.filter(function (entry) {
    const describe = () => entry.label;
    report(describe);
    return describe() !== "";
  }),
);
report(entries.map((entry) => entry.label));
