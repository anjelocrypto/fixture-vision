import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

const TermsOfService = () => {
  return (
    <>
      <Helmet>
        <title>Terms of Service - Ticket AI</title>
        <meta name="description" content="Terms of Service for Ticket AI sports data analytics software. Review our terms, billing policies, and user agreements." />
        <link rel="canonical" href="https://ticketai.bet/legal/terms" />
      </Helmet>
      
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Home
          </Link>
          
          <article className="prose prose-slate dark:prose-invert max-w-none">
            <header className="mb-8">
              <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
              <p className="text-muted-foreground">Last updated: October 31, 2025</p>
            </header>

            <section id="who-we-are">
              <h2 className="text-2xl font-semibold mt-8 mb-4">1. Who we are</h2>
              <p>Ticket AI ("we," "us," "our") provides sports data analytics software. We do not accept wagers, hold betting accounts, or pay out winnings. Our product delivers research tools, statistics, and modeling outputs for informational purposes only.</p>
              <p>Company contact: support@ticketai.bet</p>
            </section>

            <section id="agreement">
              <h2 className="text-2xl font-semibold mt-8 mb-4">2. Agreement to these Terms</h2>
              <p>By accessing or using Ticket AI, you agree to these Terms of Service ("Terms") and our Privacy Policy. If you do not agree, do not use the Service.</p>
            </section>

            <section id="eligibility">
              <h2 className="text-2xl font-semibold mt-8 mb-4">3. Eligibility & jurisdictions</h2>
              <p>You must be at least 18 years old (or the age of majority in your jurisdiction).</p>
              <p>You are responsible for ensuring that use of sports analytics content is permitted in your location.</p>
              <p>We are not a gambling operator. If your laws restrict sports wagering, you must comply independently.</p>
            </section>

            <section id="not-advice">
              <h2 className="text-2xl font-semibold mt-8 mb-4">4. Not financial or betting advice</h2>
              <p>All outputs are informational only and are not investment, financial, or betting advice. You are solely responsible for any decisions you make using our data.</p>
            </section>

            <section id="accounts">
              <h2 className="text-2xl font-semibold mt-8 mb-4">5. Accounts & security</h2>
              <p>You are responsible for maintaining the confidentiality of your account and for all activity under it. Notify us immediately if you suspect unauthorized access.</p>
            </section>

            <section id="license">
              <h2 className="text-2xl font-semibold mt-8 mb-4">6. License and acceptable use</h2>
              <p>We grant you a limited, non-exclusive, non-transferable license to access the Service for personal or internal business use. You agree not to:</p>
              <ul>
                <li>copy, scrape, or resell data except as expressly permitted;</li>
                <li>reverse engineer, interfere with, or overload the Service;</li>
                <li>use outputs to build a competing product without our written consent;</li>
                <li>misuse the Service in violation of applicable law or third-party rights.</li>
              </ul>
            </section>

            <section id="content">
              <h2 className="text-2xl font-semibold mt-8 mb-4">7. Content & intellectual property</h2>
              <p>All software, features, text, logos, and data visualizations are our IP or our licensors' IP. You retain rights to content you lawfully upload but grant us a license to operate the Service (hosting, processing, displaying).</p>
            </section>

            <section id="third-party">
              <h2 className="text-2xl font-semibold mt-8 mb-4">8. Third-party services</h2>
              <p>The Service may reference third-party APIs, data sources, and payment processors (e.g., Stripe). Those services are governed by their own terms and privacy policies.</p>
            </section>

            <section id="service-changes">
              <h2 className="text-2xl font-semibold mt-8 mb-4">9. Service changes & availability</h2>
              <p>We may modify, suspend, or discontinue any feature. We will make reasonable efforts to notify you of material changes. We are not liable for downtime or data source outages.</p>
            </section>

            <section id="billing">
              <h2 className="text-2xl font-semibold mt-8 mb-4">10. Plans, billing, and taxes</h2>
              <p>Access to paid features requires a subscription processed via Stripe. Prices may change with notice. You authorize recurring charges until you cancel. You are responsible for applicable taxes.</p>
            </section>

            <section id="fees-refunds">
              <h2 className="text-2xl font-semibold mt-8 mb-4">11. Fees & refunds</h2>
              <p><strong>Subscriptions:</strong> Renew automatically unless canceled before the renewal date.</p>
              <p><strong>Refunds:</strong> If you believe a charge is in error, contact support@ticketai.bet within 7 days of the transaction. We review good-faith refund requests for: duplicate payments, accidental multiple subscriptions, or material non-delivery of Service for a full billing cycle. We do not offer pro-rata refunds for partial periods once a cycle has started, except where required by law.</p>
            </section>

            <section id="fair-use">
              <h2 className="text-2xl font-semibold mt-8 mb-4">12. Fair use & rate limits</h2>
              <p>We may apply reasonable rate limits to protect stability. If your usage materially exceeds normal patterns or harms the Service, we may throttle or suspend access.</p>
            </section>

            <section id="prohibited">
              <h2 className="text-2xl font-semibold mt-8 mb-4">13. Prohibited uses</h2>
              <p>You may not use the Service to:</p>
              <ul>
                <li>(a) violate any law, including gambling, AML, or sanctions laws;</li>
                <li>(b) harvest personal data without consent;</li>
                <li>(c) attempt to access non-public systems;</li>
                <li>(d) misrepresent affiliation with us.</li>
              </ul>
            </section>

            <section id="disclaimers">
              <h2 className="text-2xl font-semibold mt-8 mb-4">14. Disclaimers</h2>
              <p>THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE." WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT ACCURACY, RELIABILITY, OR AVAILABILITY OF ANY DATA OR OUTPUTS.</p>
            </section>

            <section id="limitation">
              <h2 className="text-2xl font-semibold mt-8 mb-4">15. Limitation of liability</h2>
              <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES; OR ANY LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL. OUR TOTAL LIABILITY FOR ANY CLAIM WILL NOT EXCEED THE AMOUNTS YOU PAID TO US IN THE 3 MONTHS PRECEDING THE CLAIM.</p>
            </section>

            <section id="indemnification">
              <h2 className="text-2xl font-semibold mt-8 mb-4">16. Indemnification</h2>
              <p>You will indemnify and hold us harmless from claims arising out of your misuse of the Service, violation of these Terms, or infringement of third-party rights.</p>
            </section>

            <section id="termination">
              <h2 className="text-2xl font-semibold mt-8 mb-4">17. Term, suspension, and termination</h2>
              <p>We may suspend or terminate your access for violations of these Terms or risk to the platform. You may cancel at any time via your account or by contacting support. Sections that by nature should survive termination will survive.</p>
            </section>

            <section id="changes">
              <h2 className="text-2xl font-semibold mt-8 mb-4">18. Changes to the Terms</h2>
              <p>We may update these Terms. If we make material changes, we will provide notice (e.g., banner or email). Continued use after the effective date constitutes acceptance.</p>
            </section>

            <section id="governing-law">
              <h2 className="text-2xl font-semibold mt-8 mb-4">19. Governing law & venue</h2>
              <p>These Terms are governed by the laws of Delaware, USA (without regard to conflicts of laws). Courts located in Delaware will have exclusive jurisdiction, except where local law requires otherwise.</p>
            </section>

            <section id="contact">
              <h2 className="text-2xl font-semibold mt-8 mb-4">20. Contact</h2>
              <p>Questions? support@ticketai.bet</p>
            </section>
          </article>
        </div>
      </div>
    </>
  );
};

export default TermsOfService;
