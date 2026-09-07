import readline from "node:readline";

interface RawLabel {
  display: string;
  value: string;
}

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE_TO_END = "\x1b[K";

export interface ArrowOption {
  label: string;
  value: string;
}

export function parseRawLabels(rawLabels: readonly string[]): RawLabel[] {
  return rawLabels.map((raw) => {
    const colonIndex = raw.indexOf(":");
    if (colonIndex === -1) {
      return { display: raw, value: raw };
    }
    const display = raw.slice(0, colonIndex);
    const value = raw.slice(colonIndex + 1);
    return { display, value };
  });
}

export async function selectArrowOption(
  prompt: string,
  defaultIndex: number,
  options: readonly ArrowOption[],
): Promise<string> {
  if (options.length === 0) {
    throw new Error("selectArrowOption: пустой список опций.");
  }
  let selected = Math.max(0, Math.min(defaultIndex, options.length - 1));

  process.stderr.write(`${prompt}\n\n${HIDE_CURSOR}`);

  const render = () => {
    for (let i = 0; i < options.length; i++) {
      if (i === selected) {
        process.stderr.write(`\x1b[1m❯ ${options[i].label}\x1b[0m${CLEAR_LINE_TO_END}\n`);
      } else {
        process.stderr.write(`  ${options[i].label}${CLEAR_LINE_TO_END}\n`);
      }
    }
  };

  render();

  return new Promise((resolve, reject) => {
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin);

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKey);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(Boolean(wasRaw));
      }
      process.stderr.write(SHOW_CURSOR);
    };

    const moveCursorUp = () => {
      process.stderr.write(`\x1b[${options.length}A`);
    };

    const onKey = (_str: string, key: readline.Key) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.stderr.write("\n");
        reject(new Error("Отменено пользователем (Ctrl+C)."));
        return;
      }
      if (key.name === "up") {
        selected = (selected + options.length - 1) % options.length;
      } else if (key.name === "down") {
        selected = (selected + 1) % options.length;
      } else if (key.name === "return" || key.name === "enter" || key.name === "linefeed") {
        cleanup();
        process.stderr.write("\n");
        resolve(options[selected].value);
        return;
      } else {
        return;
      }
      moveCursorUp();
      render();
    };

    process.stdin.on("keypress", onKey);
  });
}

export interface CheckboxOption {
  label: string;
  value: string;
  locked?: boolean;
}

export async function selectCheckboxes(
  prompt: string,
  options: readonly CheckboxOption[],
): Promise<string[]> {
  if (options.length === 0) {
    return [];
  }
  const selected: number[] = options.map((option) => (option.locked ? 1 : 0));
  let cursor = 0;

  process.stderr.write(
    `${prompt}\nОтмечайте пробелом, подтвердите Enter.\n${HIDE_CURSOR}`,
  );

  const render = () => {
    for (let i = 0; i < options.length; i++) {
      let marker: string;
      if (options[i].locked) {
        marker = "[●]";
      } else if (selected[i]) {
        marker = "[x]";
      } else {
        marker = "[ ]";
      }
      if (i === cursor) {
        process.stderr.write(`\x1b[1m❯ ${marker} ${options[i].label}\x1b[0m${CLEAR_LINE_TO_END}\n`);
      } else {
        process.stderr.write(`  ${marker} ${options[i].label}${CLEAR_LINE_TO_END}\n`);
      }
    }
  };

  render();

  return new Promise((resolve, reject) => {
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin);

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKey);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(Boolean(wasRaw));
      }
      process.stderr.write(SHOW_CURSOR);
    };

    const moveCursorUp = () => {
      process.stderr.write(`\x1b[${options.length}A`);
    };

    const onKey = (_str: string, key: readline.Key) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.stderr.write("\n");
        reject(new Error("Отменено пользователем (Ctrl+C)."));
        return;
      }
      if (key.name === "up") {
        cursor = (cursor + options.length - 1) % options.length;
      } else if (key.name === "down") {
        cursor = (cursor + 1) % options.length;
      } else if (key.name === "space") {
        if (options[cursor].locked) {
          moveCursorUp();
          render();
          return;
        }
        selected[cursor] = selected[cursor] ? 0 : 1;
      } else if (key.name === "return" || key.name === "enter" || key.name === "linefeed") {
        cleanup();
        process.stderr.write("\n");
        const result: string[] = [];
        for (let i = 0; i < options.length; i++) {
          if (selected[i]) result.push(options[i].value);
        }
        resolve(result);
        return;
      } else {
        return;
      }
      moveCursorUp();
      render();
    };

    process.stdin.on("keypress", onKey);
  });
}

export async function promptForToken(
  label: string,
  instructionUrl: string | undefined,
): Promise<string> {
  process.stderr.write(`${label}\n`);
  if (instructionUrl) {
    process.stderr.write(`Где взять токен: ${instructionUrl}\n`);
  }
  process.stderr.write("Введите токен: ");

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: false,
    });

    rl.once("line", (line) => {
      rl.close();
      const value = line.replace(/\r$/, "");
      process.stderr.write("\n");
      if (!value) {
        reject(new Error("Токен не может быть пустым."));
        return;
      }
      resolve(value);
    });

    rl.once("close", () => {
      // If we get here without a 'line' event, treat as cancellation.
    });
  });
}