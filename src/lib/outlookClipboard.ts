const START_FRAGMENT = "<!--StartFragment-->";
const END_FRAGMENT = "<!--EndFragment-->";

const OUTLOOK_FONT = "Calibri, Arial, sans-serif";

/** Spacer Outlook keeps on paste (margin on &lt;p&gt; is often dropped). */
export function outlookSpacer(heightPx = 12): string {
  return `<div style="height:${heightPx}px;font-size:${heightPx}px;line-height:${heightPx}px;mso-line-height-rule:exactly;">&nbsp;</div>`;
}

/** Outlook-friendly paragraph — explicit spacer after each block. */
export function emailParagraph(innerHtml: string): string {
  return (
    `<p style="margin:0;padding:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0;` +
    `font-family:${OUTLOOK_FONT};font-size:11pt;color:#333;line-height:normal;">` +
    `${innerHtml}</p>${outlookSpacer(12)}`
  );
}

/** Wrap vendor email fragment for clipboard / preview. */
export function wrapEmailHtmlFragment(fragment: string): string {
  return (
    `<div style="font-family:${OUTLOOK_FONT};font-size:11pt;line-height:normal;color:#333;">` +
    `${fragment}</div>`
  );
}

/** HTML for clipboard — NO Version:0.9 header (that line appears as text in Outlook if offsets are wrong). */
function buildClipboardHtml(fragment: string): string {
  return (
    `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word">` +
    `<head><meta charset="utf-8"></head>` +
    `<body>${START_FRAGMENT}${fragment}${END_FRAGMENT}</body></html>`
  );
}

/**
 * Copy HTML via the copy event — sets text/html directly without CF_HTML metadata.
 * Avoids "Version:0.9 StartHTML…" appearing at the top of pasted Outlook emails.
 */
function copyViaCopyEvent(html: string, plain: string): boolean {
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData("text/html", html);
    e.clipboardData?.setData("text/plain", plain);
    e.preventDefault();
  };

  document.addEventListener("copy", onCopy);

  const host = document.createElement("div");
  host.contentEditable = "true";
  host.innerHTML = html;
  host.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;";
  document.body.appendChild(host);
  host.focus();

  const range = document.createRange();
  range.selectNodeContents(host);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }

  document.removeEventListener("copy", onCopy);
  sel?.removeAllRanges();
  document.body.removeChild(host);
  return ok;
}

export async function copyOutlookHtmlToClipboard(
  htmlFragment: string,
  plainFallback: string,
): Promise<void> {
  const wrapped = wrapEmailHtmlFragment(htmlFragment);
  const clipboardHtml = buildClipboardHtml(wrapped);

  if (copyViaCopyEvent(clipboardHtml, plainFallback)) return;

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([clipboardHtml], { type: "text/html" }),
          "text/plain": new Blob([plainFallback], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      /* fall through */
    }
  }

  await navigator.clipboard.writeText(plainFallback);
}
