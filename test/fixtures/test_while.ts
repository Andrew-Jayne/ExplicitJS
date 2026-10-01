// Fixture: the `while` check — implicit truthiness in while/do-while conditions.
// Parsed, never executed; marker grammar in test/README.md.

while (queue) { // expect: while
  processNext(queue);
}

while (queue.length > 0) {
  processNext(queue);
}

do {
  drainOne();
} while (pending); // expect: while

do {
  drainOne();
} while (pending === true);
