import { describe, expect, it } from 'vitest';
import { findInlineSearchTrigger } from '../src/ui/InlineSearchSuggest';

describe('findInlineSearchTrigger', () => {
  it('finds the last trigger before the cursor', () => {
    expect(findInlineSearchTrigger('alpha ;;project tag:work', ';;')).toEqual({
      ch: 6,
      query: 'project tag:work',
    });
  });

  it('allows empty query immediately after the trigger', () => {
    expect(findInlineSearchTrigger(';;', ';;')).toEqual({ ch: 0, query: '' });
  });

  it('ignores escaped triggers', () => {
    expect(findInlineSearchTrigger('\\;;literal', ';;')).toBeNull();
  });

  it('returns null when no trigger is present', () => {
    expect(findInlineSearchTrigger('plain text', ';;')).toBeNull();
  });

  it('supports custom triggers', () => {
    expect(findInlineSearchTrigger('note ::semantic', '::')).toEqual({
      ch: 5,
      query: 'semantic',
    });
  });
});
