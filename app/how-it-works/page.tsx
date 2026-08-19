import Link from "next/link";
import { WaterMotif } from "@/shared/ui";
import motion from "@/shared/ui/motion.module.css";
import styles from "./page.module.css";

// T-G2: the "how does this work as a SYSTEM for a whole team" page. Plain
// language, no em dashes, no emojis (AGENTS.md / this task's own copy
// rules). Public route (no requireRole guard) on purpose, same posture as
// app/page.tsx and app/login: a jurisdiction evaluating the tool, or a
// staff member who forwarded the link before signing in, should be able to
// read the whole story without an account. If a session cookie exists,
// app/AppShell.tsx still renders the normal persistent header above this
// page (it only hides on /capture/*), so a logged-in official gets their
// usual nav too.
//
// Content is grounded in the modules that actually exist in this codebase
// today (src/core/capture, src/core/engine, src/core/determination,
// src/modules/a1-letters, src/modules/a3-sde-export, app/dashboard/export)
// and in docs/BLOCKERS.md for the one honest gap (B4, email delivery) — no
// station described here is aspirational.

const STATIONS = [
  {
    number: "1",
    title: "Capture, in the field, offline",
    who: "The assessor, standing at the structure, on a phone.",
    automates:
      "One decision per screen, large tap targets, and a photo per element plus a required exterior shot. Every screen auto-saves to a local queue as the assessor advances, so there is no Save button to forget and nothing is lost if the app is killed or the network drops. It works with the network fully off and syncs on its own once a signal comes back.",
    human:
      "The assessor still reads the water line, judges each element's damage percentage, and decides what to photograph. The tool records what they enter; it does not guess it for them.",
  },
  {
    number: "2",
    title: "Automatic math, against a dated cost table",
    who: "The system, the moment a completed assessment syncs.",
    automates:
      "Each element's damage percentage is multiplied against a versioned cost table, summed into a total repair cost, and divided by the structure's market value. The result sorts into three bands: clearly not substantially damaged, clearly substantially damaged, or borderline.",
    human:
      "Nothing at this step is a human judgment call. What stays honest instead: every calculation is stamped with the exact cost table version and value source that produced it, and a calculation is never edited after the fact. A recalculation always adds a new record; it never overwrites the old one.",
  },
  {
    number: "3",
    title: "Official review, with audited overrides",
    who: "The jurisdiction's floodplain official.",
    automates:
      "A review queue puts borderline cases first, then substantially damaged, then not substantially damaged, so the cases that most need a careful look are never buried under routine ones. Every input the calculation used, side by side with the photos, is laid out on one screen.",
    human:
      "The official can change any element's damage percentage or the market value used, but only by giving a written reason, and the change is logged before and after. Adopting a determination is a deliberate, explicit action the official takes. The tool never adopts one on its own.",
  },
  {
    number: "4",
    title: "The determination letter",
    who: "The system generates it the moment an official adopts a determination.",
    automates:
      "It pulls the ratio, the finding, the ordinance citation on file, the appeal deadline, and an ICC paragraph if the jurisdiction supplied one, into a single print-ready page with the jurisdiction's own letterhead.",
    human:
      "If the jurisdiction has not put its real ordinance text on file yet, the tool refuses to generate a letter rather than inventing legal language to fill the gap. A human has to supply that text once, and after that every letter cites it verbatim.",
  },
  {
    number: "5",
    title: "Exports, three shapes of the same record",
    who: "The official or administrator, whenever the data needs to leave the system.",
    automates:
      "A structured export that mirrors FEMA's own SDE 3.0 element breakdown, a full per-jurisdiction export for answering a public-records request, and an operational summary CSV for a spreadsheet or a briefing.",
    human:
      "A person still uploads the export to FEMA's own tool and still decides how to answer a records request. Nothing in this system calls an outside service on its own; every export is a file a person downloads and chooses where to send.",
  },
] as const;

const VALUE_POINTS = [
  {
    title: "Fewer re-visits",
    body: "The field flow walks the full, fixed element list plus photos in one pass, so an assessor is far less likely to have to go back to a flooded house because one number was missed.",
  },
  {
    title: "No re-typing into FEMA's tools",
    body: "The export already matches FEMA's own SDE 3.0 element structure, so an official is not re-keying twelve line items by hand into a separate program.",
  },
  {
    title: "Determinations that survive appeal",
    body: "Every dollar in a calculation carries the cost table version that produced it, and every override carries a written reason. A challenged determination traces back to real inputs, not a person's memory of what they decided.",
  },
  {
    title: "Borderline cases forced to a human",
    body: "The system will not auto-decide anything landing between 45% and 55% of market value. That band always lands in front of an official, every time, by design.",
  },
] as const;

const DEMO_ACCOUNTS = [
  { email: "demo-assessor@riverline-training.example", role: "Assessor" },
  { email: "demo-official@riverline-training.example", role: "Official" },
  { email: "demo-admin@riverline-training.example", role: "Administrator" },
] as const;

export default function HowItWorksPage() {
  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <header className={styles.hero}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link href="/" className={styles.breadcrumbLink}>
            RiverLine SDD
          </Link>
          <span aria-hidden="true">/</span>
          <span>How it works</span>
        </nav>
        <WaterMotif variant="accent" className={styles.waterAccent} />
        <p className={styles.eyebrow}>How it works</p>
        <h1 className={styles.heading}>One record, five stations, one team</h1>
        <p className={styles.lede}>
          RiverLine is not a single form. It is the path one flooded structure&apos;s
          record takes from a field visit to a signed determination and the exports
          that follow it, with the assessor and the official each doing a distinct
          part of the work. This page walks that path station by station, in plain
          language.
        </p>
      </header>

      <section className={styles.section} aria-labelledby="stations-heading">
        <h2 id="stations-heading" className={styles.sectionHeading}>
          The five stations
        </h2>
        <ol className={styles.stationList}>
          {STATIONS.map((station) => (
            <li key={station.number} className={styles.stationCard}>
              <div className={styles.stationNumber} aria-hidden="true">
                {station.number}
              </div>
              <div className={styles.stationBody}>
                <h3 className={styles.stationTitle}>{station.title}</h3>
                <dl className={styles.stationDetails}>
                  <div className={styles.stationRow}>
                    <dt>Who does it</dt>
                    <dd>{station.who}</dd>
                  </div>
                  <div className={styles.stationRow}>
                    <dt>What the app automates</dt>
                    <dd>{station.automates}</dd>
                  </div>
                  <div className={styles.stationRow}>
                    <dt>What stays human</dt>
                    <dd>{station.human}</dd>
                  </div>
                </dl>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section} aria-labelledby="value-heading">
        <h2 id="value-heading" className={styles.sectionHeading}>
          Why this saves a jurisdiction time and money
        </h2>
        <p className={styles.sectionLede}>
          Said plainly, not as a sales pitch: these are the four concrete ways the
          five stations above pay off in practice.
        </p>
        <ul className={styles.valueGrid}>
          {VALUE_POINTS.map((point) => (
            <li key={point.title} className={styles.valueCard}>
              <h3 className={styles.valueTitle}>{point.title}</h3>
              <p className={styles.valueBody}>{point.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="reports-heading">
        <h2 id="reports-heading" className={styles.sectionHeading}>
          How reports move today
        </h2>
        <p className={styles.sectionBody}>
          Right now, a determination letter is printed or downloaded, and every
          export (the FEMA-structured file, the full records-request export, the
          operational summary CSV) is a file an official downloads and hands off
          themselves. Sending a letter or an export by email directly from
          RiverLine will work once the jurisdiction connects an email service; that
          connection is not live yet. Until it is, print, download, and hand off
          in person or by your own email are the real path, and this page will not
          pretend otherwise.
        </p>
      </section>

      <section className={styles.demoSection} aria-labelledby="demo-heading">
        <h2 id="demo-heading" className={styles.sectionHeading}>
          Run the demo
        </h2>
        <p className={styles.sectionBody}>
          A second, self-contained jurisdiction called <strong>Riverline Training
          Demo</strong> exists specifically so a whole team can click through this
          entire path on data that cannot be mistaken for a real record. Every
          address, every dollar figure, and the ordinance text in that jurisdiction
          is clearly labeled as training-only. Row-level security keeps it
          completely separate from any real jurisdiction&apos;s data; nothing you do
          there touches a real structure or a real determination.
        </p>
        <p className={styles.sectionBody}>
          It is pre-loaded with structures at every stage of the path above: one
          not yet assessed, one mid-capture, one completed and awaiting review, one
          borderline and awaiting review, one adopted as substantially damaged with
          a letter already issued, one adopted as not substantially damaged with a
          letter issued, and one that was adopted, then corrected and superseded,
          so you can see the audit trail a real correction leaves behind.
        </p>
        <div className={styles.demoAccounts}>
          {DEMO_ACCOUNTS.map((account) => (
            <div key={account.email} className={styles.demoAccountRow}>
              <span className={styles.demoRole}>{account.role}</span>
              <span className={styles.demoEmail}>{account.email}</span>
            </div>
          ))}
        </div>
        <p className={styles.sectionBody}>
          Sign in with any of these accounts the same way you would with a real
          one, through the sign-in link on the login page. Ask your administrator
          for a link if you do not have one yet.
        </p>
        <Link href="/login" className={styles.demoCta}>
          Sign in to try it
        </Link>
      </section>

      <footer className={styles.footer}>
        <p>
          Need the paper fallback for when the tool is unreachable?{" "}
          <Link href="/how-it-works/paper-form" className={styles.footerLink}>
            Print the field worksheet
          </Link>
          .
        </p>
      </footer>
    </main>
  );
}
