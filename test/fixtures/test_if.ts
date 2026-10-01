// Fixture: the `if` check — implicit truthiness in if conditions.
// Parsed, never executed; marker grammar in test/README.md.

if (items) { // expect: if
  handleItems(items);
}

if (items.length > 0) {
  handleItems(items);
}

if (user === null) {
  handleMissingUser();
}

if (!ready) { // expect: if
  waitUntilReady();
}

if (!(count > 0)) {
  handleEmptyCount();
}

if (loadRecords()) { // expect: if
  reportLoaded();
} else if (retries) { // expect: if
  scheduleRetry();
}
