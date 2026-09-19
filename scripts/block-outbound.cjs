// Test harness only. Fail loudly before any outgoing transport is opened.
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
function blocked() { console.error('CONVERGE_TEST_OUTBOUND_DENIED', new Error('Transport call stack').stack); throw new Error('Test forbids outgoing network access'); }
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const first=Array.isArray(args[0])?args[0][0]:args[0];
  const socketPath=typeof first==='string'?first:first?.path;
  // tsx uses a local IPC pipe to communicate with its loader, not a network host.
  if(typeof socketPath==='string' && (socketPath.startsWith('/') || socketPath.split(String.fromCharCode(92)).slice(0,4).join('|')==='||.|pipe')) return connect.apply(this,args);
  return blocked();
};
http.request = blocked;
https.request = blocked;
globalThis.fetch = async () => blocked();
