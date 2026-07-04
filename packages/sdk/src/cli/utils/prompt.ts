/**
 * Minimal dependency-free masked prompt for `suwappu auth`.
 */
import readline from "node:readline";

export function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Node has no built-in masked input; override the internal write hook to
    // render an asterisk per keystroke instead of echoing the real character.
    const internal = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
    internal._writeToOutput = (chunk: string) => {
      if (chunk === question || chunk.includes("\n")) {
        internal.output.write(chunk);
      } else {
        internal.output.write("*".repeat(chunk.length));
      }
    };

    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}
