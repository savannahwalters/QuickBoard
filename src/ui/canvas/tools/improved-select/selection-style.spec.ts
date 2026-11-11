import { afterEach, describe, expect, it } from 'vitest';
import { selectionColors } from './selection-style';

describe('selection colors', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.removeProperty('--accent-border');
  });

  it('uses the theme accent for the outline and handles', () => {
    document.documentElement.style.setProperty('--accent', '#c97fff');
    document.documentElement.style.setProperty('--accent-border', '#c464f6');
    expect(selectionColors()).toEqual({ border: '#c464f6', handle: '#c97fff' });
  });
});
