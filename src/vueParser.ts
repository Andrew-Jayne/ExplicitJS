/**
 * Vue single-file components carry their logic in `<script>` blocks — a
 * component may have both a plain `<script>` (options / module scope) and a
 * `<script setup>` block. `extractVueScripts` pulls those blocks out of a
 * `.vue` source so the regular TS/JS analyzer can run on them; the
 * `<template>` and `<style>` sections are ignored entirely.
 *
 * This is a tag scan, not a full SFC parse. Like the reference
 * `@vue/compiler-sfc`, a block ends at the first `</script` after its opening
 * tag, so a stray `"</script>"` string literal inside a block ends it early.
 * The opening-tag match allows `>` inside quoted attribute values, which
 * generic components rely on (`generic="T extends Record<string, any>"`).
 * Blocks whose opening tag has a `src` attribute reference an external file
 * and are skipped — that file is picked up by the normal directory walk
 * instead.
 *
 * Each block's content comes back prefixed with one newline per line that
 * precedes it in the component, so TypeScript's own line accounting reports
 * check positions in the original `.vue` file with no mapping step.
 */

/** Normalized `lang` attribute value; picks the TypeScript parser's dialect. */
export type VueScriptLang = "js" | "ts" | "jsx" | "tsx";

export interface VueScriptBlock {
  /** Script content, newline-padded to preserve original line numbers. */
  content: string;
  lang: VueScriptLang;
}

const LANG_ATTRIBUTE = /\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const SRC_ATTRIBUTE = /\bsrc\s*=/i;

function blockLang(attributes: string): VueScriptLang {
  const langMatch = LANG_ATTRIBUTE.exec(attributes);
  if (langMatch === null) {
    return "js";
  }
  // The value sits in whichever alternative matched: double-quoted,
  // single-quoted, or bare.
  let value = langMatch[1];
  if (value === undefined) {
    value = langMatch[2];
  }
  if (value === undefined) {
    value = langMatch[3];
  }
  if (value === undefined) {
    return "js";
  }
  const normalized = value.toLowerCase();
  if (normalized === "ts" || normalized === "typescript") {
    return "ts";
  }
  if (normalized === "tsx") {
    return "tsx";
  }
  if (normalized === "jsx") {
    return "jsx";
  }
  return "js";
}

function newlinesBefore(source: string, index: number): number {
  return source.slice(0, index).split("\n").length - 1;
}

export function extractVueScripts(source: string): VueScriptBlock[] {
  const blocks: VueScriptBlock[] = [];
  const openTag = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  const closeTag = /<\/script/gi;

  let tagMatch = openTag.exec(source);
  while (tagMatch !== null) {
    const contentStart = tagMatch.index + tagMatch[0].length;
    closeTag.lastIndex = contentStart;
    const closeMatch = closeTag.exec(source);
    if (closeMatch === null) {
      break;
    }
    let attributes = tagMatch[1];
    if (attributes === undefined) {
      attributes = "";
    }
    if (SRC_ATTRIBUTE.test(attributes) === false) {
      blocks.push({
        content:
          "\n".repeat(newlinesBefore(source, contentStart)) +
          source.slice(contentStart, closeMatch.index),
        lang: blockLang(attributes),
      });
    }
    openTag.lastIndex = closeTag.lastIndex;
    tagMatch = openTag.exec(source);
  }
  return blocks;
}
