#!/usr/bin/env node

/**
 * Proves that the public endpoint is not merely accepting TCP connections: it
 * must complete a WebSocket upgrade, accept the production Origin, understand
 * this protocol version, and accept the exact client build being deployed.
 */
import WebSocket from 'ws';

const [url, origin, build, protocolArg] = process.argv.slice(2);
const protocol = Number(protocolArg);
if (!url || !origin || !build || !Number.isSafeInteger(protocol) || protocol < 1) {
  console.error('usage: node smoke.mjs <ws-url> <origin> <build-version> <protocol-version>');
  process.exit(2);
}

const timeout = setTimeout(() => fail('timed out waiting for relay welcome'), 10_000);
const socket = new WebSocket(url, { origin, perMessageDeflate: false });
let finished = false;

function finish(code, message) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  try { socket.close(); } catch { /* the failure may already have closed it */ }
  if (message) (code === 0 ? console.log : console.error)(message);
  setTimeout(() => process.exit(code), 20);
}

function fail(message) {
  finish(1, `[relay-smoke] ${message}`);
}

socket.on('open', () => {
  socket.send(JSON.stringify({ t: 'hello', protocol, build }));
});

socket.on('message', (data) => {
  let message;
  try {
    message = JSON.parse(data.toString('utf8'));
  } catch {
    fail('relay returned non-JSON data');
    return;
  }
  if (message?.t !== 'welcome' || message.protocol !== protocol) {
    fail(`unexpected relay response: ${JSON.stringify(message)}`);
    return;
  }
  finish(0, `[relay-smoke] ${url} accepted build ${build}`);
});

socket.on('unexpected-response', (_request, response) => {
  fail(`WebSocket upgrade refused with HTTP ${response.statusCode}`);
});
socket.on('error', (error) => fail(error instanceof Error ? error.message : String(error)));
socket.on('close', (code, reason) => {
  if (!finished) fail(`socket closed before welcome (${code}: ${reason.toString()})`);
});
