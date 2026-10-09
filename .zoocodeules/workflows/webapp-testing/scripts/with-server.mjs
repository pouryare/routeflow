#!/usr/bin/env node
/**
 * with-server.mjs — Node/ESM port of the upstream `with_server.py`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The upstream skill ships `scripts/with_server.py`, which requires the Python
 * `playwright` package. This machine has NO pip and NO ensurepip (`python3 -m
 * ensurepip` -> "No module named ensurepip"), so the Python path is unusable
 * here. But the project already depends on `playwright@^1.62` as an npm
 * package and has the chromium-1234 browser in ~/.cache/ms-playwright. So the
 * screenshot loop runs on Node, and this shim is the server-lifecycle half of
 * that swap.
 *
 * USAGE
 *   node with-server.mjs --server "npm run dev" --port 3000 -- node shoot.mjs
 *   node with-server.mjs --server "npm run dev" --port 3000 \
 *                        --server "python worker.py" --port 8000 -- node shoot.mjs
 *
 * Runs each server, waits for its port to accept a TCP connection, runs the
 * trailing command, then tears every server down (SIGTERM, escalating to
 * SIGKILL) — including on Ctrl-C, so a failed screenshot run never leaves an
 * orphan `next dev` holding the port.
 *
 * NOTE: run it from the project root. Node resolves `playwright` out of the
 * project's node_modules; launching from /tmp fails with ERR_MODULE_NOT_FOUND.
 */

import { spawn } from "node:child_process";
import net from "node:net";

function parseArgs(argv) {
  const servers = [];
  const ports = [];
  let timeout = 60;
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--") break;

    if (arg === "--server") servers.push(argv[++i]);
    else if (arg === "--port") ports.push(Number(argv[++i]));
    else if (arg === "--timeout") timeout = Number(argv[++i]);
    else throw new Error(`Unknown flag: ${arg}`);

    i++;
  }

  const command = argv.slice(i + 1);
  if (servers.length === 0) throw new Error("At least one --server is required.");
  if (servers.length !== ports.length) {
    throw new Error(`Got ${servers.length} --server but ${ports.length} --port. They must match.`);
  }
  if (command.length === 0) throw new Error("A trailing command is required after --.");

  return { servers, ports, timeout, command };
}

function waitForPort(port, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`[${label}] port ${port} never opened within ${timeoutMs / 1000}s`));
        } else {
          setTimeout(attempt, 250);
        }
      });
    };
    attempt();
  });
}

const { servers, ports, timeout, command } = parseArgs(process.argv.slice(2));
const children = [];

function shutdown(code = 0) {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      // Escalate if it ignores the polite request.
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 3000);
    }
  }
  process.exit(code);
}

for (const [index, cmd] of servers.entries()) {
  const child = spawn(cmd, { shell: true, stdio: "inherit" });
  children.push(child);
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[with-server] server ${index + 1} (${cmd}) exited early with code ${code}`);
      shutdown(code);
    }
  });
}

try {
  await Promise.all(ports.map((port, i) => waitForPort(port, timeout * 1000, `server ${i + 1}`)));
} catch (err) {
  console.error(`[with-server] ${err.message}`);
  shutdown(1);
}

const [bin, ...args] = command;
const child = spawn(bin, args, { stdio: "inherit" });
child.on("exit", (code, signal) => {
  shutdown(signal ? 1 : (code ?? 0));
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => shutdown(0));
}
