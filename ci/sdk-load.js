'use strict';
// Loads the SmartSpectra SDK and its platform package in plain Node.
const os = require('os');
const sdk = require('@smartspectra/node-sdk');
const plat = `@smartspectra/node-sdk-${process.platform}-${os.arch()}`;
let platPath = null;
try { platPath = require.resolve(plat + '/package.json'); } catch (e) { platPath = 'MISSING: ' + e.message; }
console.log(JSON.stringify({ platform: process.platform, arch: os.arch(), exports: Object.keys(sdk), platformPackage: plat, platPath }, null, 1));
if (String(platPath).startsWith('MISSING')) process.exit(1);
