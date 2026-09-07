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

function rule(width = 60): string {
  return isTty() ? style(FG.gray, "─".repeat(width)) : "─".repeat(width);
}

export const print = {
  banner(title: string, subtitle?: string): void {
    process.stdout.write(`\n${rule()}\n`);
    process.stdout.write(`  ${style(BOLD + FG.cyan, title)}\n`);
    if (subtitle) {
      process.stdout.write(`  ${style(FG.gray, subtitle)}\n`);
    }
    process.stdout.write(`${rule()}\n\n`);
  },

  section(title: string): void {
    process.stdout.write(`\n${style(BOLD, "▶ " + title)}\n`);
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
};