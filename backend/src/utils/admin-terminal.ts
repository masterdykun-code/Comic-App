import { emitKeypressEvents, type Key } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import type { ReadStream, WriteStream } from 'node:tty';
import type { AdminTerminal } from '../types/admin-bootstrap.types';
import { AdminBootstrapError } from './admin-bootstrap-error';

export function readHidden(input: ReadStream, output: Pick<WriteStream, 'write'>, label: string): Promise<string> {
  if (!input.isTTY) return Promise.reject(new AdminBootstrapError('LOCAL_TERMINAL_REQUIRED'));
  return new Promise((resolve, reject) => {
    let value = '';
    const originalRaw = input.isRaw;
    const wasPaused = input.isPaused();
    let finished = false;
    const end = (error?: AdminBootstrapError) => {
      if (finished) return;
      finished = true;
      input.removeListener('keypress', keypress); input.removeListener('end', cancelled); input.removeListener('error', cancelled);
      input.setRawMode(originalRaw);
      if (wasPaused) input.pause();
      output.write('\n');
      const result = value; value = '';
      if (error) reject(error); else resolve(result);
    };
    const cancelled = () => end(new AdminBootstrapError('CANCELLED'));
    const keypress = (text: string | undefined, key: Key = {}) => {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) { cancelled(); return; }
      if (key.name === 'return' || key.name === 'enter') { end(); return; }
      if (key.name === 'backspace') { value = Array.from(value).slice(0, -1).join(''); return; }
      if (key.ctrl || key.meta || !text || /[\x00-\x1f\x7f-\x9f]/.test(text)) return;
      if (value.length + text.length > 128) { end(new AdminBootstrapError('INVALID_INPUT')); return; }
      value += text; // Intentionally no echo, even masking characters.
    };
    emitKeypressEvents(input);
    input.on('keypress', keypress); input.once('end', cancelled); input.once('error', cancelled);
    input.setRawMode(true); output.write(label); input.resume();
  });
}

export function createLocalAdminTerminal(): AdminTerminal {
  const input = process.stdin; const output = process.stdout;
  return {
    assertInteractive() {
      if (!input.isTTY || !output.isTTY || process.env.CI || process.argv.length > 2) {
        throw new AdminBootstrapError('LOCAL_TERMINAL_REQUIRED');
      }
    },
    async ask(label) {
      const rl = createInterface({ input, output, terminal: true, historySize: 0 });
      const abort = new AbortController();
      rl.once('SIGINT', () => abort.abort()); rl.once('close', () => abort.abort());
      try { return await rl.question(label, { signal: abort.signal }); }
      catch { throw new AdminBootstrapError('CANCELLED'); }
      finally { rl.close(); }
    },
    secret(label) { return readHidden(input, output, label); },
    write(message) { output.write(message + '\n'); },
    close() { if (input.isTTY && input.isRaw) input.setRawMode(false); input.pause(); },
  };
}
