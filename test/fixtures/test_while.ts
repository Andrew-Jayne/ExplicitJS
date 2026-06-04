export const queue = [1];
export const ready = false;
export const size = 3;
export function poll(): boolean {
  return false;
}

while (queue) {
  break;
} // expect: while
while (poll()) {
  break;
} // expect: while
while (!ready) {
  break;
} // expect: while
while (size > 0) {
  break;
}
while (ready === true) {
  break;
}
do {
  /* */
} while (queue); // expect: while
do {
  /* */
} while (size > 0);
