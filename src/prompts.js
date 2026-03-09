import { createInterface } from "node:readline";

function createRL() {
  return createInterface({
    input: process.stdin,
    output: process.stderr, // prompts go to stderr so stdout stays clean for --dry-run
  });
}

/**
 * Prompt for a single line of input.
 */
export function prompt(question) {
  return new Promise((resolve) => {
    const rl = createRL();
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt for a password (no echo — uses raw mode if available).
 */
export function promptPassword(question) {
  return new Promise((resolve) => {
    const rl = createRL();
    if (process.stdin.isTTY) {
      process.stderr.write(question);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      let password = "";
      const onData = (ch) => {
        const c = ch.toString("utf8");
        if (c === "\n" || c === "\r" || c === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stderr.write("\n");
          rl.close();
          resolve(password);
        } else if (c === "\u0003") {
          // Ctrl+C
          process.exit(1);
        } else if (c === "\u007f" || c === "\b") {
          // Backspace
          password = password.slice(0, -1);
        } else {
          password += c;
        }
      };
      process.stdin.on("data", onData);
    } else {
      // Non-TTY fallback — plain text input
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

/**
 * Prompt the user to select from a numbered list, or create new.
 * Returns the selected item or null for "create new".
 */
export async function promptSelect(items, labelFn, createLabel = "Create new ruleset") {
  console.error("\nAvailable rulesets:");
  items.forEach((item, i) => {
    console.error(`  ${i + 1}. ${labelFn(item)}`);
  });
  console.error(`  ${items.length + 1}. ${createLabel}`);

  const answer = await prompt(`\nSelect (1-${items.length + 1}): `);
  const idx = parseInt(answer, 10) - 1;

  if (idx === items.length) return null; // create new
  if (idx >= 0 && idx < items.length) return items[idx];

  console.error("Invalid selection.");
  return promptSelect(items, labelFn, createLabel);
}
