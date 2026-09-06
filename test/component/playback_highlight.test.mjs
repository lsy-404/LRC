import { expect, it, vi } from 'vitest';
import { mountTimingTrack, timingTrack } from './timingFixtures.mjs';
it('模拟播放推进高亮', async () => { vi.useFakeTimers(); const w=mountTimingTrack(timingTrack([{time:0,words:[[0,'甲']]},{time:1000,words:[[1000,'乙']]}])); await w.findAll('button').find((b) => b.text() === '播放').trigger('click'); vi.advanceTimersByTime(1200); await Promise.resolve(); expect(w.findAll('.eb-time-token.active').at(-1).text()).toContain('乙'); w.unmount(); vi.useRealTimers(); });
it('seek 高亮目标词', async () => { const w=mountTimingTrack(timingTrack([{time:0,words:[[0,'甲']]},{time:1000,words:[[1000,'乙']]}])); await w.get('input[aria-label="播放进度"]').setValue(1000); expect(w.findAll('.eb-time-token.active').at(-1).text()).toContain('乙'); w.unmount(); });
