import type { ComposeEmailMethod } from "../../lib/paintUserSettings";

type Props = {
  compact?: boolean;
  method?: ComposeEmailMethod;
};

/** Email setup notes for desktop browsers. */
export function MailtoSetupHelp({ compact = false, method = "gmail" }: Props) {
  if (compact) {
    return (
      <p className="muted small mailto-setup-help mailto-setup-help--compact">
        {method === "mailto" ? (
          <>
            Opens compose in a <strong>new tab</strong> via MAILTO (empty body). Formatted <strong>HTML only</strong>{" "}
            is copied — press <strong>Ctrl+V</strong> in the body. See Settings for Gmail MAILTO setup.
          </>
        ) : (
          <>
            Opens <strong>Gmail compose</strong> in a new tab (empty body). Formatted <strong>HTML only</strong> is
            copied — press <strong>Ctrl+V</strong> after it opens. Allow pop-ups for this site.
          </>
        )}
      </p>
    );
  }

  return (
    <section className="stack mailto-setup-help settings-mailto-panel">
      <h2>Email on computers</h2>
      <p className="muted small">
        <strong>Order Brushouts</strong> and transmittal relay copy <strong>formatted HTML</strong> to your clipboard,
        then open an <strong>empty</strong> compose window (to, cc, subject only). Press <strong>Ctrl+V</strong> in
        the message body for tables and signature — not plain text.
      </p>
      {method === "gmail" ? (
        <p className="muted small">
          <strong>Gmail</strong> opens <code>mail.google.com</code> compose in a new Chrome tab (allow pop-ups for
          this site).
        </p>
      ) : (
        <p className="muted small">
          <strong>MAILTO</strong> opens compose in a <strong>new tab</strong> when Chrome and Gmail are configured
          below. JobFlow stays open in the original tab.
        </p>
      )}
      <p className="muted small">
        Dashboard contact links always use <strong>mailto:</strong>. Automated paint tracker digests use the{" "}
        <strong>Dashboard Web App URL</strong> (Settings → Google Apps Script URLs).
      </p>
      {method === "mailto" ? (
        <>
          <h3 className="mailto-setup-help-subhead">Windows default app (MAILTO)</h3>
          <ol className="mailto-setup-steps muted small">
            <li>
              Open <strong>Settings</strong> → <strong>Apps</strong> → <strong>Default apps</strong> → search{" "}
              <strong>MAILTO</strong> (or <strong>Choose defaults by protocol</strong>).
            </li>
            <li>
              Set <strong>MAILTO</strong> to <strong>Outlook</strong> for desktop Outlook, or{" "}
              <strong>Google Chrome</strong> for web Gmail — then complete the Chrome steps below.
            </li>
            <li>
              If <code>mailto:</code> links still open Outlook, repeat this step and choose{" "}
              <strong>Google Chrome</strong> (or your preferred browser).
            </li>
            <li>Stay signed into your work email in that app or Chrome profile.</li>
          </ol>

          <h3 className="mailto-setup-help-subhead">Check Chrome&apos;s mail handler setting</h3>
          <ol className="mailto-setup-steps muted small">
            <li>
              Open <strong>Chrome</strong>.
            </li>
            <li>
              Go to <code>chrome://settings/handlers</code> (paste in the address bar).
            </li>
            <li>
              Turn on <strong>Sites can ask to handle protocols</strong>.
            </li>
            <li>
              Under allowed handlers, <strong>Gmail</strong> should appear if it has been registered (see below).
            </li>
          </ol>

          <h3 className="mailto-setup-help-subhead">Register Gmail as the mail handler</h3>
          <ol className="mailto-setup-steps muted small">
            <li>
              Open <strong>Gmail</strong> (<code>mail.google.com</code>) in the same Chrome profile you use for
              JobFlow.
            </li>
            <li>
              Look for the <strong>double-diamond / handler icon</strong> in the address bar (right side).
            </li>
            <li>
              Click it and select <strong>Allow mail.google.com to open all email links</strong>, then{" "}
              <strong>Done</strong>.
            </li>
          </ol>

          <h3 className="mailto-setup-help-subhead">If Gmail isn&apos;t listed</h3>
          <ol className="mailto-setup-steps muted small">
            <li>Open Gmail in Chrome.</li>
            <li>
              Press <strong>F12</strong> → <strong>Console</strong>.
            </li>
            <li>
              Run:
              <pre className="mailto-setup-code">
{`navigator.registerProtocolHandler(
  "mailto",
  "https://mail.google.com/mail/?extsrc=mailto&url=%s",
  "Gmail"
);`}
              </pre>
            </li>
            <li>Accept the prompt when Chrome asks to allow Gmail to handle email links.</li>
          </ol>

          <h3 className="mailto-setup-help-subhead">Outlook desktop (one step)</h3>
          <p className="muted small">
            Set Windows <strong>MAILTO</strong> to <strong>Outlook</strong> only — no Chrome handler steps needed.
          </p>

          <h3 className="mailto-setup-help-subhead">Quick test</h3>
          <p className="muted small">
            On a project dashboard, click a contact&apos;s <strong>email</strong> link. Gmail compose should open in a{" "}
            <strong>new tab</strong>. Then try <strong>Order Brushouts</strong> in JobFlow — compose should also open in a
            new tab; press <strong>Ctrl+V</strong> for HTML.
          </p>
          <p className="muted small">
            MAILTO opens compose with <strong>no body text</strong> — same as Gmail mode. Paste HTML with Ctrl+V.
          </p>
        </>
      ) : (
        <>
          <h3 className="mailto-setup-help-subhead">If Gmail does not open</h3>
          <ol className="mailto-setup-steps muted small">
            <li>Use JobFlow in <strong>Chrome</strong> (normal browser window).</li>
            <li>
              Allow <strong>pop-ups</strong> for this site (icon in the address bar).
            </li>
            <li>Stay signed into <strong>work Gmail</strong> in that Chrome profile.</li>
            <li>
              Or switch compose to <strong>MAILTO</strong> above and follow the Gmail MAILTO steps in this section.
            </li>
          </ol>
        </>
      )}
    </section>
  );
}
