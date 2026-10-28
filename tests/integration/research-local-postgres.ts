// Minimal simple-query transport for the disposable trust-authenticated fixture.
// Fixed loopback only; rejects password auth, COPY and oversized responses.
import { createConnection } from "node:net";
export function researchLocalSql(port: number, statement: string, discardResults = false): Promise<string[]> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || Buffer.byteLength(statement) > 1_000_000) throw new Error("local_pg_boundary");
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let pending = Buffer.alloc(0), started = false, settled = false, received = 0;
    const rows: string[] = [];
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); if (error) reject(error); else resolve(rows); };
    const timer = setTimeout(() => finish(new Error("local_pg_timeout")), 15_000);
    socket.on("error", error => finish(error)); socket.on("end", () => finish(new Error("local_pg_unconfirmed_close")));
    socket.on("connect", () => {
      const values = Buffer.from("user\0postgres\0database\0postgres\0application_name\0applypack_research_fixture\0\0");
      const message = Buffer.alloc(values.length + 8); message.writeInt32BE(message.length); message.writeInt32BE(196608, 4); values.copy(message, 8); socket.write(message);
    });
    socket.on("data", incoming => {
      try {
        received += incoming.length; if (received > 2_000_000) throw new Error("local_pg_response_bound");
        pending = Buffer.concat([pending, incoming]);
        while (pending.length >= 5) {
          const kind = String.fromCharCode(pending[0]), length = pending.readInt32BE(1);
          if (length < 4 || length > 2_000_000) throw new Error("local_pg_frame_invalid");
          if (pending.length < length + 1) break;
          const value = pending.subarray(5, length + 1); pending = pending.subarray(length + 1);
          if (kind === "R" && (value.length !== 4 || value.readInt32BE(0) !== 0)) throw new Error("local_pg_nonfixture_authentication");
          if (["G", "H", "W"].includes(kind)) throw new Error("local_pg_copy_rejected");
          if (kind === "E") {
            const parts = value.toString("utf8").split("\0"); const message = parts.find(part => part.startsWith("M"))?.slice(1) ?? "local_pg_error";
            const code = parts.find(part => part.startsWith("C"))?.slice(1);
            throw Object.assign(new Error(message), { code: /^[A-Z0-9]{5}$/u.test(code || "") ? code : "LOCAL_PG_ERROR" });
          }
          if (kind === "D") {
            if (value.length < 2) throw new Error("local_pg_result_shape");
            const count = value.readInt16BE(0); let offset = 2;
            if (count < 0 || (!discardResults && count !== 1)) throw new Error("local_pg_result_shape");
            for (let column = 0; column < count; column++) {
              if (value.length - offset < 4) throw new Error("local_pg_result_length");
              const size = value.readInt32BE(offset); offset += 4;
              if (size < -1 || size > value.length - offset) throw new Error("local_pg_result_length");
              if (!discardResults) rows.push(size === -1 ? "null" : value.subarray(offset, offset + size).toString("utf8"));
              if (size >= 0) offset += size;
            }
            if (offset !== value.length) throw new Error("local_pg_result_length");
          }
          if (kind === "Z") {
            if (value.length !== 1 || value[0] !== 73) throw new Error("local_pg_unclosed_transaction");
            if (started) { finish(); return; }
            started = true; const text = Buffer.from(`${statement}\0`), query = Buffer.alloc(text.length + 5);
            query[0] = 81; query.writeInt32BE(text.length + 4, 1); text.copy(query, 5); socket.write(query);
          }
        }
      } catch (error) { finish(error instanceof Error ? error : new Error("local_pg_failure")); }
    });
  });
}
