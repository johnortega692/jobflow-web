import fs from "node:fs";
import path from "node:path";

const file = path.join("node_modules", "niimbot-web-bluetooth", "src", "niimbot.js");
if (!fs.existsSync(file)) process.exit(0);

let src = fs.readFileSync(file, "utf8");
if (src.includes("async function waitForPageEnd")) process.exit(0);

const notify = `  function onNotify(event) {
    const v = event.target.value; // DataView
    if (v.byteLength < 7) return;
    if (v.getUint8(0) !== 0x55 || v.getUint8(1) !== 0x55) return;
    const cmd = v.getUint8(2);
    const len = v.getUint8(3);
    const data = [];
    for (let i = 0; i < len && 4 + i < v.byteLength; i++) data.push(v.getUint8(4 + i));
    logRx(cmd, data);
    const idx = pendingQueue.findIndex((w) => w.cmd === cmd || w.cmd === null);
    if (idx >= 0) {
      const [w] = pendingQueue.splice(idx, 1);
      w.resolve({ cmd, data });
    } else {
      lastUnsolicited = { cmd, data };
    }
  }`;

const notifyPatched = `  function deliverFrame(cmd, data) {
    logRx(cmd, data);
    const idx = pendingQueue.findIndex((w) => w.cmd === cmd || w.cmd === null);
    if (idx >= 0) {
      const [w] = pendingQueue.splice(idx, 1);
      w.resolve({ cmd, data });
    } else {
      lastUnsolicited = { cmd, data };
    }
  }

  // One notification can hold several frames. Keeping only the first drops the
  // page-counter reply when it follows another frame, and the job times out as "page ?".
  function onNotify(event) {
    const v = event.target.value; // DataView
    let offset = 0;
    let frames = 0;
    while (offset + 7 <= v.byteLength && frames < 32) {
      if (v.getUint8(offset) !== 0x55 || v.getUint8(offset + 1) !== 0x55) {
        offset += 1;
        continue;
      }
      const cmd = v.getUint8(offset + 2);
      const len = v.getUint8(offset + 3);
      const frameEnd = offset + 7 + len;
      if (frameEnd > v.byteLength) break;
      const data = [];
      for (let i = 0; i < len; i++) data.push(v.getUint8(offset + 4 + i));
      deliverFrame(cmd, data);
      offset = frameEnd;
      frames += 1;
    }
  }`;

const status = `  async function getPrintStatus(timeoutMs) {
    lastUnsolicited = null;
    let entry;
    const wait = new Promise((resolve) => { entry = registerWait(0xb3, resolve); });
    await send(0xa3, [0x01]);
    const res = await Promise.race([wait, sleep(timeoutMs).then(() => null)]);
    if (!res) clearWait(entry);
    const r = res || (lastUnsolicited && lastUnsolicited.cmd === 0xb3 ? lastUnsolicited : null);
    if (!r || r.data.length < 4) return null;
    return { page: (r.data[0] << 8) | r.data[1], print: r.data[2], feed: r.data[3] };
  }`;

const statusPatched = `  function statusFrom(data) {
    if (!data || data.length < 4) return null;
    return { page: (data[0] << 8) | data[1], print: data[2], feed: data[3] };
  }

  async function getPrintStatus(timeoutMs) {
    const pending = statusFrom(lastUnsolicited && lastUnsolicited.cmd === 0xb3 ? lastUnsolicited.data : null);
    if (pending) {
      lastUnsolicited = null;
      return pending;
    }
    lastUnsolicited = null;
    let entry;
    const wait = new Promise((resolve) => { entry = registerWait(0xb3, resolve); });
    await send(0xa3, [0x01]);
    const res = await Promise.race([wait, sleep(timeoutMs).then(() => null)]);
    if (!res) clearWait(entry);
    const late = lastUnsolicited && lastUnsolicited.cmd === 0xb3 ? lastUnsolicited.data : null;
    if (!res && late) lastUnsolicited = null;
    return statusFrom(res && res.data) || statusFrom(late);
  }`;

if (src.includes(notify)) {
  if (!src.includes(status) || !src.includes("await getPrintStatus(900)")) {
    console.error("niimbot notify patch did not match the installed driver");
    process.exit(1);
  }
  src = src.replace(notify, notifyPatched).replace(status, statusPatched).replace("await getPrintStatus(900)", "await getPrintStatus(2500)");
}

const waitPage = `  async function waitPage(target, onProgress) {
    onProgress && onProgress("printing…");
    const t0 = Date.now();
    _pageSeen = null;
    while (Date.now() - t0 < PAGE_WAIT_MS) {
      const st = await getPrintStatus(2500);
      if (st) {
        _pageSeen = st.page;
        if (st.page !== _lastPage) { tlog(\`printer counter → page \${st.page} (print \${st.print}%, feed \${st.feed}%)\`); _lastPage = st.page; }
        onProgress && onProgress(\`printing… \${st.print}%\`);
        if (st.page >= target) return true;
      }
      await sleep(150);
    }
    return false;
  }`;

const waitPagePatched = `  async function waitPage(target, onProgress) {
    onProgress && onProgress("printing…");
    const t0 = Date.now();
    _pageSeen = null;
    let sawPrint = false;
    while (Date.now() - t0 < PAGE_WAIT_MS) {
      const st = await getPrintStatus(2500);
      if (st) {
        _pageSeen = st.page;
        if (st.print > 0 && st.print < 100) sawPrint = true;
        if (st.page !== _lastPage) { tlog(\`printer counter → page \${st.page} (print \${st.print}%, feed \${st.feed}%)\`); _lastPage = st.page; }
        onProgress && onProgress(\`printing… \${st.print}%\`);
        if (st.page >= target) return true;
        if (sawPrint && st.print >= 100 && st.feed >= 100) return true;
      }
      await sleep(150);
    }
    return false;
  }`;

const finish = `  async function finishJob(model, target, onProgress) {
    const want = Math.max(1, target | 0);
    const reached = await waitPage(want, onProgress);
    await endJob();
    if (!reached) {
      throw unconfirmed(\`printer counter stopped at page \${_pageSeen == null ? "?" : _pageSeen} of \${want} after \${PAGE_WAIT_MS}ms\`);
    }
  }`;

const finishPatched = `  async function finishJob(model, target, onProgress) {
    const want = Math.max(1, target | 0);
    const reached = await waitPage(want, onProgress);
    const end = await sendWait(0xf3, [0x01], 0xf4, 8000);
    const endOk = !!(end && end.data && end.data.length && end.data[0] === 1);
    logAlways(\`PrintEnd \${endOk ? "ok" : "not acknowledged"} page=\${_pageSeen == null ? "?" : _pageSeen}/\${want} row=\${_printRow}\`);
    if (reached || endOk) return;
    throw unconfirmed(\`printer counter stopped at page \${_pageSeen == null ? "?" : _pageSeen} of \${want} after \${PAGE_WAIT_MS}ms; PrintEnd was not acknowledged and the paper did not feed\`);
  }`;

const finishCurrent = `  async function finishJob(model, target, onProgress) {
    const want = Math.max(1, target | 0);
    const reached = await waitPage(want, onProgress);
    const end = await sendWait(0xf3, [0x01], 0xf4, 4000);
    const endOk = !!(end && end.data && end.data.length && end.data[0] === 1);
    logAlways(\`PrintEnd \${endOk ? "ok" : "not acknowledged"} page=\${_pageSeen == null ? "?" : _pageSeen}/\${want}\`);
    if (!reached) {
      throw unconfirmed(\`printer counter stopped at page \${_pageSeen == null ? "?" : _pageSeen} of \${want} after \${PAGE_WAIT_MS}ms; PrintEnd \${endOk ? "was acknowledged but the paper did not finish" : "was not acknowledged and the paper did not feed"}\`);
    }
  }`;

const bitmapOld = `        if (px[i + 3] > 32 && lum < 128) buf[y * stride + (x >> 3)] |= 0x80 >> (x & 7);`;
const bitmapNew = `        if (px[i + 3] > 32 && lum < 128) {
          buf[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
          black++;
        }`;

const beginOld = `  async function beginJob(model, totalPages, onProgress, density) {
    onProgress && onProgress("configuring…");
    await sendWait(0x21, [density], 0x31, 1000);                             // SetDensity
    await sendWait(0x23, [model.label_type], 0x33, 1000);                   // SetLabelType
    const n = Math.max(1, totalPages | 0);
    const start = isB1(model)
      ? [(n >> 8) & 0xff, n & 0xff, 0, 0, 0, 0, 0]                          // printStart 7b
      : [(n >> 8) & 0xff, n & 0xff, 0, 0, 0, 0, 0, model.speed, 0];         // printStart 9b (…, speed, flag)
    await sendWait(0x01, start, 0x02, 2000);                                // PrintStart
  }`;

const beginNew = `  // A setup reply is success only when data[0] === 1. Any other payload, a 0xDB
  // print-error, or silence means the printer did not accept that step. Do not
  // continue, and do not send the command again.
  function refused(name, res) {
    if (res && res.cmd === 0xdb) return \`\${name} refused, printer error db \${hex(res.data || [])}\`;
    if (!res) {
      const err = lastUnsolicited && lastUnsolicited.cmd === 0xdb ? lastUnsolicited : null;
      if (err) { lastUnsolicited = null; return \`\${name} refused, printer error db \${hex(err.data || [])}\`; }
      return \`\${name} got no response\`;
    }
    if (!res.data || !res.data.length || res.data[0] !== 1) return \`\${name} refused (\${hex(res.data || [])})\`;
    logAlways(\`\${name} ok \${hex(res.data || [])}\`);
    return "";
  }
  function requireAccepted(name, res) {
    const why = refused(name, res);
    if (why) throw new Error(\`print stopped at \${why}\`);
  }

  async function beginJob(model, totalPages, onProgress, density) {
    onProgress && onProgress("configuring…");
    requireAccepted("SetDensity", await sendWait(0x21, [density], 0x31, 1000));
    requireAccepted("SetLabelType", await sendWait(0x23, [model.label_type], 0x33, 1000));
    const n = Math.max(1, totalPages | 0);
    const start = isB1(model)
      ? [(n >> 8) & 0xff, n & 0xff, 0, 0, 0, 0, 0]                          // printStart 7b
      : [(n >> 8) & 0xff, n & 0xff, 0, 0, 0, 0, 0, model.speed, 0];         // printStart 9b (…, speed, flag)
    requireAccepted("PrintStart", await sendWait(0x01, start, 0x02, 2000));
    logAlways(\`PrintStart pages=\${n} labelType=\${model.label_type} task=\${model.task || "?"}\`);
  }`;

const pageOld = `    if (isB1(model)) {
      await sendWait(0x03, [0x01], 0x04, 1000);                             // PageStart (B1 only)
      await sendWait(0x13, [
        (H >> 8) & 0xff, H & 0xff, (W >> 8) & 0xff, W & 0xff, (c >> 8) & 0xff, c & 0xff,
      ], 0x14, 2000);                                                       // SetPageSize 6b (rows, cols, copies)
    } else {`;

const pageNew = `    logAlways(\`page \${W}×\${H}px copies=\${c}\`);
    if (isB1(model)) {
      requireAccepted("PageStart", await sendWait(0x03, [0x01], 0x04, 1000));
      requireAccepted("SetPageSize", await sendWait(0x13, [
        (H >> 8) & 0xff, H & 0xff, (W >> 8) & 0xff, W & 0xff, (c >> 8) & 0xff, c & 0xff,
      ], 0x14, 2000));                                                      // SetPageSize 6b (rows, cols, copies)
    } else {`;

const endOld = `    await sendImage(buf, H, stride);                                         // shared total-mode 0x84/0x85 encoder

    if (deferAck) return { ackPromise: sendPageEndAsync(tag) };

    // RETURN whether PageEnd was acknowledged. Discarding this is how a page that the
    // printer never confirmed still got logged as buffered and acked, directly under the
    // ⚠ warning saying it had not been.
    const ackT0 = Date.now();
    const pageEnd = await sendWait(0xe3, [0x01], 0xe4, PAGE_ACK_MS);          // PageEnd (0xE3)
    const ackMs = Date.now() - ackT0;
    const prefix = tag ? \`\${tag}: \` : "";
    tlog(pageEnd != null
      ? \`\${prefix}PageEnd acked in \${ackMs} ms\`
      : \`\${prefix}PageEnd UNACKED after \${ackMs} ms (PAGE_ACK_MS)\`);
    return pageEnd != null;`;

const endTimed = `    await sendImage(buf, H, stride);                                         // shared total-mode 0x84/0x85 encoder
    logAlways(\`image sent \${H} rows\`);

    if (deferAck) return { ackPromise: sendPageEndAsync(tag) };

    const ackT0 = Date.now();
    const pageEnd = await sendWait(0xe3, [0x01], 0xe4, PAGE_ACK_MS);          // PageEnd (0xE3)
    const ackMs = Date.now() - ackT0;
    const why = refused("PageEnd", pageEnd);
    logAlways(why ? \`print stopped at \${why} after \${ackMs}ms\` : \`PageEnd ok in \${ackMs}ms\`);
    if (why) {
      await endJob();
      throw new Error(\`print stopped at \${why} after \${ackMs}ms. PrintEnd was sent once to release the printer; the label did not feed.\`);
    }
    return true;`;

const endNew = `    await sendImage(buf, H, stride);                                         // shared total-mode 0x84/0x85 encoder
    logAlways(\`image sent \${H} rows\`);

    if (deferAck) return { ackPromise: sendPageEndAsync(tag) };

    const pageEnd = await waitForPageEnd(H);
    if (!pageEnd) {
      const where = _printRow < 0 ? "before any row printed" : \`while printing row \${_printRow} of \${H}\`;
      await endJob();
      throw new Error(\`print stopped at PageEnd \${where}. PrintEnd was sent once to release the printer; the label did not feed.\`);
    }
    return true;`;

const pageEndWait = `  let _printRow = -1;
  async function nextPacket(timeoutMs) {
    if (lastUnsolicited) {
      const pending = lastUnsolicited;
      lastUnsolicited = null;
      return pending;
    }
    let entry;
    const wait = new Promise((resolve) => { entry = registerWait(null, resolve); });
    const res = await Promise.race([wait, sleep(timeoutMs).then(() => null)]);
    if (!res) clearWait(entry);
    if (!res && lastUnsolicited) {
      const late = lastUnsolicited;
      lastUnsolicited = null;
      return late;
    }
    return res;
  }

  // 0xD3 is the B1's row counter. On an 80 mm label it is still climbing when a
  // fixed 10s PageEnd wait gives up, and 0xE4 arrives only after the last row.
  // Keep waiting while that counter moves. Stop only when it stalls or never starts.
  async function waitForPageEnd(height) {
    lastUnsolicited = null;
    await send(0xe3, [0x01]);
    const started = Date.now();
    _printRow = -1;
    let lastMove = started;
    const hardCap = Math.max(PAGE_ACK_MS, 45000);
    while (Date.now() - started < hardCap) {
      const pkt = await nextPacket(400);
      if (pkt && pkt.cmd === 0xe4) {
        const why = refused("PageEnd", pkt);
        if (why) {
          logAlways(\`print stopped at \${why} after \${Date.now() - started}ms row=\${_printRow}\`);
          return null;
        }
        logAlways(\`PageEnd ok in \${Date.now() - started}ms row=\${_printRow} of \${height}\`);
        return pkt;
      }
      if (pkt && pkt.cmd === 0xd3 && pkt.data && pkt.data.length >= 2) {
        const row = (pkt.data[0] << 8) | pkt.data[1];
        if (row !== _printRow) {
          _printRow = row;
          lastMove = Date.now();
          logAlways(\`printing row \${row} of \${height}\`);
        }
      } else if (pkt && pkt.cmd === 0xdb) {
        logAlways(\`print stopped at PageEnd refused, printer error db \${hex(pkt.data || [])}\`);
        return null;
      }
      if (_printRow < 0 && Date.now() - started >= PAGE_ACK_MS) return null;
      if (_printRow >= 0 && _printRow < height - 1 && Date.now() - lastMove >= 5000) return null;
    }
    logAlways(\`print stopped at PageEnd after \${Date.now() - started}ms row=\${_printRow} of \${height}\`);
    return null;
  }

  async function sendPagePacked(model, size, buf, stride, copies, onProgress, tag, deferAck) {`;

const finishFalse = `  async function finishJob(model, target, onProgress) {
    const want = Math.max(1, target | 0);
    const reached = await waitPage(want, onProgress);
    // PageEnd already parked the label. PrintEnd is what feeds it out, and a B1 often
    // never sends a page counter for that. An acknowledged PrintEnd, or a counter that
    // never spoke at all, means the label was fed. A counter that did speak and stopped
    // short is a real stall.
    const end = await sendWait(0xf3, [0x01], 0xf4, 4000);
    if (reached || end || _pageSeen == null) return;
    throw unconfirmed(\`printer counter stopped at page \${_pageSeen} of \${want} after \${PAGE_WAIT_MS}ms\`);
  }`;

if (src.includes(waitPage)) src = src.replace(waitPage, waitPagePatched);
if (src.includes(finish)) src = src.replace(finish, finishPatched);
if (src.includes(finishFalse)) src = src.replace(finishFalse, finishPatched);
if (src.includes(finishCurrent)) src = src.replace(finishCurrent, finishPatched);
src = src
  .replaceAll(
    "if (!await waitPage(want, (s) => onProgress && onProgress(`${tag}: ${s}`)) && _pageSeen != null) {",
    "if (!await waitPage(want, (s) => onProgress && onProgress(`${tag}: ${s}`))) {",
  )
  .replaceAll(
    "if (!problem && !await waitPage(N, onProgress) && _pageSeen != null) {",
    "if (!problem && !await waitPage(N, onProgress)) {",
  );
if (!src.includes("let black = 0;")) {
  src = src.replace(
    "    const buf = new Uint8Array(stride * h);\n    for (let y = 0; y < h; y++) {",
    "    const buf = new Uint8Array(stride * h);\n    let black = 0;\n    for (let y = 0; y < h; y++) {",
  );
}
if (src.includes(bitmapOld)) src = src.replace(bitmapOld, bitmapNew);
if (src.includes(beginOld)) src = src.replace(beginOld, beginNew);
if (src.includes(pageOld)) src = src.replace(pageOld, pageNew);
if (src.includes(endOld)) src = src.replace(endOld, endNew);
if (src.includes(endTimed)) src = src.replace(endTimed, endNew);
if (!src.includes("async function waitForPageEnd")) {
  src = src.replace(
    "  async function sendPagePacked(model, size, buf, stride, copies, onProgress, tag, deferAck) {",
    pageEndWait,
  );
}
src = src.replace(
  "return new Error(`print not confirmed: ${reason}. PrintEnd was sent, so the paper has been fed out — check the labels, they may be blank, short or repeated.`);",
  "return new Error(`print not confirmed: ${reason}`);",
);
if (!src.includes("function refused(name, res)") || !src.includes("async function waitForPageEnd") || src.includes("_pageSeen == null) return")) {
  console.error("niimbot finish patch did not match the installed driver");
  process.exit(1);
}
fs.writeFileSync(file, src);
