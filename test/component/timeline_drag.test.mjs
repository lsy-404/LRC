// B.3 时间轴拖拽：单 token / 多选整体拖动、相邻标签夹紧、行边界限制、DPR 不产生二次缩放。
// 断言全部读取标记按钮的可见文本（「调整 X 的句内偏移」+ 展示的相对偏移），不碰内部状态或 CSS 类。
import { describe, expect, it } from 'vitest';
import { mountTimingTrack, timingTrack } from './timingFixtures.mjs';

// 两行歌词：第一行 你(+0) 好(+300) 世(+600)，行首 1000ms；第二行 界/哦/耶，行首 5000ms。
// 相邻词间隔 300ms、行间隔 4000ms，都远大于 10ms 的最小间隙，便于验证夹紧边界精确落在 ±10ms 处。
function buildDragTrack() { return timingTrack([{ time: 1000, words: [[1000, '你'], [1300, '好'], [1600, '世']] }, { time: 5000, words: [[5000, '界'], [5300, '哦'], [5600, '耶']] }]); }

async function mountOnDragTrack() { return mountTimingTrack(buildDragTrack()); }

function markerFor(wrapper, char) {
  return wrapper.get(`[aria-label="调整 ${char} 的句内偏移"]`);
}

function offsetMsFor(wrapper, char) {
  const label = markerFor(wrapper, char).find('span').text();
  const m = /^\+(\d+):(\d{2})\.(\d{3})$/.exec(label);
  if (!m) throw new Error(`无法解析偏移文本：${label}`);
  return Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number(m[3]);
}

function dispatchPointer(el, type, opts) {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...opts }));
}

// 单纯点击（不移动）用于 ctrl/meta 多选；真正拖动再另发一组 down/move/up。
async function clickMarker(wrapper, char, { pointerId = 1, clientX = 0, modifiers = {} } = {}) {
  const el = markerFor(wrapper, char).element;
  dispatchPointer(el, 'pointerdown', { pointerId, clientX, ...modifiers });
  await wrapper.vm.$nextTick();
  dispatchPointer(el, 'pointerup', { pointerId, clientX, ...modifiers });
  await wrapper.vm.$nextTick();
}

async function dragMarker(wrapper, char, { pointerId = 1, fromX, toX }) {
  const el = markerFor(wrapper, char).element;
  dispatchPointer(el, 'pointerdown', { pointerId, clientX: fromX });
  await wrapper.vm.$nextTick();
  dispatchPointer(el, 'pointermove', { pointerId, clientX: toX });
  await wrapper.vm.$nextTick();
  dispatchPointer(el, 'pointerup', { pointerId, clientX: toX });
  await wrapper.vm.$nextTick();
}

describe('时间轴拖拽：单 token', () => {
  it('按 TIMELINE_MS_PER_PIXEL(5ms/px) 的比例换算位移', async () => {
    const wrapper = await mountOnDragTrack();
    expect(offsetMsFor(wrapper, '好')).toBe(300);
    await dragMarker(wrapper, '好', { fromX: 0, toX: 20 }); // dx=20px -> +100ms
    expect(offsetMsFor(wrapper, '好')).toBe(400);
    wrapper.unmount();
  });

  it('拖动越界时夹紧到下一个标记前 10ms（相邻标签夹紧）', async () => {
    const wrapper = await mountOnDragTrack();
    await dragMarker(wrapper, '好', { fromX: 0, toX: 400 }); // dx=400px -> +2000ms，远超「世」
    // 世 固定在 +600ms(1600ms)，好 最多推到 1600-10=1590ms -> 相对行首 590ms
    expect(offsetMsFor(wrapper, '好')).toBe(590);
    expect(offsetMsFor(wrapper, '世')).toBe(600); // 未选中的邻居不受影响
    wrapper.unmount();
  });

  it('反向拖动越界时夹紧到上一个标记后 10ms', async () => {
    const wrapper = await mountOnDragTrack();
    await dragMarker(wrapper, '好', { fromX: 0, toX: -400 }); // dx=-400px -> -2000ms，远超「你」
    // 你 固定在 +0ms(1000ms)，好 最少退到 1000+10=1010ms -> 相对行首 10ms
    expect(offsetMsFor(wrapper, '好')).toBe(10);
    expect(offsetMsFor(wrapper, '你')).toBe(0);
    wrapper.unmount();
  });

  it('行内最后一个标记拖动越界时夹紧到下一行行首前 10ms（行边界限制）', async () => {
    const wrapper = await mountOnDragTrack();
    await dragMarker(wrapper, '世', { fromX: 0, toX: 800 }); // dx=800px -> +4000ms，远超下一行行首(5000ms)
    // 下一行「界」行首 5000ms，世 最多推到 4990ms -> 相对本行(1000ms)行首 3990ms
    expect(offsetMsFor(wrapper, '世')).toBe(3990);
    expect(offsetMsFor(wrapper, '界')).toBe(0); // 下一行未受影响
    wrapper.unmount();
  });
});

describe('时间轴拖拽：多选整体拖动', () => {
  it('Ctrl/Cmd 多选后整体拖动，选中标记保持相对间距', async () => {
    const wrapper = await mountOnDragTrack();
    await clickMarker(wrapper, '你', { pointerId: 1, clientX: 0, modifiers: { ctrlKey: true } });
    await clickMarker(wrapper, '好', { pointerId: 1, clientX: 20, modifiers: { ctrlKey: true } });
    // 再次在已选中的「好」上做一次不带修饰键的拖动，触发整体拖动
    await dragMarker(wrapper, '好', { fromX: 20, toX: 60 }); // dx=40px -> +200ms
    expect(offsetMsFor(wrapper, '你')).toBe(200);
    expect(offsetMsFor(wrapper, '好')).toBe(500); // 300 + 200，相对间距保持 300ms 不变
    expect(offsetMsFor(wrapper, '世')).toBe(600); // 未选中，不受影响
    wrapper.unmount();
  });

  it('多选整体拖动同样受未选中邻居的最小间隔约束', async () => {
    const wrapper = await mountOnDragTrack();
    await clickMarker(wrapper, '你', { pointerId: 1, clientX: 0, modifiers: { ctrlKey: true } });
    await clickMarker(wrapper, '好', { pointerId: 1, clientX: 20, modifiers: { ctrlKey: true } });
    await dragMarker(wrapper, '好', { fromX: 20, toX: 120 }); // dx=100px -> +500ms，超过「世」允许的 +290ms 上限
    expect(offsetMsFor(wrapper, '你')).toBe(290);
    expect(offsetMsFor(wrapper, '好')).toBe(590); // 590 = 1600(世) - 10 相对行首
    wrapper.unmount();
  });

  it('多选整体拖动不能把最早的标记拖到行首之前（行首地板）', async () => {
    const wrapper = await mountOnDragTrack();
    await clickMarker(wrapper, '你', { pointerId: 1, clientX: 0, modifiers: { ctrlKey: true } });
    await clickMarker(wrapper, '好', { pointerId: 1, clientX: 20, modifiers: { ctrlKey: true } });
    await dragMarker(wrapper, '好', { fromX: 20, toX: -280 }); // dx=-300px -> -1500ms，「你」不能早于行首
    expect(offsetMsFor(wrapper, '你')).toBe(0);
    expect(offsetMsFor(wrapper, '好')).toBe(300);
    wrapper.unmount();
  });
});

describe('时间轴拖拽：DPR 不产生二次缩放', () => {
  it('window.devicePixelRatio 变化不改变像素到毫秒的换算结果', async () => {
    const resultAt = async (dpr) => {
      const wrapper = await mountOnDragTrack();
      window.devicePixelRatio = dpr;
      await dragMarker(wrapper, '好', { fromX: 0, toX: 20 }); // dx=20px -> +100ms
      const value = offsetMsFor(wrapper, '好');
      wrapper.unmount();
      return value;
    };
    const atDefaultDpr = await resultAt(1);
    const atHighDpr = await resultAt(2);
    expect(atDefaultDpr).toBe(400);
    expect(atHighDpr).toBe(400); // 与 DPR=1 完全一致，证明拖拽换算没有读取/乘上 devicePixelRatio
    window.devicePixelRatio = 1;
  });
});
