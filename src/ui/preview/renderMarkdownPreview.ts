import { MarkdownRenderChild, MarkdownRenderer, type App } from 'obsidian';

/** Render asynchronously into a request-owned tree; only its current owner may publish it. */
export async function renderMarkdownPreview(
  app: App,
  markdown: string,
  target: HTMLElement,
  sourcePath: string,
  isCurrent: () => boolean,
): Promise<MarkdownRenderChild | undefined> {
  // Global factories create detached nodes; Document.createDiv appends to the document.
  const staging = target.ownerDocument.adoptNode(createDiv({ cls: 'markdown-rendered' }));
  const child = new MarkdownRenderChild(staging);
  child.load();
  let published = false;
  try {
    await MarkdownRenderer.render(app, markdown, staging, sourcePath, child);
    if (!isCurrent()) return undefined;
    target.appendChild(staging);
    published = true;
    return child;
  } catch {
    return undefined;
  } finally {
    if (!published) child.unload();
  }
}
