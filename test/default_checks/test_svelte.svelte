<!-- Fixture: `.svelte` components — code checks fire inside script blocks,
     and the template markup is scanned for bare attributes (`bool_attr`).
     Line numbers refer to this original file.
     Parsed, never executed; marker grammar in test/README.md. -->
<script>
if (items) { // expect: if
  handleItems(items);
}
report(user?.name); // expect: optional_chain
report(left == right); // expect: loose_equality
</script>

{#if visible}
  <div>{value}</div>
  <input disabled /> // expect: bool_attr
  <Widget active={true} on:select={pick} bind:open {...rest} />
{/if}
