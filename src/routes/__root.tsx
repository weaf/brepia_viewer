import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import App from '@/App';
import appCss from '@/index.css?url';
import appearanceCss from '@/appearance.css?url';

const assetUrl = (path: string) =>
  `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}${path.replace(/^\//, '')}`;

const appearanceBootstrapScript = `
(() => {
  try {
    const stored = window.localStorage.getItem('brepia-appearance');
    const preference =
      stored === 'system' || stored === 'light' || stored === 'dark'
        ? stored
        : 'dark';
    const resolved =
      preference === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : preference;
    const root = document.documentElement;
    root.dataset.appearance = preference;
    root.dataset.theme = resolved;
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
  } catch {
    document.documentElement.classList.add('dark');
    document.documentElement.dataset.appearance = 'dark';
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.colorScheme = 'dark';
  }
})();
`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { title: 'Brepia-viewer' },
      { name: 'theme-color', content: '#191A1A' },
      { name: 'description', content: 'Browse, view, and edit parametric OpenSCAD models without signing in.' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'stylesheet', href: appearanceCss },
    ],
  }),
  component: RootComponent,
  errorComponent: ({ error }) => (
    <RootDocument>
      <App error={error} />
    </RootDocument>
  ),
});

function RootComponent() {
  return (
    <RootDocument>
      <App />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta charSet="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover"
        />
        <script
          dangerouslySetInnerHTML={{ __html: appearanceBootstrapScript }}
        />
        <link
          rel="icon"
          type="image/svg+xml"
          href={assetUrl('brepia-mark.svg')}
        />
        <link rel="manifest" href={assetUrl('site.webmanifest')} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
