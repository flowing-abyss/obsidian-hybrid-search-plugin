import { Modal } from 'obsidian-test-mocks/obsidian';
import { afterEach, beforeEach, vi } from 'vitest';

if (typeof Document === 'function') {
  const { setup } = await import('obsidian-test-mocks/setup');
  setup();
  Element.prototype.scrollIntoView = () => {};
}

beforeEach(() => {
  if (typeof Document !== 'function') return;
  // The package auto-closes modals on a zero-delay timer. User-driven lifetime
  // is required here to exercise the plugin's cancellation and cleanup paths.
  vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
    activeDocument.body.appendChild(this.containerEl);
    this.onOpen();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
