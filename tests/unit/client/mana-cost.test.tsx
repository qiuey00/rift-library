// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ManaCost, manaSymbolClass, parseManaCost } from '../../../src/client/components/ManaCost';

afterEach(cleanup);

describe('mana costs', () => {
  it('splits faces and symbols', () => {
    expect(parseManaCost('{1}{U}')).toEqual([['1', 'U']]);
    expect(parseManaCost('{U} // {U}')).toEqual([['U'], ['U']]);
    expect(parseManaCost('')).toEqual([]);
  });

  it('names each symbol with the Mana font class', () => {
    expect(manaSymbolClass('2')).toBe('ms-2');
    expect(manaSymbolClass('G')).toBe('ms-g');
    expect(manaSymbolClass('G/U')).toBe('ms-gu');
    expect(manaSymbolClass('2/W')).toBe('ms-2w');
    expect(manaSymbolClass('W/P')).toBe('ms-wp');
    expect(manaSymbolClass('T')).toBe('ms-tap');
    expect(manaSymbolClass('X')).toBe('ms-x');
  });

  it('draws nothing for a card with no cost', () => {
    const { container } = render(<ManaCost cost="" />);
    expect(container.innerHTML).toBe('');
  });

  it('draws a symbol per mana and reads the cost aloud', () => {
    const { container, getByText } = render(<ManaCost cost="{3}{R}{G}" />);
    expect([...container.querySelectorAll('i.ms-cost')].map((i) => i.className)).toEqual([
      'ms ms-cost ms-shadow ms-3',
      'ms ms-cost ms-shadow ms-r',
      'ms ms-cost ms-shadow ms-g',
    ]);
    expect(getByText('Mana cost {3}{R}{G}')).toBeTruthy();
  });
});
