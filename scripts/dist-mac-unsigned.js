'use strict';

// Cross-platform replacement for a shell env prefix. Builds an unsigned
// Apple Silicon zip. Does not print secrets.

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
delete env.ELECTRON_RUN_AS_NODE;
const shell = process.platform === 'win32';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', shell });
  if (result.status !== 0) process.exit(result.status == null ? 1 : result.status);
}

run(shell ? 'npm.cmd' : 'npm', ['run', 'build']);
run(process.execPath, [
  path.join(root, 'node_modules', 'electron-builder', 'cli.js'),
  '--mac', 'zip', '--arm64',
  '-c.mac.identity=null',
  '-c.mac.hardenedRuntime=false',
  '-c.mac.gatekeeperAssess=false',
]);
