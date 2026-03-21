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
  // Ctrl = Control on all platforms (avoids macOS Cmd+H/L system shortcuts)

  function getSelected(m: SearchModal): SearchResult | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const chooser = (m as any).chooser;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return chooser?.values?.[chooser?.selectedItem] as SearchResult | undefined;
  }

  function getAll(m: SearchModal): SearchResult[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const chooser = (m as any).chooser;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return (chooser?.values ?? []) as SearchResult[];
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  modal.scope.register(['Ctrl'], 'j', (evt: KeyboardEvent) => {
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

  modal.scope.register(['Ctrl'], 'k', (evt: KeyboardEvent) => {
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

  // ── Preview toggle ────────────────────────────────────────────────────────

  modal.scope.register(['Ctrl'], 'h', (_evt: KeyboardEvent) => {
    settings.showPreview = !settings.showPreview;
    void saveSettings();
    if (!settings.showPreview) {
      modal.hidePreviewPanel();
    } else {
      const selected = getSelected(modal);
      if (selected) modal.triggerPreview(selected.path.normalize('NFC'));
    }
  });

  // ── Open in new tab ───────────────────────────────────────────────────────

  modal.scope.register(['Ctrl'], 'l', (_evt: KeyboardEvent) => {
    const result = getSelected(modal);
    if (!result) return;
    const file = app.vault.getAbstractFileByPath(result.path.normalize('NFC'));
    if (file instanceof TFile) {
      // @ts-ignore — 'tab' is a valid PaneType in modern Obsidian
      void app.workspace.getLeaf('tab').openFile(file);
    }
  });

  // ── Open all in new tabs ──────────────────────────────────────────────────

  modal.scope.register(['Ctrl', 'Shift'], 'l', (_evt: KeyboardEvent) => {
    const results = getAll(modal);
    if (results.length === 0) return;
    for (const r of results) {
      const file = app.vault.getAbstractFileByPath(r.path.normalize('NFC'));
      if (file instanceof TFile) {
        // @ts-ignore — 'tab' is a valid PaneType in modern Obsidian
        void app.workspace.getLeaf('tab').openFile(file);
      }
    }
    modal.close();
  });

  // ── Insert link at cursor ─────────────────────────────────────────────────
  // Alt = Option on macOS

  modal.scope.register(['Alt'], 'Enter', (_evt: KeyboardEvent) => {
    const editor = app.workspace.activeEditor?.editor;
    if (!editor) return;
    const result = getSelected(modal);
    if (!result) return;
    const linkText = result.title || result.path.replace(/^.*\//, '').replace(/\.md$/, '');
    const link = '[[' + linkText + ']]';
    editor.replaceRange(link, editor.getCursor());
  });

  // ── Insert all links at cursor ────────────────────────────────────────────

  modal.scope.register(['Alt', 'Shift'], 'Enter', (_evt: KeyboardEvent) => {
    const editor = app.workspace.activeEditor?.editor;
    if (!editor) return;
    const results = getAll(modal);
    const text = results
      .map((r) => {
        const linkText = r.title || r.path.replace(/^.*\//, '').replace(/\.md$/, '');
        return '[[' + linkText + ']]';
      })
      .join('\n');
    editor.replaceRange(text, editor.getCursor());
    modal.close();
  });
}
