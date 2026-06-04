/**
 * Formats collected `StyleCheck`s into text / json / csv, plus a statistics-only
 * report.
 */

import { CheckType, Colors, ReportFormat, type StyleCheck } from "./constructs.ts";

const TYPE_COLORS: Record<string, string> = {
  [CheckType.IF]: Colors.YELLOW,
  [CheckType.WHILE]: Colors.YELLOW,
  [CheckType.ASSERT]: Colors.RED,
  [CheckType.TERNARY]: Colors.CYAN,
  [CheckType.OPTIONAL_CHAIN]: Colors.MAGENTA,
  [CheckType.BOOL_OP]: Colors.BLUE,
  [CheckType.ARROW]: Colors.CYAN,
  [CheckType.FILTER]: Colors.BLUE,
  [CheckType.LOOSE_EQUALITY]: Colors.MAGENTA,
  [CheckType.SINGLE_LETTER_VAR]: Colors.RED,
  [CheckType.SINGLE_USE_VAR]: Colors.GREEN,
  [CheckType.SINGLE_USE_FUNC]: Colors.GREEN,
};

function typeColor(checkType: string): string {
  return TYPE_COLORS[checkType] ?? Colors.WHITE;
}

function sortByFileLine(left: StyleCheck, right: StyleCheck): number {
  if (left.file !== right.file) {
    if (left.file < right.file) {
      return -1;
    }
    return 1;
  }
  return left.line - right.line;
}

function byCountDescending(
  left: [string, number],
  right: [string, number],
): number {
  return right[1] - left[1];
}

function csvField(value: string): string {
  if (/[",\n]/.test(value) === true) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function padEnd(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }
  return value + " ".repeat(width - value.length);
}

export function formatReport(
  checks: StyleCheck[],
  formatType: ReportFormat = ReportFormat.TEXT,
): string {
  switch (formatType) {
    case ReportFormat.JSON:
      return formatJson(checks);
    case ReportFormat.CSV:
      return formatCsv(checks);
    case ReportFormat.TEXT:
      return formatText(checks);
    default:
      throw new Error(`Unknown report format: ${String(formatType)}`);
  }
}

function formatJson(checks: StyleCheck[]): string {
  return JSON.stringify(
    checks.map((check) => ({
      file: check.file,
      line: check.line,
      column: check.column,
      code: check.code,
      context: check.context,
      check_type: check.checkType,
    })),
    null,
    2,
  );
}

function formatCsv(checks: StyleCheck[]): string {
  const rows: string[] = ["File,Line,Column,Type,Code,Context"];
  for (const check of checks) {
    rows.push(
      [
        csvField(check.file),
        String(check.line),
        String(check.column),
        csvField(check.checkType),
        csvField(check.code),
        csvField(check.context),
      ].join(","),
    );
  }
  return rows.join("\n") + "\n";
}

function formatText(checks: StyleCheck[]): string {
  if (checks.length === 0) {
    return Colors.paint(Colors.GREEN, "✓ No style violations found.");
  }

  const output: string[] = [];
  output.push(
    "\n" +
      Colors.paint(
        Colors.BOLD + Colors.RED,
        `Found ${checks.length} style violation(s):`,
      ) +
      "\n",
  );
  output.push(Colors.paint(Colors.GRAY, "─".repeat(80)));

  let currentFile: string | undefined = undefined;
  for (const check of [...checks].sort(sortByFileLine)) {
    if (check.file !== currentFile) {
      currentFile = check.file;
      output.push("\n" + Colors.paint(Colors.BOLD + Colors.BLUE, `📄 ${check.file}`));
    }
    output.push(
      "  " +
        Colors.paint(Colors.GRAY, "Line ") +
        Colors.paint(Colors.BOLD, String(check.line)) +
        Colors.paint(Colors.GRAY, ":") +
        String(check.column) +
        " " +
        Colors.paint(typeColor(check.checkType), `[${check.checkType}]`),
    );
    output.push(
      "    " +
        Colors.paint(Colors.DIM, "Code:") +
        " " +
        Colors.paint(Colors.WHITE, check.code),
    );
    output.push("    " + Colors.paint(Colors.DIM, "Context:") + " " + check.context);
    output.push("");
  }

  output.push(Colors.paint(Colors.GRAY, "─".repeat(80)));
  output.push("\n" + Colors.paint(Colors.BOLD + Colors.CYAN, "📊 Statistics:"));
  const counts = countByType(checks);
  for (const checkType of [...counts.keys()].sort()) {
    output.push(
      "  " +
        Colors.paint(typeColor(checkType), padEnd(checkType, 20)) +
        " " +
        Colors.paint(Colors.BOLD, String(counts.get(checkType))),
    );
  }

  return output.join("\n");
}

export function generateStatisticsReport(
  checks: StyleCheck[],
  fileCount: number,
): string {
  const output: string[] = [];
  output.push("\n" + Colors.paint(Colors.BOLD + Colors.CYAN, "📊 Check Statistics"));
  output.push(Colors.paint(Colors.GRAY, "═".repeat(50)));
  output.push(
    Colors.paint(Colors.BOLD, "Total files analyzed:") +
      " " +
      Colors.paint(Colors.BLUE, String(fileCount)),
  );

  if (checks.length === 0) {
    output.push(
      Colors.paint(Colors.BOLD, "Total checks found:") +
        " " +
        Colors.paint(Colors.GREEN, "0") +
        " " +
        Colors.paint(Colors.GREEN, "✓"),
    );
  } else {
    output.push(
      Colors.paint(Colors.BOLD, "Total checks found:") +
        " " +
        Colors.paint(Colors.RED, String(checks.length)),
    );
  }
  output.push("");

  if (checks.length > 0) {
    output.push(Colors.paint(Colors.BOLD, "By type:"));
    for (const [checkType, count] of [...countByType(checks).entries()].sort(
      byCountDescending,
    )) {
      const percentage = (count / checks.length) * 100;
      output.push(
        "  " +
          Colors.paint(typeColor(checkType), padEnd(checkType, 20)) +
          " " +
          Colors.paint(Colors.BOLD, String(count).padStart(5)) +
          " " +
          Colors.paint(Colors.GRAY, `(${percentage.toFixed(1).padStart(5)}%)`) +
          " " +
          Colors.paint(typeColor(checkType), "█".repeat(Math.floor(percentage / 2))),
      );
    }
  }

  return output.join("\n");
}

function countByType(checks: StyleCheck[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const check of checks) {
    counts.set(check.checkType, (counts.get(check.checkType) ?? 0) + 1);
  }
  return counts;
}
