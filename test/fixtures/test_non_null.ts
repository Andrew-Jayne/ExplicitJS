// Fixture: the `non_null` check — `!` assertions that claim presence instead
// of checking it. Parsed, never executed; marker grammar in test/README.md.

report(request!.headers); // expect: non_null
report(session.user!.name); // expect: non_null
report(lookup.get(key)!); // expect: non_null
report(request!.headers!.token); // expect: non_null, non_null

// Index access under noUncheckedIndexedAccess is the type system's idiom,
// not a skipped validation.
report(entries[0]!);
report(table[row]![column]!);

if (request !== null) {
  report(request.headers);
}
