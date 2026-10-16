import { mountStudio } from '@platform-kit/solution-studio/client';
import '@platform-kit/solution-studio/client/style.css';

mountStudio('#app', {
  title: 'LRC 工作站',
  async loadMonaco() {
    const [monaco, { default: EditorWorker }, { default: JsonWorker }] = await Promise.all([
      import('monaco-editor'),
      import('monaco-editor/esm/vs/editor/editor.worker?worker'),
      import('monaco-editor/esm/vs/language/json/json.worker?worker'),
    ]);
    self.MonacoEnvironment = { getWorker: (_, label) => (label === 'json' ? new JsonWorker() : new EditorWorker()) };
    return monaco;
  },
});
