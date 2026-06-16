import { App, TFile } from 'obsidian';
import type { SearchResult } from '../ipc';
import type { HybridSearchSettings } from '../settings';
import { fileToDragWikiLink } from './noteUtils';
import type { SearchModal } from './SearchModal';

interface ModalWithChooser {
  chooser?: {
    values?: unknown[];
    selectedItem?: number;
    setSelectedItem?: (index: number, evt: KeyboardEvent) => void;
  };
}

export function registerModalKeymap(
  modal: SearchModal,
  app: App,
  settings: HybridSearchSettings,
  saveSettings: () => Promise<void>,
): void {
  // Mod = Cmd on macOS, Ctrl on Windows/Linux

  function getSelected(m: SearchModal): SearchResult | undefined {
    const chooser = (m as unknown as ModalWithChooser).chooser;
    return chooser?.values?.[chooser?.selectedItem ?? 0] as SearchResult | undefined;
  }

  function getAll(m: SearchModal): SearchResult[] {
    const chooser = (m as unknown as ModalWithChooser).chooser;
    return (chooser?.values ?? []) as SearchResult[];
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  modal.scope.register(['Mod'], 'j', (evt: KeyboardEvent) => {
    const chooser = (modal as unknown as ModalWithChooser).chooser;
    const values = chooser?.values ?? [];
    if (values.length === 0) return;
    const idx = chooser?.selectedItem ?? 0;
    chooser?.setSelectedItem?.(Math.min(idx + 1, values.length - 1), evt);
  });

  modal.scope.register(['Mod'], 'k', (evt: KeyboardEvent) => {
    const chooser = (modal as unknown as ModalWithChooser).chooser;
    const values = chooser?.values ?? [];
    if (values.length === 0) return;
    const idx = chooser?.selectedItem ?? 0;
    chooser?.setSelectedItem?.(Math.max(idx - 1, 0), evt);
  });

  // ── Preview toggle ────────────────────────────────────────────────────────

  modal.scope.register(['Mod'], 'p', (_evt: KeyboardEvent) => {
    settings.showPreview = !settings.showPreview;
    void saveSettings();
    if (!settings.showPreview) {
      modal.hidePreviewPanel();
    } else {
      const selected = getSelected(modal);
      if (selected)
        modal.triggerPreview(
          selected.path.normalize('NFC'),
          selected.snippet,
          selected.previewAnchors,
          selected.primaryAnchorIndex,
        );
    }
  });

  modal.scope.register(['Mod', 'Shift'], 'p', (_evt: KeyboardEvent) => {
    settings.scrollToSnippet = !settings.scrollToSnippet;
    void saveSettings();
    if (settings.showPreview && settings.scrollToSnippet) {
      const selected = getSelected(modal);
      if (selected)
        modal.triggerPreview(
          selected.path.normalize('NFC'),
          selected.snippet,
          selected.previewAnchors,
          selected.primaryAnchorIndex,
        );
    }
  });

  // ── Graph panel toggle ────────────────────────────────────────────────────

  modal.scope.register(['Mod'], 'g', (_evt: KeyboardEvent) => {
    settings.showGraphPanel = !settings.showGraphPanel;
    void saveSettings();
    if (!settings.showGraphPanel) {
      modal.getGraphPanel()?.hide();
      return;
    }
    const selected = getSelected(modal);
    if (selected) {
      modal.getGraphPanel()?.show(selected.path.normalize('NFC'));
      modal.positionGraphPanel();
    }
  });

  // ── Open in new tab ───────────────────────────────────────────────────────

  modal.scope.register(['Mod'], 'o', (_evt: KeyboardEvent) => {
    const result = getSelected(modal);
    if (!result) return;
    const file = app.vault.getAbstractFileByPath(result.path.normalize('NFC'));
    if (file instanceof TFile) {
      // @ts-ignore — 'tab' is a valid PaneType in modern Obsidian
      void app.workspace.getLeaf('tab').openFile(file);
    }
  });

  // ── Open all in new tabs ──────────────────────────────────────────────────

  modal.scope.register(['Mod', 'Shift'], 'o', (_evt: KeyboardEvent) => {
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
    const sourcePath = app.workspace.getActiveFile()?.path ?? '';
    const link = fileToDragWikiLink(app, result.path, sourcePath);
    editor.replaceRange(link, editor.getCursor());
  });

  // ── Insert all links at cursor ────────────────────────────────────────────

  modal.scope.register(['Alt', 'Shift'], 'Enter', (_evt: KeyboardEvent) => {
    const editor = app.workspace.activeEditor?.editor;
    if (!editor) return;
    const results = getAll(modal);
    const sourcePath = app.workspace.getActiveFile()?.path ?? '';
    const text = results.map((r) => fileToDragWikiLink(app, r.path, sourcePath)).join('\n');
    editor.replaceRange(text, editor.getCursor());
    modal.close();
  });
}
