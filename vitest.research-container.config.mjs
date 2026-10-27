import path from 'node:path';
import {defineConfig} from 'vitest/config';
export default defineConfig({
  cacheDir:'/tmp/applypack-research-vite',
  resolve:{alias:{'@':path.resolve(import.meta.dirname,'src')}},
  test:{environment:'node',include:[process.env.AP_RESEARCH_JOURNEY_STAGE==='PAID_SEARCH'
    ?'tests/integration/verified-paid-search-native-journey.test.ts':process.env.AP_RESEARCH_JOURNEY_STAGE==='NOTIFICATION'
    ?'tests/integration/intake-notification-native-journey.test.ts':process.env.AP_RESEARCH_JOURNEY_STAGE==='CLARIFICATION'
    ?'tests/integration/material-clarification-route-journey.test.ts':'tests/integration/research-preparation-journey.test.ts'],maxWorkers:1,testTimeout:240_000},
});
