import { sha256 } from "./identity";

export async function privateObjectMatchesChecksum(object: Blob, expectedSha256: string): Promise<boolean> {
  const bytes = new Uint8Array(await object.arrayBuffer());
  return sha256(bytes) === expectedSha256;
}
