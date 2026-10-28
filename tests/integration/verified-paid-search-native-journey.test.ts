import { afterEach, it } from "vitest";
import { cleanupVerifiedPaidSearch, setupVerifiedPaidSearch } from "./verified-paid-search-setup";

afterEach(cleanupVerifiedPaidSearch);

it("connects verified v4 intake, reviewed research and its reserved invitation to search payment and exact-ten release", async () => {
  await setupVerifiedPaidSearch();
});
