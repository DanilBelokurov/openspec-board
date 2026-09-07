const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

const FG = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const isTty = (): boolean => Boolean(process.stderr.isTTY);

function style(code: string, text: string): string {
  return isTty() ? `${code}${text}${RESET}` : text;
}

const RULE_WIDTH = 64;
const RULE_LIGHT = "─";
const RULE_HEAVY = "═";

function lightRule(width: number = RULE_WIDTH): string {
  return style(FG.gray, RULE_LIGHT.repeat(width));
}

function heavyRule(width: number = RULE_WIDTH): string {
  return style(FG.cyan, RULE_HEAVY.repeat(width));
}

export const print = {
  banner(title: string, subtitle?: string): void {
    process.stdout.write(`\n${heavyRule()}\n`);
    process.stdout.write(`  ${style(BOLD + FG.cyan, title)}\n`);
    if (subtitle) {
      process.stdout.write(`  ${style(FG.gray, subtitle)}\n`);
    }
    process.stdout.write(`${heavyRule()}\n\n`);
  },

  section(glyph: string, title: string): void {
    process.stdout.write(`\n${heavyRule()}\n`);
    process.stdout.write(
      `  ${style(FG.cyan, glyph + " ")} ${style(BOLD, title)}\n`,
    );
    process.stdout.write(`${heavyRule()}\n`);
  },

  subsection(title: string): void {
    process.stdout.write(`\n${style(BOLD, "▸ " + title)}\n`);
    process.stdout.write(`${lightRule(40)}\n`);
  },

  step(message: string): void {
    process.stdout.write(`  ${style(FG.magenta, "→")} ${message}\n`);
  },

  info(message: string): void {
    process.stdout.write(`  ${style(FG.cyan, "ℹ")} ${message}\n`);
  },

  success(message: string): void {
    process.stdout.write(`  ${style(FG.green, "✓")} ${message}\n`);
  },

  warn(message: string): void {
    process.stderr.write(`  ${style(FG.yellow, "⚠")} ${message}\n`);
  },

  error(message: string): void {
    process.stderr.write(`  ${style(FG.red, "✗")} ${message}\n`);
  },

  dim(message: string): void {
    process.stdout.write(`  ${style(FG.gray, message)}\n`);
  },

  note(message: string): void {
    process.stdout.write(`    ${style(FG.gray, message)}\n`);
  },

  blank(): void {
    process.stdout.write("\n");
  },

  raw(message: string): void {
    process.stdout.write(message);
  },

  // Heavy closing rule for prompt dialogs.
  closingRule(): void {
    process.stdout.write(`${heavyRule()}\n\n`);
  },

  // Bordered card for shell-command snippets. Title is rendered inside
  // the top border; lines are padded to a fixed inner width.
  card(title: string, lines: readonly string[], width: number = 60): void {
    const innerWidth = width - 4; // "│ " + content + " │"
    const titleSegment = ` ${title} `;
    const dashesAvailable = Math.max(0, width - 2 /* corners */ - titleSegment.length - 2 /* dashes around title */);
    const leftDashes = Math.floor(dashesAvailable / 2);
    const rightDashes = dashesAvailable - leftDashes;
    const topBar =
      "┌─" + titleSegment + "─".repeat(leftDashes) + (rightDashes > 0 ? "─".repeat(rightDashes) : "") + "┐";
    process.stdout.write(`  ${style(FG.cyan, topBar)}\n`);
    for (const line of lines) {
      const padded =
        line.length >= innerWidth
          ? line.slice(0, innerWidth)
          : line + " ".repeat(innerWidth - line.length);
      process.stdout.write(`  ${style(FG.cyan, "│")} ${padded} ${style(FG.cyan, "│")}\n`);
    }
    process.stdout.write(`  ${style(FG.cyan, "└" + "─".repeat(width - 2) + "┘")}\n`);
  },
};