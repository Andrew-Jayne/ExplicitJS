// Fixture: the `bool_op` check — `&&` / `||` (and `&&=` / `||=`) with
// non-boolean operands, one finding per implicit operand. Parsed, never executed.

report(first && second); // expect: bool_op, bool_op
report(ready === true && steady === true);
report(primary || fallback); // expect: bool_op, bool_op
report(alpha && beta && gamma); // expect: bool_op, bool_op, bool_op
report(count > 0 || items.length > 0);
report(ready === true && other); // expect: bool_op
enabled ||= hasAccess; // expect: bool_op, bool_op
verbose &&= wantsLogs === true; // expect: bool_op
