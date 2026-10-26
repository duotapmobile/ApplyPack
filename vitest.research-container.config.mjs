import path from 'node:path';
import {defineConfig} from 'vitest/config';
export default defineConfig({
  cacheDir:'/tmp/applypack-research-vite',
  resolve:{alias:{'@':path.resolve(import.meta.dirname,'src')}},
  test:{environment:'node',include:['tests/integration/research-preparation-journey.test.ts'],maxWorkers:1,testTimeout:240_000},
});
