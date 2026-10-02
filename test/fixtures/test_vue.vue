<!-- Fixture: `.vue` components — code checks fire inside script blocks, and
     the template markup is scanned for bare attributes (`bool_attr`).
     Line numbers refer to this original file.
     Parsed, never executed; marker grammar in test/README.md. -->
<template>
  <div v-if="visible">{{ value }}</div> // expect: if
  <input disabled> // expect: bool_attr
  <Widget :active="true" v-once @open="show" />

  <!-- Template code gets the same checks as script code. -->
  <p v-if="items.length > 0">{{ user?.name }}</p> // expect: optional_chain
  <p v-else-if="pending">{{ label ?? "none" }}</p> // expect: if, nullish_coalesce
  <p v-show="count > 0 ? shown : hidden">{{ total }}</p> // expect: if, ternary
  <Row v-for="(r, index) in rows" :key="r.id" :data="r" /> // expect: single_letter_var
  <Row v-for="row in rows" :key="row.id" :data="row" />
  <button @click="open = !open">toggle</button> // expect: not
  <button @click="ready === true && submit()">send</button> // expect: bool_op
  <Panel :visible="left == right" :items="rows.filter(Boolean)" /> // expect: loose_equality, filter
  <template #item="{ x }">{{ x.name }}</template> // expect: single_letter_var
  <p>Press { to open a block</p>
  <Widget active /> // expect: bool_attr
</template>

<script setup lang="ts">
if (items) { // expect: if
  handleItems(items);
}
report(name ?? "anonymous"); // expect: nullish_coalesce
report(total > 0 ? "some" : "none"); // expect: ternary
</script>
