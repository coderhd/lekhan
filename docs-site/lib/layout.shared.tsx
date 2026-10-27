import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'Lekhan Docs',
    },
    githubUrl: 'https://github.com/coderhd/lekhan',
    links: [
      {
        text: 'lekhan.app',
        url: 'https://lekhan.app',
        external: true,
      },
    ],
  };
}
