/**
 * Minimal dependency-free spinner. Renders a braille frame animation to
 * stderr while `fn` runs, then clears the line. Falls back to a plain log
 * when stderr is not a TTY (e.g. piped output, CI).
 */
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const isTty = typeof process !== "undefined" && process.stderr?.isTTY;

  if (!isTty) {
    process.stderr.write(`${label}...\n`);
    return fn();
  }

  let i = 0;
  const timer = setInterval(() => {
    process.stderr.write(`\r${FRAMES[i % FRAMES.length]} ${label}`);
    i += 1;
  }, 80);

  try {
    return await fn();
  } finally {
    clearInterval(timer);
    // Clear the spinner line.
    process.stderr.write(`\r${" ".repeat(label.length + 2)}\r`);
  }
}
