const net = require("node:net");
const { once } = require("node:events");
const { BSON } = require("mongodb");

// A real local wire transport, used to hold or lose responses from the fixture
// MongoDB server. No repository/Reader method is replaced by a test double.
async function openTransport() {
  const uri = new URL(process.env.PATIENTS_TEST_MONGO_URI);
  if (uri.hostname !== "127.0.0.1" || uri.username || uri.password || uri.pathname !== "/")
    throw new Error("Only the explicit loopback fixture transport is allowed");
  const sockets = new Set();
  let rule, reached, release, failure;
  function arm(predicate, action = "hold") {
    if (rule) throw new Error("A transport barrier is already armed");
    const promise = new Promise((resolve) => {
      reached = resolve;
    });
    rule = { predicate, action };
    return promise;
  }
  const server = net.createServer((downstream) => {
    const upstream = net.connect(Number(uri.port), "127.0.0.1");
    sockets.add(downstream);
    sockets.add(upstream);
    let input = Buffer.alloc(0),
      held = false,
      lost = false;
    const buffered = [];
    downstream.on("data", (chunk) => {
      input = Buffer.concat([input, chunk]);
      if (input.length > 8 * 1048576) {
        failure = new Error("Fixture transport buffer limit");
        downstream.destroy();
        upstream.destroy();
        return;
      }
      while (input.length >= 4 && input.length >= input.readInt32LE(0)) {
        const size = input.readInt32LE(0);
        if (size < 21) {
          downstream.destroy();
          upstream.destroy();
          return;
        }
        const message = input.subarray(0, size);
        input = input.subarray(size);
        let command;
        if (message.readInt32LE(12) === 2013 && message[20] === 0)
          command = BSON.deserialize(message.subarray(21, 21 + message.readInt32LE(21)));
        if (rule && command && rule.predicate(command)) {
          const action = rule.action;
          rule = null;
          held = true;
          lost = action === "lose";
          release = () => {
            held = false;
            for (const bytes of buffered.splice(0)) downstream.write(bytes);
          };
          reached({ commandName: Object.keys(command)[0], release });
        }
        upstream.write(message);
      }
    });
    upstream.on("data", (chunk) => {
      if (lost) {
        downstream.destroy();
        upstream.destroy();
        return;
      }
      if (held) {
        buffered.push(Buffer.from(chunk));
        if (buffered.reduce((bytes, part) => bytes + part.length, 0) > 8 * 1048576) {
          failure = new Error("Fixture response buffer limit");
          stop();
        }
      } else downstream.write(chunk);
    });
    const stop = () => {
      downstream.destroy();
      upstream.destroy();
      sockets.delete(downstream);
      sockets.delete(upstream);
    };
    downstream.on("error", stop);
    upstream.on("error", stop);
    downstream.on("close", stop);
    upstream.on("close", stop);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    uri: `mongodb://127.0.0.1:${server.address().port}/?directConnection=true`,
    arm,
    release() {
      release?.();
      if (failure) throw failure;
    },
    async close() {
      release?.();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { openTransport };
