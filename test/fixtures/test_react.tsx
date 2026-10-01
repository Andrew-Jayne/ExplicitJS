// Fixture: React/JSX interactions with the stock checks. Ternaries inside JSX
// still flag (with JSX-aware advice); `cond && <El/>` flags per non-boolean
// operand. Local components, HOC-wrapped default exports, and handlers passed
// by reference are exempt from the single-use checks — a JSX tag, `memo(X)`,
// or `onClick={handler}` is a reference read, not an inlinable call.
// Parsed, never executed.

export function StatusBadge(props: { count: number; active: boolean }) {
  return (
    <div>
      <span>{props.active ? "on" : "off"}</span> // expect: ternary
      <em title={props.count > 0 ? "some" : "none"}>count</em> // expect: ternary
      {props.count && <strong>nonzero</strong>} // expect: bool_op, bool_op
      {props.count > 0 && <strong>plural</strong>} // expect: bool_op
    </div>
  );
}

export function Toolbar(props: { labels: string[] }) {
  const heading = format(props.labels); // expect: single_use_var
  const handleReset = () => {
    report("reset");
  };
  function describeOnce(): string { // expect: single_use_func
    return "toolbar";
  }
  function Row() {
    return <li>row</li>;
  }
  return (
    <ul aria-label={heading} onClick={handleReset}>
      <Row />
      {describeOnce()}
      {props.labels.map((label) => (label.length > 0 ? <li>{label}</li> : <li>empty</li>))} // expect: ternary
    </ul>
  );
}

function Branding() {
  return <footer>brand</footer>;
}
export default memo(Branding);
