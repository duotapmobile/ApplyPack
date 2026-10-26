import { createServer, type Socket } from "node:net";
import { afterEach, expect, it } from "vitest";
import { researchLocalSql } from "../integration/research-local-postgres";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
function frame(kind: string, value: Buffer) {
  const bytes = Buffer.alloc(value.length + 5); bytes.write(kind); bytes.writeInt32BE(value.length + 4, 1); value.copy(bytes, 5); return bytes;
}
function row(values: string[]) {
  const count = Buffer.alloc(2); count.writeInt16BE(values.length);
  return frame("D", Buffer.concat([count, ...values.flatMap(value => {
    const text = Buffer.from(value), size = Buffer.alloc(4); size.writeInt32BE(text.length); return [size, text];
  })]));
}
async function fixture(reply: (socket: Socket) => void, auth = Buffer.alloc(4)) {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket));
    socket.once("data", startup => {
      expect(startup.readInt32BE(4)).toBe(196608);
      socket.write(Buffer.concat([frame("R", auth), frame("Z", Buffer.from("I"))]));
      socket.once("data", query => { expect(query[0]).toBe(81); reply(socket); });
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise(resolve => { sockets.forEach(socket => socket.destroy()); server.close(() => resolve()); }));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("fixture_address"); return address.port;
}
it("keeps a fragmented one-column JSON receipt exact", async () => {
  const port = await fixture(socket => {
    const response = Buffer.concat([row(['{"name":"José"}']), frame("Z", Buffer.from("I"))]);
    socket.write(response.subarray(0, 8)); socket.write(response.subarray(8));
  });
  await expect(researchLocalSql(port, "select receipt")).resolves.toEqual(['{"name":"José"}']);
});
it("discards composite setup rows only when explicitly requested", async () => {
  const port = await fixture(socket => socket.write(Buffer.concat([row(["first", "second"]), frame("Z", Buffer.from("I"))])));
  await expect(researchLocalSql(port, "setup", true)).resolves.toEqual([]);
  await expect(researchLocalSql(port, "receipt")).rejects.toThrow("local_pg_result_shape");
});
it("rejects password authentication instead of reading credentials", async () => {
  const auth = Buffer.alloc(4); auth.writeInt32BE(3);
  const port = await fixture(() => { throw new Error("must not send query"); }, auth);
  await expect(researchLocalSql(port, "select receipt")).rejects.toThrow("local_pg_nonfixture_authentication");
});
it.each(["G", "H", "W"])("rejects COPY mode %s", async kind => {
  const port = await fixture(socket => socket.write(frame(kind, Buffer.alloc(0))));
  await expect(researchLocalSql(port, "select receipt")).rejects.toThrow("local_pg_copy_rejected");
});
it("rejects an unfinished transaction and an unconfirmed connection close", async () => {
  const pending = await fixture(socket => socket.write(frame("Z", Buffer.from("T"))));
  await expect(researchLocalSql(pending, "begin")).rejects.toThrow("local_pg_unclosed_transaction");
  const closed = await fixture(socket => socket.end());
  await expect(researchLocalSql(closed, "select receipt")).rejects.toThrow("local_pg_unconfirmed_close");
});
it("rejects oversized and malformed frames", async () => {
  const large = await fixture(socket => { const bytes = Buffer.alloc(5); bytes.write("D"); bytes.writeInt32BE(2_000_001, 1); socket.write(bytes); });
  await expect(researchLocalSql(large, "select receipt")).rejects.toThrow("local_pg_frame_invalid");
  const malformed = await fixture(socket => socket.write(frame("D", Buffer.from([0, 1, 0, 0, 0, 5, 97]))));
  await expect(researchLocalSql(malformed, "select receipt")).rejects.toThrow("local_pg_result_length");
});
it("rejects nonfixture port and oversized statement before connecting", () => {
  expect(() => researchLocalSql(543, "select 1")).toThrow("local_pg_boundary");
  expect(() => researchLocalSql(54321, "x".repeat(1_000_001))).toThrow("local_pg_boundary");
});
