// 契约级断言辅助：只判断"组件用了什么"，不钉死具体写法（属性顺序、CSS、v-show/v-if 选择）。
// 目的是让工作站测试在重构组件内部实现时保持稳定，只在真正的对外契约变化时才失败。

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 在源码中查找形如 `name(...)` 的调用，返回括号内完整内容（支持嵌套括号），找不到返回空字符串。
function extractCallArgs(source, name) {
  const marker = `${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  let depth = 0;
  let i = start + marker.length - 1;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  return source.slice(start + marker.length, Math.max(start + marker.length, i - 1));
}

// 组件是否在模板中被挂载（标签使用），不关心传了哪些 prop 或用 v-if 还是 v-show。
export function hasComponent(source, name) {
  return new RegExp(`<${escapeRegExp(name)}(?:[\\s/>])`).test(source);
}

// mountsChild 是 hasComponent 的语义别名，用在"外壳挂载了哪个子视图"这类场景。
export const mountsChild = hasComponent;

// 组件是否从指定路径导入了目标名称，不关心具体是默认导入还是解构写法之外的花样。
export function hasImport(source, name, path) {
  const re = new RegExp(`import\\s+${escapeRegExp(name)}\\s+from\\s+['"\`]${escapeRegExp(path)}['"\`]`);
  return re.test(source);
}

// defineProps 中是否声明了某个 prop，兼容对象写法 `{ name: { type... } }` 和数组写法 `['name']`。
export function hasProp(source, name) {
  const block = extractCallArgs(source, 'defineProps');
  if (!block) return false;
  if (/^\s*\[/.test(block)) return new RegExp(`['"\`]${escapeRegExp(name)}['"\`]`).test(block);
  return new RegExp(`(^|[{,\\s])${escapeRegExp(name)}\\s*:`).test(block);
}

// 组件是否声明或触发了某个 emit 事件：defineEmits 列表，或直接调用 emit()/$emit()。
export function hasEmit(source, name) {
  const block = extractCallArgs(source, 'defineEmits');
  if (block && new RegExp(`['"\`]${escapeRegExp(name)}['"\`]`).test(block)) return true;
  const callRe = new RegExp(`\\$?emit\\(\\s*['"\`]${escapeRegExp(name)}['"\`]`);
  return callRe.test(source);
}
