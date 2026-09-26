import CommentModeLoader from '../components/CommentModeLoader';

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '40px auto', padding: '0 16px', fontFamily: 'sans-serif', lineHeight: 1.5 }}>
      <h1>Comment mode: Next.js + Upstash example</h1>
      <p>
        This page loads comment mode from <code>/comment-mode.js</code> (a copy kept in{' '}
        <code>public/</code>, see this example&apos;s README) and syncs comments through the{' '}
        <code>/api/comments</code> endpoint, backed by Upstash Redis, so comments made here are
        shared with anyone who loads this page.
      </p>
      <p id="scratch-paragraph">
        Turn on comment mode with the button in the corner, then tap this sentence, or any other
        one on the page, to try it. Unlike the single-file example, which only stores comments in
        your own browser, comments made here persist on the server and are visible to every
        visitor.
      </p>
      <CommentModeLoader />
    </main>
  );
}
