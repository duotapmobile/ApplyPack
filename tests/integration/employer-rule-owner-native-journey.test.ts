import { afterEach, it } from "vitest";
import { cleanupVerifiedPaidSearch, setupVerifiedPaidSearch } from "./verified-paid-search-setup";
import { employerQuestionSourceFixture } from "./employer-question-source-fixture";
import { verifyEmployerRuleOwnerJourney } from "./verified-employer-rule-owner-setup";

afterEach(cleanupVerifiedPaidSearch);

it("connects the actual paid search to permitted Greenhouse questions and ordinary owner rule confirmation", async () => {
  const fixture = employerQuestionSourceFixture();
  const graph = await setupVerifiedPaidSearch({ sourceFixture: fixture.sourceFixture });
  await verifyEmployerRuleOwnerJourney(graph, fixture);
});
