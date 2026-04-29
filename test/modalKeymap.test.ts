import { TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../src/ipc';
import { registerModalKeymap } from '../src/ui/modalKeymap';

describe('registerModalKeymap', () => {
  const registrations: Array<{
    modifiers: string[];
    key: string;
    handler: (evt: KeyboardEvent) => void;
  }> = [];

  const mockSetSelectedItem = vi.fn();
  const mockChooser = {
    values: [] as SearchResult[],
    selectedItem: 0,
    setSelectedItem: mockSetSelectedItem,
  };

  const mockTriggerPreview = vi.fn();
  const mockHidePreviewPanel = vi.fn();
  const mockClose = vi.fn();
  const mockGraphPanel = {
    hide: vi.fn(),
    show: vi.fn(),
  };
  const mockGetGraphPanel = vi.fn(() => mockGraphPanel);
  const mockPositionGraphPanel = vi.fn();

  const mockOpenFile = vi.fn();
  const mockGetLeaf = vi.fn().mockReturnValue({ openFile: mockOpenFile });
  const mockGetAbstractFileByPath = vi.fn();

  const mockModal = {
    scope: {
      register: vi.fn((modifiers: string[], key: string, handler: (evt: KeyboardEvent) => void) => {
        registrations.push({ modifiers, key, handler });
      }),
    },
    get chooser() {
      return mockChooser;
    },
    triggerPreview: mockTriggerPreview,
    hidePreviewPanel: mockHidePreviewPanel,
    getGraphPanel: mockGetGraphPanel,
    positionGraphPanel: mockPositionGraphPanel,
    close: mockClose,
  } as unknown as Parameters<typeof registerModalKeymap>[0];

  const mockApp = {
    workspace: {
      getLeaf: mockGetLeaf,
      activeEditor: {
        editor: { replaceRange: vi.fn(), getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }) },
      },
    },
    vault: {
      getAbstractFileByPath: mockGetAbstractFileByPath,
    },
  } as unknown as Parameters<typeof registerModalKeymap>[1];

  const mockSaveSettings = vi.fn();

  let settings: Parameters<typeof registerModalKeymap>[2];

  beforeEach(() => {
    registrations.length = 0;
    vi.clearAllMocks();
    mockChooser.values = [
      { path: 'a.md', title: 'A', score: 0.9, tags: [], aliases: [] },
      { path: 'b.md', title: 'B', score: 0.8, tags: [], aliases: [] },
      { path: 'c.md', title: 'C', score: 0.7, tags: [], aliases: [] },
    ];
    mockChooser.selectedItem = 1;
    settings = { showPreview: true, scrollToSnippet: true } as Parameters<
      typeof registerModalKeymap
    >[2];
    registerModalKeymap(mockModal, mockApp, settings, mockSaveSettings);
  });

  function findHandler(modifiers: string[], key: string) {
    const r = registrations.find(
      (reg) =>
        reg.key === key &&
        reg.modifiers.length === modifiers.length &&
        modifiers.every((m) => reg.modifiers.includes(m)),
    );
    if (!r) throw new Error(`Handler not found for ${modifiers.join('+')}+${key}`);
    return r.handler;
  }

  it('registers nine keybindings', () => {
    expect(registrations).toHaveLength(9);
  });

  describe('Mod+J — move down', () => {
    it('increments selected item', () => {
      const handler = findHandler(['Mod'], 'j');
      handler(new KeyboardEvent('keydown'));
      expect(mockSetSelectedItem).toHaveBeenCalledWith(2, expect.any(KeyboardEvent));
    });

    it('does not exceed last item', () => {
      mockChooser.selectedItem = 2;
      const handler = findHandler(['Mod'], 'j');
      handler(new KeyboardEvent('keydown'));
      expect(mockSetSelectedItem).toHaveBeenCalledWith(2, expect.any(KeyboardEvent));
    });

    it('does nothing when values empty', () => {
      mockChooser.values = [];
      const handler = findHandler(['Mod'], 'j');
      handler(new KeyboardEvent('keydown'));
      expect(mockSetSelectedItem).not.toHaveBeenCalled();
    });
  });

  describe('Mod+K — move up', () => {
    it('decrements selected item', () => {
      mockChooser.selectedItem = 2;
      const handler = findHandler(['Mod'], 'k');
      handler(new KeyboardEvent('keydown'));
      expect(mockSetSelectedItem).toHaveBeenCalledWith(1, expect.any(KeyboardEvent));
    });

    it('does not go below zero', () => {
      mockChooser.selectedItem = 0;
      const handler = findHandler(['Mod'], 'k');
      handler(new KeyboardEvent('keydown'));
      expect(mockSetSelectedItem).toHaveBeenCalledWith(0, expect.any(KeyboardEvent));
    });
  });

  describe('Mod+P — toggle preview', () => {
    it('toggles showPreview setting', () => {
      const handler = findHandler(['Mod'], 'p');
      expect(settings.showPreview).toBe(true);
      handler(new KeyboardEvent('keydown'));
      expect(settings.showPreview).toBe(false);
      expect(mockSaveSettings).toHaveBeenCalled();
    });

    it('hides preview panel when disabled', () => {
      const handler = findHandler(['Mod'], 'p');
      handler(new KeyboardEvent('keydown'));
      expect(mockHidePreviewPanel).toHaveBeenCalled();
    });

    it('triggers preview for selected item when enabled', () => {
      settings.showPreview = false;
      const handler = findHandler(['Mod'], 'p');
      handler(new KeyboardEvent('keydown'));
      expect(mockTriggerPreview).toHaveBeenCalled();
    });
  });

  describe('Mod+Shift+P — toggle scrollToSnippet', () => {
    it('toggles scrollToSnippet setting', () => {
      const handler = findHandler(['Mod', 'Shift'], 'p');
      expect(settings.scrollToSnippet).toBe(true);
      handler(new KeyboardEvent('keydown'));
      expect(settings.scrollToSnippet).toBe(false);
      expect(mockSaveSettings).toHaveBeenCalled();
    });

    it('triggers preview when showPreview and scrollToSnippet both true after toggle', () => {
      settings.showPreview = true;
      settings.scrollToSnippet = false;
      const handler = findHandler(['Mod', 'Shift'], 'p');
      handler(new KeyboardEvent('keydown'));
      expect(mockTriggerPreview).toHaveBeenCalled();
    });
  });

  describe('Mod+G — toggle graph panel', () => {
    it('hides graph panel when disabled', () => {
      settings.showGraphPanel = true;
      const handler = findHandler(['Mod'], 'g');
      handler(new KeyboardEvent('keydown'));
      expect(settings.showGraphPanel).toBe(false);
      expect(mockSaveSettings).toHaveBeenCalled();
      expect(mockGraphPanel.hide).toHaveBeenCalled();
    });

    it('shows graph panel for selected item when enabled', () => {
      settings.showGraphPanel = false;
      const handler = findHandler(['Mod'], 'g');
      handler(new KeyboardEvent('keydown'));
      expect(settings.showGraphPanel).toBe(true);
      expect(mockGraphPanel.show).toHaveBeenCalledWith('b.md');
      expect(mockPositionGraphPanel).toHaveBeenCalled();
    });
  });

  describe('Mod+O — open in new tab', () => {
    it('opens selected file in new tab', () => {
      mockGetAbstractFileByPath.mockReturnValue(Object.assign(new TFile(), { path: 'b.md' }));
      const handler = findHandler(['Mod'], 'o');
      handler(new KeyboardEvent('keydown'));
      expect(mockGetAbstractFileByPath).toHaveBeenCalledWith('b.md');
      expect(mockGetLeaf).toHaveBeenCalledWith('tab');
      expect(mockOpenFile).toHaveBeenCalled();
    });

    it('does nothing when no selection', () => {
      mockChooser.selectedItem = -1;
      const handler = findHandler(['Mod'], 'o');
      handler(new KeyboardEvent('keydown'));
      expect(mockGetLeaf).not.toHaveBeenCalled();
    });
  });

  describe('Mod+Shift+O — open all in new tabs', () => {
    it('opens every result in a new tab', () => {
      mockGetAbstractFileByPath.mockImplementation((p: string) =>
        Object.assign(new TFile(), { path: p }),
      );
      const handler = findHandler(['Mod', 'Shift'], 'o');
      handler(new KeyboardEvent('keydown'));
      expect(mockGetLeaf).toHaveBeenCalledTimes(3);
      expect(mockClose).toHaveBeenCalled();
    });

    it('does nothing when values empty', () => {
      mockChooser.values = [];
      const handler = findHandler(['Mod', 'Shift'], 'o');
      handler(new KeyboardEvent('keydown'));
      expect(mockGetLeaf).not.toHaveBeenCalled();
    });
  });
});
