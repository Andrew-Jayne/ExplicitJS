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

for (let node = head; node; node = node.next) { // expect: while
  visit(node);
}

for (let node = head; node !== null; node = node.next) {
  visit(node);
}

for (;;) {
  break;
}
