/**
 * Template scan for Svelte and Vue component markup: bare attributes, and the
 * code embedded in the markup.
 *
 * `<Widget active />` relies on the framework convention that a bare attribute
 * means true (Svelte passes `true`; Vue passes an empty string that Boolean
 * props coerce to true). The explicit forms — `active={true}` in Svelte,
 * `:active="true"` in Vue — state the value, so this scan flags every
 * valueless attribute in the markup. `<script>`/`<style>` blocks are skipped:
 * scripts are analyzed as code, and their own tags carry mode markers
 * (`setup`, `scoped`) that have no explicit form.
 *
 * The same walk collects every template expression — Vue's `{{ }}`,
 * `v-if`/`v-show`/`v-for`/`:prop`/`@event`/`#slot` values, Svelte's `{...}`
 * text and attribute values, `{#if}`/`{:else if}`/`{#each}`/`{#await}`/
 * `{#key}`/`{#snippet}`/`{@const}`/`{@html}` blocks — as `TemplateExpression`
 * spans tagged with their role, so `templateExpressions.ts` can run the code
 * checks on them. A `v-if` is an `if` condition: it gets the implicit-boolean
 * check exactly like one in the script.
 *
 * This is a tag scan, not a full template parse, in the same spirit as the
 * script extractors. Framework directives that are legitimately valueless are
 * exempt: names containing ':' (bind:/on:/class:/let:, Vue's same-name `:prop`
 * shorthand, v-slot:, xmlns:), and for Vue the 'v-' directives (v-else,
 * v-once, ...) plus the '@'/'#' shorthands. Brace expressions are skipped with
 * depth counting, so `{#if a < b}` blocks never read as tags (Vue skips only
 * `{{ ... }}`, since a lone `{` is plain text there); markup broken enough to
 * defeat the scan degrades to missed flags, never false ones.
 */

import { CheckType, type StyleCheck } from "./constructs.ts";

export type MarkupFlavor = "svelte" | "vue";

/**
 * How a template expression's code is wrapped to parse it as script:
 * `condition` as `if (…) {}`, `expression` as `(…);`, `handler` (Vue's
 * `@event` value, which may be statements) as a block, `params` (a `v-for`
 * alias, slot props, an `{#each}` binding) as an arrow's parameter list,
 * `declaration` (`{@const x = …}`) as a `const` statement.
 */
export type TemplateRole = "condition" | "expression" | "handler" | "params" | "declaration";

export interface TemplateExpression {
  role: TemplateRole;
  /** The code exactly as written. */
  text: string;
  /** Offset of `text` in the component source. */
  start: number;
  /** How the construct reads in the template, `%` standing for the code: `v-if="%"`. */
  label: string;
}

export interface MarkupScan {
  attrs: StyleCheck[];
  expressions: TemplateExpression[];
}

const TAG_NAME_START = /[A-Za-z]/;
const NAME_END_CHARS: ReadonlySet<string> = new Set([" ", "\t", "\n", "\r", "=", "/", ">"]);
const WHITESPACE_CHARS: ReadonlySet<string> = new Set([" ", "\t", "\n", "\r"]);
const QUOTE_CHARS: ReadonlySet<string> = new Set(['"', "'", "`"]);
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(["script", "style"]);
const OPENERS: ReadonlySet<string> = new Set(["(", "[", "{"]);
const CLOSERS: ReadonlySet<string> = new Set([")", "]", "}"]);
const VUE_CONDITIONS: ReadonlySet<string> = new Set(["v-if", "v-else-if", "v-show"]);

// Svelte blocks whose whole body is one expression of the given role.
const SVELTE_BLOCKS: readonly { prefix: string; role: TemplateRole }[] = [
  { prefix: "#if", role: "condition" },
  { prefix: ":else if", role: "condition" },
  { prefix: "#key", role: "expression" },
  { prefix: "@html", role: "expression" },
  { prefix: "@render", role: "expression" },
  { prefix: "@debug", role: "expression" },
  { prefix: "@const", role: "declaration" },
  { prefix: ":then", role: "params" },
  { prefix: ":catch", role: "params" },
];

export function scanMarkup(source: string, filename: string, flavor: MarkupFlavor): MarkupScan {
  const scanner = new MarkupScanner(source, filename, flavor);
  scanner.scan();
  return { attrs: scanner.results, expressions: scanner.expressions };
}

export function findBareMarkupAttrs(
  source: string,
  filename: string,
  flavor: MarkupFlavor,
): StyleCheck[] {
  return scanMarkup(source, filename, flavor).attrs;
}

/**
 * Index of `needle` in `text` outside any brackets or quotes, searching from
 * `from`; -1 when absent. `{#each items as item, index (item.id)}` splits on
 * its top-level ` as `, `,` and `(` this way, never on ones nested in the code.
 */
function findTopLevel(text: string, needle: string, from: number): number {
  let depth = 0;
  let index = from;
  while (index < text.length) {
    const current = text[index]!;
    if (QUOTE_CHARS.has(current) === true) {
      let closing = index + 1;
      while (closing < text.length && text[closing] !== current) {
        if (text[closing] === "\\") {
          closing += 1;
        }
        closing += 1;
      }
      index = closing + 1;
      continue;
    }
    if (depth === 0 && text.startsWith(needle, index) === true) {
      return index;
    }
    if (OPENERS.has(current) === true) {
      depth += 1;
    } else if (CLOSERS.has(current) === true) {
      depth -= 1;
    }
    index += 1;
  }
  return -1;
}

class MarkupScanner {
  readonly results: StyleCheck[] = [];
  readonly expressions: TemplateExpression[] = [];
  private readonly source: string;
  private readonly filename: string;
  private readonly flavor: MarkupFlavor;
  private index = 0;

  constructor(source: string, filename: string, flavor: MarkupFlavor) {
    this.source = source;
    this.filename = filename;
    this.flavor = flavor;
  }

  scan(): void {
    while (this.index < this.source.length) {
      const current = this.source[this.index]!;
      if (current === "{") {
        // Svelte text may hold `{expr}` and `{#block}` tags (where a `<` is
        // not a tag); Vue text expressions are `{{ expr }}`, and a lone `{` is
        // plain text there - brace matching it would swallow the rest of the
        // template.
        const open = this.index;
        if (this.flavor === "svelte") {
          this.skipBraced();
          // One Svelte `{...}` tag, `blockStart`/`blockEnd` bounding the text
          // inside the braces.
          const blockStart = open + 1;
          const blockEnd = this.index - 1;
          const body = this.source.slice(blockStart, blockEnd);
          const trimmed = body.trimStart();
          const offset = blockStart + body.length - trimmed.length;

          if (trimmed.startsWith("#each") === true) {
            // `{#each items as item, index (item.id)}` - and Svelte 5's
            // `{#each items, index}` with no binding. The binding and index
            // together are one parameter list; the key is an expression.
            const eachStart = offset + 5;
            const eachText = this.source.slice(eachStart, blockEnd);
            const asAt = findTopLevel(eachText, " as ", 0);
            if (asAt === -1) {
              const commaAt = findTopLevel(eachText, ",", 0);
              if (commaAt === -1) {
                this.addSpan("expression", eachStart, blockEnd, "{#each %}");
              } else {
                this.addSpan("expression", eachStart, eachStart + commaAt, "{#each %}");
                this.addSpan("params", eachStart + commaAt + 1, blockEnd, "{#each %}");
              }
            } else {
              this.addSpan("expression", eachStart, eachStart + asAt, "{#each %}");
              const bindingStart = asAt + 4;
              const keyAt = findTopLevel(eachText, "(", bindingStart);
              if (keyAt === -1) {
                this.addSpan("params", eachStart + bindingStart, blockEnd, "{#each %}");
              } else {
                this.addSpan("params", eachStart + bindingStart, eachStart + keyAt, "{#each %}");
                this.addSpan(
                  "expression",
                  eachStart + keyAt + 1,
                  eachStart + eachText.lastIndexOf(")"),
                  "{#each %}",
                );
              }
            }
          } else if (trimmed.startsWith("#await") === true) {
            const awaitStart = offset + 6;
            const awaited = this.source.slice(awaitStart, blockEnd);
            let splitAt = findTopLevel(awaited, " then", 0);
            let keyword = " then";
            if (splitAt === -1) {
              splitAt = findTopLevel(awaited, " catch", 0);
              keyword = " catch";
            }
            if (splitAt === -1) {
              this.addSpan("expression", awaitStart, blockEnd, "{#await %}");
            } else {
              this.addSpan("expression", awaitStart, awaitStart + splitAt, "{#await %}");
              this.addSpan("params", awaitStart + splitAt + keyword.length, blockEnd, "{#await %}");
            }
          } else if (trimmed.startsWith("#snippet") === true) {
            // `{#snippet row(item, index)}` - the parameters are the code.
            const paramsOpen = this.source.indexOf("(", offset);
            const paramsClose = this.source.lastIndexOf(")", blockEnd);
            if (paramsOpen !== -1 && paramsOpen < blockEnd && paramsClose > paramsOpen) {
              this.addSpan("params", paramsOpen + 1, paramsClose, "{#snippet %}");
            }
          } else {
            let handled = false;
            for (const block of SVELTE_BLOCKS) {
              if (trimmed.startsWith(block.prefix) === true) {
                this.addSpan(
                  block.role,
                  offset + block.prefix.length,
                  blockEnd,
                  `{${block.prefix} %}`,
                );
                handled = true;
                break;
              }
            }
            // Block markers with no code of their own: `{/if}`, `{:else}`, ...
            for (const marker of ["#", "@", ":", "/"]) {
              if (handled === false && trimmed.startsWith(marker) === true) {
                handled = true;
              }
            }
            if (handled === false) {
              this.addSpan("expression", blockStart, blockEnd, "{%}");
            }
          }
        } else if (this.source.startsWith("{{", this.index) === true) {
          this.skipPast("}}");
          this.addSpan("expression", open + 2, this.index - 2, "{{ % }}");
        } else {
          this.index += 1;
        }
        continue;
      }
      if (current !== "<") {
        this.index += 1;
        continue;
      }
      if (this.source.startsWith("<!--", this.index) === true) {
        this.skipPast("-->");
        continue;
      }
      const following = this.source[this.index + 1];
      if (following === undefined) {
        break;
      }
      if (following === "/" || following === "!" || following === "?") {
        this.skipPast(">");
        continue;
      }
      if (TAG_NAME_START.test(following) === true) {
        const tagNameStart = this.index + 1;
        let tagNameEnd = tagNameStart;
        while (
          tagNameEnd < this.source.length &&
          NAME_END_CHARS.has(this.source[tagNameEnd]!) === false
        ) {
          tagNameEnd += 1;
        }
        const tagName = this.source.slice(tagNameStart, tagNameEnd).toLowerCase();
        this.index = tagNameEnd;

        // Consume attributes through the tag's closing `>`, flagging bare ones.
        while (this.index < this.source.length) {
          this.skipWhitespace();
          const attrChar = this.source[this.index];
          if (attrChar === undefined) {
            break;
          }
          if (attrChar === ">") {
            this.index += 1;
            break;
          }
          if (attrChar === "/") {
            this.index += 1;
            continue;
          }
          if (attrChar === "{") {
            // Svelte's `{value}` / `{...rest}` shorthands name their value.
            let shorthandStart = this.index + 1;
            if (this.source.startsWith("...", shorthandStart) === true) {
              shorthandStart += 3;
            }
            this.skipBraced();
            this.addSpan("expression", shorthandStart, this.index - 1, "{%}");
            continue;
          }
          if (attrChar === "<") {
            // Malformed markup: bail rather than swallow the next tag.
            break;
          }
          const attrNameStart = this.index;
          while (
            this.index < this.source.length &&
            NAME_END_CHARS.has(this.source[this.index]!) === false
          ) {
            this.index += 1;
          }
          const attrName = this.source.slice(attrNameStart, this.index);
          if (attrName.length === 0) {
            this.index += 1;
            continue;
          }
          this.skipWhitespace();
          if (this.source[this.index] === "=") {
            this.index += 1;
            this.skipWhitespace();
            if (RAW_TEXT_TAGS.has(tagName) === true) {
              this.skipAttrValue();
              continue;
            }
            // Skip one attribute value, collecting the code it carries.
            const valueStart = this.index;
            this.skipAttrValue();
            const opener = this.source[valueStart];
            if (opener === undefined) {
              continue;
            }
            if (this.flavor === "svelte") {
              if (opener === "{") {
                let role: TemplateRole = "expression";
                if (attrName.startsWith("let:") === true) {
                  role = "params";
                }
                this.addSpan(role, valueStart + 1, this.index - 1, `${attrName}={%}`);
              } else if (QUOTE_CHARS.has(opener) === true) {
                // `class="card {size}"` - every `{...}` inside a quoted value is code.
                let cursor = valueStart + 1;
                while (cursor < this.index - 1) {
                  if (this.source[cursor] !== "{") {
                    cursor += 1;
                    continue;
                  }
                  const close = findTopLevel(this.source, "}", cursor + 1);
                  if (close === -1) {
                    break;
                  }
                  this.addSpan("expression", cursor + 1, close, `${attrName}="{%}"`);
                  cursor = close + 1;
                }
              }
              continue;
            }

            let valueCodeStart = valueStart;
            let valueCodeEnd = this.index;
            if (QUOTE_CHARS.has(opener) === true) {
              valueCodeStart += 1;
              valueCodeEnd -= 1;
            }
            const label = `${attrName}="%"`;
            if (VUE_CONDITIONS.has(attrName) === true) {
              this.addSpan("condition", valueCodeStart, valueCodeEnd, label);
            } else if (attrName === "v-for") {
              // `v-for="(item, index) in items"`: the alias is a parameter
              // list, the source an expression.
              const forText = this.source.slice(valueCodeStart, valueCodeEnd);
              let splitAt = findTopLevel(forText, " in ", 0);
              if (splitAt === -1) {
                splitAt = findTopLevel(forText, " of ", 0);
              }
              if (splitAt !== -1) {
                let aliasStart = valueCodeStart;
                let aliasEnd = valueCodeStart + splitAt;
                const alias = forText.slice(0, splitAt).trim();
                if (alias.startsWith("(") === true && alias.endsWith(")") === true) {
                  aliasStart = valueCodeStart + forText.indexOf("(") + 1;
                  aliasEnd = valueCodeStart + forText.slice(0, splitAt).lastIndexOf(")");
                }
                this.addSpan("params", aliasStart, aliasEnd, label);
                this.addSpan("expression", valueCodeStart + splitAt + 4, valueCodeEnd, label);
              }
            } else if (
              attrName.startsWith("v-slot") === true ||
              attrName.startsWith("#") === true
            ) {
              this.addSpan("params", valueCodeStart, valueCodeEnd, label);
            } else if (attrName.startsWith("@") === true || attrName.startsWith("v-on") === true) {
              this.addSpan("handler", valueCodeStart, valueCodeEnd, label);
            } else if (
              attrName.startsWith(":") === true ||
              attrName.startsWith(".") === true ||
              attrName.startsWith("v-") === true
            ) {
              this.addSpan("expression", valueCodeStart, valueCodeEnd, label);
            }
            continue;
          }
          // Directives (bind:/on:/class:/let:, v-slot:, xmlns:) are valueless
          // by design; script/style tags carry mode markers with no explicit
          // form.
          let isExempt = attrName.includes(":") === true || RAW_TEXT_TAGS.has(tagName) === true;
          if (isExempt === false && this.flavor === "vue") {
            isExempt =
              attrName.startsWith("v-") === true ||
              attrName.startsWith("@") === true ||
              attrName.startsWith("#") === true;
          }
          if (isExempt === false) {
            let attrContext = `Bare template attribute relies on the implicit-true convention - write ${attrName}={true}`;
            if (this.flavor === "vue") {
              attrContext = `Bare template attribute relies on the implicit-true convention - write :${attrName}="true"`;
            }
            const before = this.source.slice(0, attrNameStart);
            this.results.push({
              file: this.filename,
              line: before.split("\n").length,
              column: attrNameStart - before.lastIndexOf("\n") - 1,
              code: attrName,
              context: attrContext,
              checkType: CheckType.BOOL_ATTR,
            });
          }
        }

        if (RAW_TEXT_TAGS.has(tagName) === true) {
          this.skipPast(`</${tagName}`);
          this.skipPast(">");
        }
        continue;
      }
      this.index += 1;
    }
  }

  private addSpan(role: TemplateRole, start: number, end: number, label: string): void {
    const raw = this.source.slice(start, end);
    const text = raw.trim();
    if (text.length === 0) {
      return;
    }
    this.expressions.push({
      role,
      text,
      start: start + raw.length - raw.trimStart().length,
      label,
    });
  }

  private skipAttrValue(): void {
    const current = this.source[this.index];
    if (current === undefined) {
      return;
    }
    if (QUOTE_CHARS.has(current) === true) {
      this.skipQuoted(current);
      return;
    }
    if (current === "{") {
      this.skipBraced();
      return;
    }
    while (this.index < this.source.length) {
      const tokenChar = this.source[this.index]!;
      if (WHITESPACE_CHARS.has(tokenChar) === true || tokenChar === ">" || tokenChar === "/") {
        return;
      }
      this.index += 1;
    }
  }

  private skipWhitespace(): void {
    while (
      this.index < this.source.length &&
      WHITESPACE_CHARS.has(this.source[this.index]!) === true
    ) {
      this.index += 1;
    }
  }

  private skipQuoted(quote: string): void {
    this.index += 1;
    while (this.index < this.source.length) {
      const current = this.source[this.index]!;
      if (current === "\\") {
        this.index += 2;
        continue;
      }
      this.index += 1;
      if (current === quote) {
        return;
      }
    }
  }

  private skipBraced(): void {
    let depth = 0;
    while (this.index < this.source.length) {
      const current = this.source[this.index]!;
      if (QUOTE_CHARS.has(current) === true) {
        this.skipQuoted(current);
        continue;
      }
      if (current === "{") {
        depth += 1;
      }
      if (current === "}") {
        depth -= 1;
        if (depth === 0) {
          this.index += 1;
          return;
        }
      }
      this.index += 1;
    }
  }

  private skipPast(token: string): void {
    const found = this.source.indexOf(token, this.index);
    if (found === -1) {
      this.index = this.source.length;
      return;
    }
    this.index = found + token.length;
  }
}
