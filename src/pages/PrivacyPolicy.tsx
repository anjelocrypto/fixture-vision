import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

const PrivacyPolicy = () => {
  return (
    <>
      <Helmet>
        <title>Privacy Policy - Ticket AI</title>
        <meta name="description" content="Privacy Policy for Ticket AI. Learn how we collect, use, and protect your personal information." />
        <link rel="canonical" href="https://ticketai.bet/legal/privacy" />
      </Helmet>
      
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Home
          </Link>
          
          <article className="prose prose-slate dark:prose-invert max-w-none">
            <header className="mb-8">
              <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
              <p className="text-muted-foreground">Last updated: October 31, 2025</p>
            </header>

            <section id="overview">
              <h2 className="text-2xl font-semibold mt-8 mb-4">Overview</h2>
              <p>This Privacy Policy explains how Ticket AI ("we," "us") collects, uses, and shares information when you use our websites and services (the "Service"). We aim to collect the minimum data necessary to operate a secure, reliable analytics product.</p>
            </section>

            <section id="information-collect">
              <h2 className="text-2xl font-semibold mt-8 mb-4">1. Information we collect</h2>
              
              <h3 className="text-xl font-semibold mt-6 mb-3">a) You provide:</h3>
              <ul>
                <li>Account details (email, name, password or SSO ID);</li>
                <li>Billing details processed by Stripe (we do not store full card data);</li>
                <li>Support messages and form inputs.</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">b) Collected automatically:</h3>
              <ul>
                <li>Device, browser, and log data;</li>
                <li>Usage events and feature telemetry;</li>
                <li>Cookies/local storage for session management, preferences, and analytics.</li>
              </ul>

              <h3 className="text-xl font-semibold mt-6 mb-3">c) From third parties:</h3>
              <ul>
                <li>Payment status from Stripe;</li>
                <li>Aggregate sports data from data providers and public sources.</li>
              </ul>
            </section>

            <section id="how-we-use">
              <h2 className="text-2xl font-semibold mt-8 mb-4">2. How we use information</h2>
              <ul>
                <li>Provide, secure, and improve the Service;</li>
                <li>Process payments and manage subscriptions;</li>
                <li>Prevent fraud, abuse, and misuse;</li>
                <li>Communicate service notices and product updates;</li>
                <li>Comply with legal obligations.</li>
              </ul>
            </section>

            <section id="payment-processing">
              <h2 className="text-2xl font-semibold mt-8 mb-4">3. Payment processing</h2>
              <p>Payments are handled by Stripe. Card data is sent directly to Stripe and never touches our servers. See Stripe's privacy practices for more information.</p>
            </section>

            <section id="cookies">
              <h2 className="text-2xl font-semibold mt-8 mb-4">4. Cookies & analytics</h2>
              <p>We use strictly necessary cookies for authentication and may use analytics to understand feature usage. You can control cookies via your browser. Disabling necessary cookies may break core functionality.</p>
            </section>

            <section id="legal-bases">
              <h2 className="text-2xl font-semibold mt-8 mb-4">5. Legal bases (EEA/UK users)</h2>
              <p>We process personal data based on:</p>
              <ul>
                <li>Contract (to provide the Service);</li>
                <li>Legitimate interests (security, product improvement);</li>
                <li>Consent (where required, e.g., non-essential cookies/marketing);</li>
                <li>Legal obligation (tax, accounting, compliance).</li>
              </ul>
            </section>

            <section id="sharing">
              <h2 className="text-2xl font-semibold mt-8 mb-4">6. Sharing information</h2>
              <p>We share data with:</p>
              <ul>
                <li>Service providers under contract (hosting, logging, email, analytics, payments);</li>
                <li>Authorities when required by law;</li>
                <li>In a merger or acquisition, as part of a transfer with notice where required.</li>
              </ul>
              <p>We do not sell personal information.</p>
            </section>

            <section id="retention">
              <h2 className="text-2xl font-semibold mt-8 mb-4">7. Data retention</h2>
              <p>We retain personal data for as long as needed to provide the Service and meet legal obligations. Aggregated, non-personal data may be retained longer.</p>
            </section>

            <section id="security">
              <h2 className="text-2xl font-semibold mt-8 mb-4">8. Security</h2>
              <p>We use technical and organizational measures appropriate to the risk, including encryption in transit, access controls, and audit logging. No system is perfectly secure; you use the Service at your own risk.</p>
            </section>

            <section id="your-rights">
              <h2 className="text-2xl font-semibold mt-8 mb-4">9. Your rights</h2>
              <p>Depending on your location, you may have rights to access, correct, delete, or port your data, and to object to or restrict certain processing. To exercise rights, contact support@ticketai.bet. We will verify requests and respond within applicable timelines.</p>
            </section>

            <section id="children">
              <h2 className="text-2xl font-semibold mt-8 mb-4">10. Children's privacy</h2>
              <p>The Service is not directed to anyone under 18. We do not knowingly collect data from minors. If you believe a minor has provided data, contact us to delete it.</p>
            </section>

            <section id="international">
              <h2 className="text-2xl font-semibold mt-8 mb-4">11. International transfers</h2>
              <p>We may process data in the United States and other countries. Where required, we use appropriate safeguards (e.g., SCCs) for international transfers.</p>
            </section>

            <section id="dnt">
              <h2 className="text-2xl font-semibold mt-8 mb-4">12. Do Not Track / Global Privacy Control</h2>
              <p>We honor applicable browser signals where legally required.</p>
            </section>

            <section id="marketing">
              <h2 className="text-2xl font-semibold mt-8 mb-4">13. Marketing communications</h2>
              <p>If we send marketing emails, you can opt out via the unsubscribe link. Service and transactional emails will still be sent.</p>
            </section>

            <section id="policy-changes">
              <h2 className="text-2xl font-semibold mt-8 mb-4">14. Changes to this Policy</h2>
              <p>We may update this Policy. Material changes will be announced via banner or email. Continued use after changes signifies acceptance.</p>
            </section>

            <section id="privacy-contact">
              <h2 className="text-2xl font-semibold mt-8 mb-4">15. Contact</h2>
              <p>Privacy questions or requests: support@ticketai.bet</p>
            </section>
          </article>
        </div>
      </div>
    </>
  );
};

export default PrivacyPolicy;
