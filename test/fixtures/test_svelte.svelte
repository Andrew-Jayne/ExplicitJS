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

{#if visible} // expect: if
  <div>{value}</div>
  <input disabled /> // expect: bool_attr
  <Widget active={true} on:select={pick} bind:open {...rest} />
{/if}

<!-- Template code gets the same checks as script code. -->
{#if items.length > 0}
  <p>{user?.name}</p> // expect: optional_chain
{:else if pending} // expect: if
  <p>{label ?? "none"}</p> // expect: nullish_coalesce
{:else if pending === true}
  <p>{count > 0 ? "some" : "none"}</p> // expect: ternary
{/if}
{#each rows as r, index (r.id)} // expect: single_letter_var
  <Row data={r} even={index % 2 === 0} hidden={!r.visible} /> // expect: not
{/each}
{#each rows as row (row.id)}
  <Row data={row} />
{/each}
{@const total = left == right} // expect: loose_equality
{#await request then response}
  <p class="status {response.ok && response.body}">{total}</p> // expect: bool_op, bool_op
{/await}
<button on:click={() => !open}>toggle</button> // expect: arrow
<Widget {...props} enabled={props.enabled === true} />
