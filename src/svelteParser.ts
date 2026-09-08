/**
 * Svelte single-file components carry their logic in `<script>` blocks — the
 * instance script, plus optionally a module script (`context="module"` in
 * Svelte 4, the bare `module` attribute in Svelte 5). `extractSvelteScripts`
 * pulls those blocks out of a `.svelte` source so the regular TS/JS analyzer
 * can run on them; the surrounding template is ignored entirely.
 *
 * This is a tag scan, not a full Svelte parse. Like Svelte's own parser, a
 * block ends at the first `</script` after its opening tag, so a stray
 * `"</script>"` string literal inside a block ends it early. Blocks whose
 * opening tag has a `src` attribute reference an external file and are
 * skipped — that file is picked up by the normal directory walk instead.
 *
 * Each block's content comes back prefixed with one newline per line that
 * precedes it in the component, so TypeScript's own line accounting reports
 * check positions in the original `.svelte` file with no mapping step.
 */

export interface SvelteScriptBlock {
  /** Script content, newline-padded to preserve original line numbers. */
  content: string;
  /** True when the opening tag declares `lang="ts"` (or `"typescript"`). */
  isTypeScript: boolean;
}

const LANG_ATTRIBUTE = /\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const SRC_ATTRIBUTE = /\bsrc\s*=/i;
const TYPESCRIPT_LANGS: ReadonlySet<string> = new Set(["ts", "typescript"]);

function isTypeScriptBlock(attributes: string): boolean {
  const langMatch = LANG_ATTRIBUTE.exec(attributes);
  if (langMatch === null) {
    return false;
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
    return false;
  }
  return TYPESCRIPT_LANGS.has(value.toLowerCase());
}

function newlinesBefore(source: string, index: number): number {
  return source.slice(0, index).split("\n").length - 1;
}

export function extractSvelteScripts(source: string): SvelteScriptBlock[] {
  const blocks: SvelteScriptBlock[] = [];
  // Attribute values may themselves contain `>` (Svelte 5's
  // `generics="T extends Record<string, unknown>"`), so the attribute part of
  // the match steps over quoted strings instead of stopping at the first `>`.
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
        isTypeScript: isTypeScriptBlock(attributes),
      });
    }
    openTag.lastIndex = closeTag.lastIndex;
    tagMatch = openTag.exec(source);
  }
  return blocks;
}
