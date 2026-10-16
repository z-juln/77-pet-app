import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electron = require('electron');
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(root, 'src', 'app-main.cjs')], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
