/**
 * Bare-attribute scan for Svelte and Vue component markup.
 *
 * `<Widget active />` relies on the framework convention that a bare attribute
 * means true (Svelte passes `true`; Vue passes an empty string that Boolean
 * props coerce to true). The explicit forms — `active={true}` in Svelte,
 * `:active="true"` in Vue — state the value, so this scan flags every
 * valueless attribute in the markup. `<script>`/`<style>` blocks are skipped:
 * scripts are analyzed as code, and their own tags carry mode markers
 * (`setup`, `scoped`) that have no explicit form.
 *
 * This is a tag scan, not a full template parse, in the same spirit as the
 * script extractors. Framework directives that are legitimately valueless are
 * exempt: names containing ':' (bind:/on:/class:/let: and friends), and for
 * Vue the 'v-' directives (v-else, v-once, ...) plus the '@'/'#' shorthands.
 * Brace expressions are skipped with depth counting, so Svelte's `{value}` /
 * `{...rest}` shorthands and `{#if a < b}` blocks never read as tags; markup
 * broken enough to defeat the scan degrades to missed flags, never false ones.
 */

import { CheckType, type StyleCheck } from "./constructs.ts";

export type MarkupFlavor = "svelte" | "vue";

const TAG_NAME_START = /[A-Za-z]/;
const NAME_END_CHARS: ReadonlySet<string> = new Set([" ", "\t", "\n", "\r", "=", "/", ">"]);
const WHITESPACE_CHARS: ReadonlySet<string> = new Set([" ", "\t", "\n", "\r"]);
const QUOTE_CHARS: ReadonlySet<string> = new Set(['"', "'", "`"]);
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(["script", "style"]);

export function findBareMarkupAttrs(
  source: string,
  filename: string,
  flavor: MarkupFlavor,
): StyleCheck[] {
  return new MarkupScanner(source, filename, flavor).scan();
}

class MarkupScanner {
  private readonly source: string;
  private readonly filename: string;
  private readonly flavor: MarkupFlavor;
  private readonly results: StyleCheck[] = [];
  private index = 0;

  constructor(source: string, filename: string, flavor: MarkupFlavor) {
    this.source = source;
    this.filename = filename;
    this.flavor = flavor;
  }

  scan(): StyleCheck[] {
    while (this.index < this.source.length) {
      const current = this.source[this.index]!;
      if (current === "{") {
        this.skipBraced();
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
        this.scanTag();
        continue;
      }
      this.index += 1;
    }
    return this.results;
  }

  private scanTag(): void {
    const nameStart = this.index + 1;
    let nameEnd = nameStart;
    while (nameEnd < this.source.length && NAME_END_CHARS.has(this.source[nameEnd]!) === false) {
      nameEnd += 1;
    }
    const tagName = this.source.slice(nameStart, nameEnd).toLowerCase();
    this.index = nameEnd;
    this.scanAttributes(tagName);
    if (RAW_TEXT_TAGS.has(tagName) === true) {
      this.skipPast(`</${tagName}`);
      this.skipPast(">");
    }
  }

  /** Consumes attributes through the tag's closing `>`, flagging bare ones. */
  private scanAttributes(tagName: string): void {
    while (this.index < this.source.length) {
      this.skipWhitespace();
      const current = this.source[this.index];
      if (current === undefined) {
        return;
      }
      if (current === ">") {
        this.index += 1;
        return;
      }
      if (current === "/") {
        this.index += 1;
        continue;
      }
      if (current === "{") {
        // Svelte's `{value}` / `{...rest}` shorthands name their value.
        this.skipBraced();
        continue;
      }
      if (current === "<") {
        // Malformed markup: bail rather than swallow the next tag.
        return;
      }
      const nameStart = this.index;
      while (
        this.index < this.source.length &&
        NAME_END_CHARS.has(this.source[this.index]!) === false
      ) {
        this.index += 1;
      }
      const name = this.source.slice(nameStart, this.index);
      if (name.length === 0) {
        this.index += 1;
        continue;
      }
      this.skipWhitespace();
      if (this.source[this.index] === "=") {
        this.index += 1;
        this.skipWhitespace();
        this.skipAttrValue();
        continue;
      }
      if (this.isExemptName(name, tagName) === false) {
        this.record(name, nameStart);
      }
    }
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

  private isExemptName(name: string, tagName: string): boolean {
    // Directives (bind:/on:/class:/let:, v-slot:, xmlns:) are valueless by
    // design; script/style tags carry mode markers with no explicit form.
    if (name.includes(":") === true || RAW_TEXT_TAGS.has(tagName) === true) {
      return true;
    }
    if (this.flavor === "vue") {
      return (
        name.startsWith("v-") === true ||
        name.startsWith("@") === true ||
        name.startsWith("#") === true
      );
    }
    return false;
  }

  private record(name: string, at: number): void {
    let context = `Bare template attribute relies on the implicit-true convention - write ${name}={true}`;
    if (this.flavor === "vue") {
      context = `Bare template attribute relies on the implicit-true convention - write :${name}="true"`;
    }
    const before = this.source.slice(0, at);
    this.results.push({
      file: this.filename,
      line: before.split("\n").length,
      column: at - before.lastIndexOf("\n") - 1,
      code: name,
      context,
      checkType: CheckType.BOOL_ATTR,
    });
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
