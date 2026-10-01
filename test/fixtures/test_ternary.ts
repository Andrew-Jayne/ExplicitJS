// Fixture: the `ternary` check — inline conditionals.
// Parsed, never executed; marker grammar in test/README.md.

report(active ? "on" : "off"); // expect: ternary

if (mode === "fast") {
  applyFast();
} else {
  applySlow();
}

report(count > 0 ? "some" : "none"); // expect: ternary
