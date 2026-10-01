// Fixture: the `filter` check — `.filter(Boolean)` implicit-truthiness filters.
// Parsed, never executed; marker grammar in test/README.md.

report(entries.filter(Boolean)); // expect: filter
report(entries.filter(isPresent));
