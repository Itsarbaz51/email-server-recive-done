#!/usr/bin/env node

import net from "net";
import minimist from "minimist";

// Command line args for port and host
const args = minimist(process.argv.slice(2));
const port = args.port || 2525;
const host = args.host || "127.0.0.1";

const socket = net.connect(port, host, () => {
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});

socket.on("error", (err) => {
  console.error("Relay connection error:", err.message);
  process.exit(1);
});
