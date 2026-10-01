// Fixture: the `bool_attr` check — a bare JSX attribute means `={true}`
// only by convention, so the value must be written out. Explicit values,
// string attributes, and spread attributes are all fine.
// Parsed, never executed.

export function Panel(props: { rest: object }) {
  return (
    <section>
      <Widget active /> // expect: bool_attr
      <input disabled required /> // expect: bool_attr, bool_attr
      <Widget active={true} />
      <Widget active={false} />
      <Widget label="on" />
      <Widget {...props.rest} />
    </section>
  );
}
