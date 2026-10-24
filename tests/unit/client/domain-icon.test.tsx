// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DomainIcon, DomainIcons } from '../../../src/client/components/DomainIcon';
import { isPublicCode, typedPublicCode } from '../../../src/client/lib/card-text';
import { Domain } from '../../../src/shared/api/common';

afterEach(cleanup);

describe('DomainIcon', () => {
  it('draws each domain as a named SVG in its color', () => {
    const colors: Record<Domain, string> = {
      fury: '#d0342c',
      calm: '#2e8b57',
      mind: '#2f6fd6',
      body: '#e2771b',
      chaos: '#7b48c8',
      order: '#e3b11c',
    };
    render(
      <div>
        {Domain.options.map((domain) => (
          <DomainIcon key={domain} domain={domain} />
        ))}
      </div>,
    );
    for (const [domain, name] of [
      ['fury', 'Fury'],
      ['calm', 'Calm'],
      ['mind', 'Mind'],
      ['body', 'Body'],
      ['chaos', 'Chaos'],
      ['order', 'Order'],
    ] as const) {
      const icon = screen.getByRole('img', { name });
      expect(icon.tagName.toLowerCase()).toBe('svg');
      expect(icon.querySelector('circle')?.getAttribute('fill')).toBe(colors[domain]);
      expect(icon.querySelector('path')?.getAttribute('d')).toBeTruthy();
    }
  });

  it('shows a row of domains, and nothing for none', () => {
    const { container } = render(<DomainIcons domains={[]} />);
    expect(container.innerHTML).toBe('');
    render(<DomainIcons domains={['fury', 'chaos']} />);
    expect(screen.getAllByRole('img').map((icon) => icon.getAttribute('aria-label'))).toEqual([
      'Fury',
      'Chaos',
    ]);
  });
});

describe('public codes', () => {
  it('tells a typed public code from a name', () => {
    expect(typedPublicCode('ogn-042')).toBe('OGN-042');
    expect(typedPublicCode(' ogn-042/298 ')).toBe('OGN-042/298');
    expect(typedPublicCode('sfx-52p')).toBe('SFX-52p');
    expect(typedPublicCode('ember')).toBeNull();
    expect(typedPublicCode('Jinx, Loose Cannon')).toBeNull();
  });

  it('matches a printing whatever the zeros, case and set count', () => {
    expect(isPublicCode('OGN-042/298', 'ogn-42')).toBe(true);
    expect(isPublicCode('OGN-042/298', 'OGN-042/298')).toBe(true);
    expect(isPublicCode('SFX-52p/52', 'sfx-52P')).toBe(true);
    expect(isPublicCode('OGN-042/298', 'OGN-043')).toBe(false);
    expect(isPublicCode('OGN-042/298', 'SFD-042')).toBe(false);
  });
});
