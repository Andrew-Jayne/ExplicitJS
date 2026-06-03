export function caller(): number {
  function helper(): number { // expect: single_use_func
    return 1;
  }
  return helper();
}

export function caller2(): number {
  function twice(): number {
    return 2;
  }
  return twice() + twice();
}

function main(): void {
  doStuff();
}

function doStuff(): void {
  /* called only from main, in a nested scope */
}
