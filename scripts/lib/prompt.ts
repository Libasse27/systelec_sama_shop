import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

/** Sortie qui peut être rendue muette pendant la saisie d'un secret. */
class MutableStdout extends Writable {
  muted = false;
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    if (!this.muted) process.stdout.write(chunk);
    callback();
  }
}

export async function ask(question: string, { secret = false } = {}): Promise<string> {
  const output = new MutableStdout();
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    process.stdout.write(question);
    output.muted = secret;
    const answer = await rl.question("");
    if (secret) process.stdout.write("\n");
    // Un secret est rendu tel quel : la connexion web ne rogne pas les espaces.
    return secret ? answer : answer.trim();
  } finally {
    rl.close();
  }
}
