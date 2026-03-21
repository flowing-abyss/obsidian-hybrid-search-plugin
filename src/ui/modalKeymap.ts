import { App, TFile } from 'obsidian';
import type { SearchResult } from '../ipc';
import type { HybridSearchSettings } from '../settings';
import type { SearchModal } from './SearchModal';

export function registerModalKeymap(
  modal: SearchModal,
  app: App,
  settings: HybridSearchSettings,
  saveSettings: () => Promise<void>,
): void {
  // Mod = Cmd on macOS, Ctrl on Windows/Linux

  modal.scope.register(['Mod'], 'j', (evt: KeyboardEvent) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const chooser = (modal as any).chooser;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const values = (chooser?.values ?? []) as unknown[];
    if (values.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const idx = (chooser?.selectedItem ?? 0) as number;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    chooser?.setSelectedItem(Math.min(idx + 1, values.length - 1), evt);
  });

  modal.scope.register(['Mod'], 'k', (evt: KeyboardEvent) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const chooser = (modal as any).chooser;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const values = (chooser?.values ?? []) as unknown[];
    if (values.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const idx = (chooser?.selectedItem ?? 0) as number;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    chooser?.setSelectedItem(Math.max(idx - 1, 0), evt);
  });

  modal.scope.register(['Mod'], 'h', (_evt: KeyboardEvent) => {
    settings.showPreview = !settings.showPreview;
    void saveSettings();
    if (!settings.showPreview) {
      modal.hidePreviewPanel();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const chooser = (modal as any).chooser;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const selected = chooser?.values?.[chooser?.selectedItem] as SearchResult | undefined;
      if (selected) modal.triggerPreview(selected.path.normalize('NFC'));
    }
  });

  modal.scope.register(['Mod'], 'l', (_evt: KeyboardEvent) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const chooser = (modal as any).chooser;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const result = chooser?.values?.[chooser?.selectedItem] as SearchResult | undefined;
    if (!result) return;
    const file = app.vault.getAbstractFileByPath(result.path.normalize('NFC'));
    if (file instanceof TFile) {
      // @ts-ignore — 'tab' is a valid PaneType in modern Obsidian
      void app.workspace.getLeaf('tab').openFile(file);
    }
  });

  modal.scope.register(['Mod', 'Shift'], 'l', (_evt: KeyboardEvent) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const chooser = (modal as any).chooser;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const results = (chooser?.values ?? []) as SearchResult[];
    for (const r of results) {
      const file = app.vault.getAbstractFileByPath(r.path.normalize('NFC'));
      if (file instanceof TFile) {
        // @ts-ignore — 'tab' is a valid PaneType in modern Obsidian
        void app.workspace.getLeaf('tab').openFile(file);
      }
    }
    modal.close();
  });

  modal.scope.register(['Alt'], 'Enter', (_evt: KeyboardEvent) => {
    const editor = app.workspace.activeEditor?.editor;
    if (!editor) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const chooser = (modal as any).chooser;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const result = chooser?.values?.[chooser?.selectedItem] as SearchResult | undefined;
    if (!result) return;
    const link = '[[' + result.title + ']]';
    editor.replaceRange(link, editor.getCursor());
  });

  modal.scope.register(['Alt', 'Shift'], 'Enter', (_evt: KeyboardEvent) => {
    const editor = app.workspace.activeEditor?.editor;
    if (!editor) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const chooser = (modal as any).chooser;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const results = (chooser?.values ?? []) as SearchResult[];
    const text = results.map((r) => '[[' + r.title + ']]').join('\n');
    editor.replaceRange(text, editor.getCursor());
    modal.close();
  });
}
