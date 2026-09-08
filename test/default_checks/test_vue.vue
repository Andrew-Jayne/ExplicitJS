<!-- Fixture: `.vue` components — code checks fire inside script blocks, and
     the template markup is scanned for bare attributes (`bool_attr`).
     Line numbers refer to this original file.
     Parsed, never executed; marker grammar in test/README.md. -->
<template>
  <div v-if="visible">{{ value }}</div>
  <input disabled> // expect: bool_attr
  <Widget :active="true" v-once @open="show" />
</template>

<script setup lang="ts">
if (items) { // expect: if
  handleItems(items);
}
report(name ?? "anonymous"); // expect: nullish_coalesce
report(total > 0 ? "some" : "none"); // expect: ternary
</script>
