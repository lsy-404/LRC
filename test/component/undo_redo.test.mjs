import { expect, it } from 'vitest';
import { mountTimingTrack, timingTrack } from './timingFixtures.mjs';
it('撤回和恢复保留标题历史', async () => { const w=mountTimingTrack(timingTrack([{time:1000,words:[[1000,'你']]}])); const input=w.get('input[placeholder="曲名"]'); await input.setValue('改名'); await input.trigger('blur'); await w.findAll('button')[1].trigger('click'); expect(input.element.value).toBe('轨道A'); await w.findAll('button')[2].trigger('click'); expect(input.element.value).toBe('改名'); w.unmount(); });
it('权威歌词禁用撤回与恢复', () => { const t=timingTrack([{time:1000,words:[[1000,'你']]}]); t.authoritativeLrc=true; const w=mountTimingTrack(t); expect(w.findAll('button')[1].element.disabled).toBe(true); expect(w.findAll('button')[2].element.disabled).toBe(true); w.unmount(); });
