import { RootProvider } from 'fumadocs-ui/provider/next';

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <RootProvider>
      <div className="flex flex-col min-h-screen">{children}</div>
    </RootProvider>
  );
}
