import { Helmet } from "react-helmet-async";

const release = {
  application: "ticket-ai",
  release_sha: __TICKET_AI_RELEASE_SHA__,
  build_time_utc: __TICKET_AI_BUILD_TIME__,
};

export default function Version() {
  return (
    <>
      <Helmet>
        <title>TICKET AI Release Version</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <main className="min-h-dvh bg-background p-6 text-foreground">
        <pre className="whitespace-pre-wrap break-all font-mono text-sm">
          {JSON.stringify(release, null, 2)}
        </pre>
      </main>
    </>
  );
}
