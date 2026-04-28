export const metadata = {
  title: 'KumiBooks',
  description: '運用会社共同帳簿システム'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
