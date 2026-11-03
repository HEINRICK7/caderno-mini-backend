import { hashAdminPassword } from './application/use-cases/admin-auth.js';
import { StringDecoder } from 'node:string_decoder';

async function readHiddenPassword(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error('Execute este comando em um terminal interativo para ocultar a senha digitada.');
  }

  process.stdout.write('Digite a senha administrativa (mínimo de 12 caracteres): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let password = '';
    const decoder = new StringDecoder('utf8');
    const finish = (error?: Error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(password);
    };
    const onData = (chunk: Buffer) => {
      for (const character of decoder.write(chunk)) {
        if (character === '\u0003') {
          finish(new Error('Operação cancelada.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          password = password.slice(0, -1);
        } else if (character >= ' ') {
          password += character;
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

try {
  const password = await readHiddenPassword();
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 1_024) {
    throw new Error('A senha precisa ter de 12 a 1024 bytes.');
  }
  process.stdout.write(`${await hashAdminPassword(password)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Não foi possível gerar o hash.'}\n`);
  process.exitCode = 1;
}
