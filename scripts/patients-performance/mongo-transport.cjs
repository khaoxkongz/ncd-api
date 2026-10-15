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
      output = Buffer.alloc(0),
      replacement,
      requestHeld,
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
          held = typeof action === "object" ? action.hold !== false : true;
          lost = action === "lose";
          if (typeof action === "object" && action.reply)
            replacement = { responseTo: message.readInt32LE(4), reply: action.reply };
          release = () => {
            held = false;
            if (requestHeld) {
              upstream.write(requestHeld);
              requestHeld = null;
            }
            for (const bytes of buffered.splice(0)) downstream.write(bytes);
          };
          reached({ commandName: Object.keys(command)[0], release });
          if (action === "hold-request") {
            held = false;
            requestHeld = Buffer.from(message);
            continue;
          }
        }
        upstream.write(message);
      }
    });
    function forward(chunk) {
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
    }
    upstream.on("data", (chunk) => {
      if (!replacement) return forward(chunk);
      output = Buffer.concat([output, chunk]);
      if (output.length > 8 * 1048576) {
        failure = new Error("Fixture response buffer limit");
        stop();
        return;
      }
      while (output.length >= 4 && output.length >= output.readInt32LE(0)) {
        const size = output.readInt32LE(0);
        if (size < 21) return stop();
        let packet = output.subarray(0, size);
        output = output.subarray(size);
        if (replacement && packet.readInt32LE(8) === replacement.responseTo) {
          // Fault the real command's reply at the wire boundary. The actual
          // driver parses the error; no model collaborator is replaced.
          const bson = BSON.serialize(replacement.reply);
          const rewritten = Buffer.alloc(21 + bson.length);
          packet.copy(rewritten, 0, 0, 16);
          rewritten.writeInt32LE(rewritten.length, 0);
          rewritten.writeInt32LE(2013, 12);
          bson.copy(rewritten, 21);
          packet = rewritten;
          replacement = null;
        }
        forward(packet);
      }
    });
    const stop = () => {
      downstream.destroy();
      upstream.destroy();
      sockets.delete(downstream);
      sockets.delete(upstream);
    };
    downstream.on("error", stop);
    upstream.on("error", stop);
    downstream.on("close", () => {
      if (!requestHeld) stop();
    });
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
