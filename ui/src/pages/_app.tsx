// ui/src/pages/_app.tsx
import type { AppProps } from 'next/app';
import Head from 'next/head';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Agentic Pay — BSV Multi-Agent Payment System</title>
        <meta name="description" content="Autonomous AI agents discovering, negotiating, and exchanging value via BSV micro-payments" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <style global jsx>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0F1117; color: #ECEFF4; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #1A1D27; }
        ::-webkit-scrollbar-thumb { background: #2E3250; border-radius: 3px; }
      `}</style>
      <Component {...pageProps} />
    </>
  );
}
