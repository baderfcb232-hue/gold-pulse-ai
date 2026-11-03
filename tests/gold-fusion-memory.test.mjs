import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('repeated GOLD FUSION analysis stays below the 512 MiB service memory budget', () => {
  // A separate process measures native ICU allocations as well as the JS heap.
  // No forced GC: the regression exhausted native memory before V8 noticed.
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {analyzeGoldFusion} from './strategies/gold-fusion.mjs';
    import {fixture,NOW} from './tests/fixtures.mjs';
    import {cleanSnapshot} from './engine.mjs';
    const snapshot=cleanSnapshot(fixture(),NOW);
    let peak=0;
    for(let i=0;i<200;i++) {
      const analysis=analyzeGoldFusion(snapshot,NOW);
      if(analysis.strategy!=='NABD-GOLD-REGIME-FUSION-V1')throw Error('No FUSION analysis');
      peak=Math.max(peak,process.memoryUsage().rss);
      // Stop the old implementation before it can exhaust the test host.
      if(peak>256*1024*1024)break;
    }
    console.log(JSON.stringify({peak}));
  `], {cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 30000});
  const {peak} = JSON.parse(result.trim());
  assert.ok(peak < 256 * 1024 * 1024, `GOLD FUSION native RSS grew to ${Math.round(peak / 1048576)} MiB`);
});
