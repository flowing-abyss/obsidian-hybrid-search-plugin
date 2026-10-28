import type { Plugin } from 'obsidian';
import type { SearchMode } from './search/contracts';
import { revealGraphWorkbench } from './ui/graph/GraphWorkbenchView';
import type { PluginContext } from './ui/pluginContext';
import { revealSearchPanel } from './ui/search/SearchPanelView';

export function registerCommands(
  plugin: PluginContext & Pick<Plugin, 'addCommand'>,
  openSearchModal: (mode?: SearchMode) => void,
): void {
  plugin.addCommand({
    id: 'open-search',
    name: 'Open search',
    callback: () => openSearchModal(),
  });

  plugin.addCommand({
    id: 'search-hybrid',
    name: 'Hybrid mode',
    callback: () => openSearchModal('hybrid'),
  });

  plugin.addCommand({
    id: 'search-fulltext',
    name: 'Fulltext mode',
    callback: () => openSearchModal('fulltext'),
  });

  plugin.addCommand({
    id: 'search-semantic',
    name: 'Semantic mode',
    callback: () => openSearchModal('semantic'),
  });

  plugin.addCommand({
    id: 'search-title',
    name: 'Title mode',
    callback: () => openSearchModal('title'),
  });

  plugin.addCommand({
    id: 'open-search-panel',
    name: 'Open search panel',
    callback: () => {
      void revealSearchPanel(plugin);
    },
  });

  plugin.addCommand({
    id: 'open-graph-workbench',
    name: 'Open graph workbench',
    callback: () => {
      void revealGraphWorkbench(plugin);
    },
  });

  plugin.addCommand({
    id: 'search-panel-hybrid',
    name: 'Search panel: Hybrid mode',
    callback: () => {
      void revealSearchPanel(plugin, 'hybrid');
    },
  });

  plugin.addCommand({
    id: 'search-panel-fulltext',
    name: 'Search panel: Fulltext mode',
    callback: () => {
      void revealSearchPanel(plugin, 'fulltext');
    },
  });

  plugin.addCommand({
    id: 'search-panel-semantic',
    name: 'Search panel: Semantic mode',
    callback: () => {
      void revealSearchPanel(plugin, 'semantic');
    },
  });

  plugin.addCommand({
    id: 'search-panel-title',
    name: 'Search panel: Title mode',
    callback: () => {
      void revealSearchPanel(plugin, 'title');
    },
  });
}
