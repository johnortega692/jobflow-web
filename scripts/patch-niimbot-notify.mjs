import fs from "node:fs";
import path from "node:path";

const file = path.join("node_modules", "niimbot-web-bluetooth", "src", "niimbot.js");
if (!fs.existsSync(file)) process.exit(0);

let src = fs.readFileSync(file, "utf8");
if (src.includes("batch streams the next page during the print")) process.exit(0);

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

const finishBeforeStatus = `  async function finishJob(model, target, onProgress) {
    const want = Math.max(1, target | 0);
    if (!_pageAck) {
      throw unconfirmed(\`PageEnd was not acknowledged (printed row \${_printRow} of \${_pageRows}). PrintEnd was not sent\`);
    }
    onProgress && onProgress("feeding…");
    stamp(\`PrintEnd f3 sent\`);
    await send(0xf3, [0x01]);
    const feedStart = Date.now();
    const feedLimit = Math.min(20000, Math.max(8000, COMPLETION_MS | 0));
    let feedAck = false;
    while (Date.now() - feedStart < feedLimit) {
      const pkt = await nextPacket(400);
      if (!pkt) continue;
      if (pkt.cmd === 0xd3 && pkt.data && pkt.data.length >= 2) noteRow(pkt.data, _pageRows);
      else if (pkt.cmd === 0xf4) {
        feedAck = !!(pkt.data && pkt.data.length && pkt.data[0] === 1);
        stamp(\`PrintEnd f4 \${hex(pkt.data || [])} after \${Date.now() - feedStart}ms\`);
        break;
      }
    }
    const printed = _printRow >= _pageRows - 1;
    stamp(\`completion stamped row=\${_printRow}/\${_pageRows} pageAck=true feedAck=\${feedAck} printed=\${printed} pages=\${want}\`);
    if (!printed) {
      throw unconfirmed(\`commands were acknowledged but the printer only reached row \${_printRow} of \${_pageRows}, so the label was not printed\`);
    }
    if (!feedAck) {
      throw unconfirmed(\`the printer reached row \${_printRow} of \${_pageRows} but did not acknowledge the feed\`);
    }
  }`;

const finishPatched = `  async function finishJob(model, target, onProgress) {
    const want = Math.max(1, target | 0);
    if (!_pageAck) {
      throw unconfirmed(\`PageEnd was not acknowledged (printed row \${_printRow} of \${_pageRows}). PrintEnd was not sent\`);
    }
    // status poll before PrintEnd. NiimBlue B1PrintTask waits until 0xA3 -> 0xB3
    // reports page == totalPages, and only then sends 0xF3. 0xE4 accepts the page
    // command. 0xF4 accepts the feed command. Neither one means the label fed.
    onProgress && onProgress("printing…");
    const limit = Math.min(60000, Math.max(15000, COMPLETION_MS | 0));
    const pollStart = Date.now();
    stamp(\`PrintStatus poll, waiting up to \${limit}ms for page \${want} before PrintEnd\`);
    let statusOk = _statusPage === want;
    while (!statusOk && Date.now() - pollStart < limit) {
      await send(0xa3, [0x01]);
      const slice = Date.now();
      while (Date.now() - slice < 250) {
        const pkt = await nextPacket(80);
        if (!pkt) continue;
        if (pkt.cmd === 0xd3 && pkt.data && pkt.data.length >= 2) noteRow(pkt.data, _pageRows);
        else if (pkt.cmd === 0xb3 && pkt.data && pkt.data.length >= 4) noteStatus(pkt.data);
        else if (pkt.cmd === 0xdb) {
          stamp(\`print status error db \${hex(pkt.data || [])}\`);
          break;
        }
      }
      statusOk = _statusPage === want;
    }
    stamp(\`PrintStatus after \${Date.now() - pollStart}ms page=\${_statusPage}/\${want} print=\${_statusPrint}% feed=\${_statusFeed}% row=\${_printRow}/\${_pageRows}\`);
    onProgress && onProgress("feeding…");
    stamp(\`PrintEnd f3 sent\`);
    await send(0xf3, [0x01]);
    const feedStart = Date.now();
    const feedLimit = Math.min(20000, Math.max(8000, COMPLETION_MS | 0));
    let feedAck = false;
    while (Date.now() - feedStart < feedLimit) {
      const pkt = await nextPacket(400);
      if (!pkt) continue;
      if (pkt.cmd === 0xd3 && pkt.data && pkt.data.length >= 2) noteRow(pkt.data, _pageRows);
      else if (pkt.cmd === 0xb3 && pkt.data && pkt.data.length >= 4) noteStatus(pkt.data);
      else if (pkt.cmd === 0xf4) {
        feedAck = !!(pkt.data && pkt.data.length && pkt.data[0] === 1);
        stamp(\`PrintEnd f4 \${hex(pkt.data || [])} after \${Date.now() - feedStart}ms\`);
        break;
      }
    }
    const printed = _printRow >= _pageRows - 1;
    stamp(\`completion stamped row=\${_printRow}/\${_pageRows} page=\${_statusPage}/\${want} pageAck=true feedAck=\${feedAck} printed=\${printed}\`);
    if (!statusOk) {
      throw unconfirmed(\`the printer did not report page \${want} finished (last status page \${_statusPage}, row \${_printRow} of \${_pageRows}). PrintEnd was sent once and the job was not sent again\`);
    }
    if (!printed) {
      throw unconfirmed(\`page status reached \${want} but the row counter only reached \${_printRow} of \${_pageRows}, so the label was not printed\`);
    }
    if (!feedAck) {
      throw unconfirmed(\`the printer reached row \${_printRow} of \${_pageRows} but did not acknowledge the feed\`);
    }
  }`;

const finishFed = `  async function finishJob(model, target, onProgress) {
    const want = Math.max(1, target | 0);
    // 0xE4 already accepted the page. 0xF3 [1] -> 0xF4 [1] is the feed in the
    // niimbot-web-bluetooth b1 sequence. This B1 does not send 0xB3 before that,
    // and waiting for the page counter leaves the label parked under the head.
    onProgress && onProgress("feeding…");
    const end = await sendWait(0xf3, [0x01], 0xf4, 8000);
    const endOk = !!(end && end.data && end.data.length && end.data[0] === 1);
    logAlways(\`feed after PageEnd row=\${_printRow} pages=\${want} PrintEnd \${endOk ? "ok " + hex(end.data || []) : "not acknowledged"}\`);
    if (!endOk) {
      throw unconfirmed(\`PrintEnd (0xF3) was not acknowledged, so the label was not fed (printed row \${_printRow} of the page)\`);
    }
  }`;

const finishWait = `  async function finishJob(model, target, onProgress) {
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

    _pageRows = H;
    if (deferAck) return { ackPromise: sendPageEndAsync(tag) };

    const pageEnd = await waitForPageEnd(H);
    if (!pageEnd) {
      const where = _printRow < 0 ? "before any row printed" : \`while printing row \${_printRow} of \${H}\`;
      throw new Error(\`print stopped at PageEnd \${where}. PrintEnd was not sent.\`);
    }
    return true;`;

const endAbort = `    await sendImage(buf, H, stride);                                         // shared total-mode 0x84/0x85 encoder
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
  let _pageRows = 0;
  let _pageAck = false;
  let _statusPage = -1;
  let _statusPrint = -1;
  let _statusFeed = -1;
  let COMPLETION_MS = 45000;
  function stamp(m) {
    const d = new Date();
    const p = (n, w = 2) => String(n).padStart(w, "0");
    const clock = \`\${p(d.getHours())}:\${p(d.getMinutes())}:\${p(d.getSeconds())}.\${p(d.getMilliseconds(), 3)}\`;
    logAlways(\`\${clock} t+\${Date.now() - (_t0 || Date.now())}ms \${m}\`);
  }
  function noteRow(data, height) {
    const row = (data[0] << 8) | data[1];
    const flag = data.length > 2 ? data[2] : -1;
    if (row !== _printRow) _printRow = row;
    stamp(\`d3 \${hex(data)} = printed row \${row} of \${height} flag=\${flag}\`);
    return row;
  }
  function noteStatus(data) {
    _statusPage = (data[0] << 8) | data[1];
    _statusPrint = data[2];
    _statusFeed = data.length > 3 ? data[3] : -1;
    stamp(\`b3 page=\${_statusPage} print=\${_statusPrint}% feed=\${_statusFeed}% row=\${_printRow}\`);
  }
  async function nextPacket(timeoutMs) {
    if (rxQueue.length) return rxQueue.shift();
    lastUnsolicited = null;
    let entry;
    const wait = new Promise((resolve) => { entry = registerWait(null, resolve); });
    const res = await Promise.race([wait, sleep(timeoutMs).then(() => null)]);
    if (!res) clearWait(entry);
    if (rxQueue.length) return rxQueue.shift();
    return res;
  }

  // Protocol 3: PageEnd (0xE3 -> 0xE4) must be acknowledged before PrintEnd (0xF3).
  // 0xD3 is the printed-row counter, big-endian. 00 c7 01 is row 199, not an error.
  // e4 and f4 on this B1 arrive after the row counter reaches the last line.
  async function waitForPageEnd(height) {
    _pageRows = height;
    _pageAck = false;
    _printRow = -1;
    _statusPage = -1;
    _statusPrint = -1;
    _statusFeed = -1;
    rxQueue.length = 0;
    lastUnsolicited = null;
    const limit = Math.min(60000, Math.max(15000, COMPLETION_MS | 0));
    stamp(\`PageEnd e3 sent, waiting up to \${limit}ms for e4 before PrintEnd\`);
    await send(0xe3, [0x01]);
    const started = Date.now();
    while (Date.now() - started < limit) {
      const pkt = await nextPacket(400);
      if (!pkt) continue;
      if (pkt.cmd === 0xd3 && pkt.data && pkt.data.length >= 2) noteRow(pkt.data, height);
      else if (pkt.cmd === 0xb3 && pkt.data && pkt.data.length >= 4) noteStatus(pkt.data);
      else if (pkt.cmd === 0xe4) {
        const why = refused("PageEnd", pkt);
        stamp(why
          ? \`PageEnd e4 refused \${hex(pkt.data || [])} after \${Date.now() - started}ms row=\${_printRow}\`
          : \`PageEnd e4 \${hex(pkt.data || [])} after \${Date.now() - started}ms row=\${_printRow} of \${height}\`);
        if (why) return null;
        _pageAck = true;
        return pkt;
      } else if (pkt.cmd === 0xdb) {
        stamp(\`PageEnd refused, printer error db \${hex(pkt.data || [])}\`);
        return null;
      }
    }
    stamp(\`PageEnd timed out after \${Date.now() - started}ms row=\${_printRow} of \${height}; PrintEnd not sent\`);
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
if (src.includes(finishBeforeStatus)) src = src.replace(finishBeforeStatus, finishPatched);
if (src.includes(finish)) src = src.replace(finish, finishPatched);
if (src.includes(finishFalse)) src = src.replace(finishFalse, finishPatched);
if (src.includes(finishCurrent)) src = src.replace(finishCurrent, finishPatched);
if (src.includes(finishWait)) src = src.replace(finishWait, finishPatched);
if (src.includes(finishFed)) src = src.replace(finishFed, finishPatched);
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
if (src.includes(endAbort)) src = src.replace(endAbort, endNew);
if (!src.includes("async function waitForPageEnd")) {
  src = src.replace(
    "  async function sendPagePacked(model, size, buf, stride, copies, onProgress, tag, deferAck) {",
    pageEndWait,
  );
}
if (!src.includes("let rxQueue")) {
  src = src.replace(
    "let lastUnsolicited = null; // last unsolicited response (e.g. status during the poll)",
    "let lastUnsolicited = null; // last unsolicited response (e.g. status during the poll)\n  let rxQueue = [];",
  );
}
src = src.replace(
  `    } else {
      lastUnsolicited = { cmd, data };
    }`,
  `    } else {
      const pkt = { cmd, data };
      rxQueue.push(pkt);
      if (rxQueue.length > 32) rxQueue.shift();
      lastUnsolicited = pkt;
    }`,
);
if (!src.includes("get COMPLETION_MS()")) {
  src = src.replace(
    "get PAGE_ACK_MS() { return PAGE_ACK_MS; }, set PAGE_ACK_MS(v) { PAGE_ACK_MS = Math.max(1, v | 0); },",
    "get PAGE_ACK_MS() { return PAGE_ACK_MS; }, set PAGE_ACK_MS(v) { PAGE_ACK_MS = Math.max(1, v | 0); },\n    get COMPLETION_MS() { return COMPLETION_MS; }, set COMPLETION_MS(v) { COMPLETION_MS = Math.min(60000, Math.max(8000, v | 0)); },",
  );
}
src = src.replace(/async function waitForPageEnd\(height\) \{[\s\S]*?\n  \}\n/, `${pageEndWait.match(/async function waitForPageEnd\(height\) \{[\s\S]*\n  \}\n/)[0]}`);
if (!src.includes("function stamp(m)")) {
  const helpers = pageEndWait.slice(pageEndWait.indexOf("  let _pageRows"), pageEndWait.indexOf("  async function nextPacket"));
  src = src.replace("  async function waitForPageEnd(height) {", `${helpers}  async function waitForPageEnd(height) {`);
}
if (!src.includes("let _statusPage")) {
  src = src.replace(
    "  let _pageAck = false;",
    "  let _pageAck = false;\n  let _statusPage = -1;\n  let _statusPrint = -1;\n  let _statusFeed = -1;",
  );
}
if (!src.includes("function noteStatus(")) {
  src = src.replace(
    "  async function nextPacket(timeoutMs) {",
    "  function noteStatus(data) {\n    _statusPage = (data[0] << 8) | data[1];\n    _statusPrint = data[2];\n    _statusFeed = data.length > 3 ? data[3] : -1;\n    stamp(`b3 page=${_statusPage} print=${_statusPrint}% feed=${_statusFeed}% row=${_printRow}`);\n  }\n  async function nextPacket(timeoutMs) {",
  );
}
const nextPacketNew = pageEndWait.match(/async function nextPacket\(timeoutMs\) \{[\s\S]*?\n  \}\n/);
if (nextPacketNew && !src.includes("if (rxQueue.length) return rxQueue.shift();")) {
  src = src.replace(/async function nextPacket\(timeoutMs\) \{[\s\S]*?\n  \}\n/, nextPacketNew[0]);
}
src = src.replace(
  "logAlways(`printing row ${row} of ${height}`);",
  "logAlways(`d3 ${hex(pkt.data)} = printed row ${row} of ${height}`);",
);
const sendImageOld = `  async function sendImage(buf, h, stride) {
    let r = 0;
    while (r < h) {`;
const sendImageNew = `  async function sendImage(buf, h, stride) {
    let r = 0;
    let packets = 0;
    let covered = 0;
    while (r < h) {`;
if (src.includes(sendImageOld) && !src.includes("let packets = 0;")) src = src.replace(sendImageOld, sendImageNew);
if (!src.includes("function niimblueCounts(")) {
  src = src.replace(
    "  async function sendImage(buf, h, stride) {",
    `  // niimblue row counts. A 384-dot row is 48 bytes and uses three segment counts.
  // A 50 mm row is 400 px, 50 bytes, which does not fit and uses total mode [0, lo, hi].
  function niimblueCounts(buf, off, stride, total) {
    const chunkSize = Math.floor(384 / 8 / 3);
    if (stride > chunkSize * 3) return [0, total & 0xff, (total >> 8) & 0xff];
    const parts = [0, 0, 0];
    for (let b = 0; b < stride; b++) {
      let v = buf[off + b];
      const chunk = Math.floor(b / chunkSize);
      while (v) { if (v & 1) parts[chunk]++; v >>= 1; }
    }
    return parts;
  }
  function indexBlackPixels(buf, off, stride) {
    const out = [];
    for (let b = 0; b < stride; b++) {
      const v = buf[off + b];
      for (let bit = 0; bit < 8; bit++) {
        if (v & (0x80 >> bit)) {
          const pos = b * 8 + bit;
          out.push((pos >> 8) & 0xff, pos & 0xff);
        }
      }
    }
    return out;
  }
  async function sendImage(buf, h, stride) {`,
  );
}
const rowTotal = `      } else {
        const total = popcountRow(buf, off, stride);
        const data = new Array(6 + stride);
        data[0] = (r >> 8) & 0xff; data[1] = r & 0xff; data[2] = 0;
        data[3] = total & 0xff; data[4] = (total >> 8) & 0xff; data[5] = run;
        for (let b = 0; b < stride; b++) data[6 + b] = buf[off + b];
        await sendBundled(0x85, data);
      }`;
const rowNiim = `      } else {
        const total = popcountRow(buf, off, stride);
        const counts = niimblueCounts(buf, off, stride, total);
        const head = [(r >> 8) & 0xff, r & 0xff, counts[0], counts[1], counts[2], run];
        if (total <= 6) {
          await sendBundled(0x83, head.concat(indexBlackPixels(buf, off, stride)));
        } else {
          const data = head.slice();
          for (let b = 0; b < stride; b++) data.push(buf[off + b]);
          await sendBundled(0x85, data);
        }
      }`;
if (src.includes(rowTotal)) src = src.replace(rowTotal, rowNiim);
src = src.replace(
  `      r += run;
    }
    await flushBundle();   // push any rows still pending before PageEnd
  }`,
  `      packets++;
      covered += run;
      r += run;
    }
    await flushBundle();   // push any rows still pending before PageEnd
    let black = 0;
    for (let i = 0; i < buf.length; i++) { let v = buf[i]; while (v) { black += v & 1; v >>= 1; } }
    logAlways(\`image packets=\${packets} rows=\${covered}/\${h} black=\${black} stride=\${stride}\`);
    if (covered !== h) throw new Error(\`image covered \${covered} of \${h} rows\`);
  }`,
);
src = src.replace(
  "return new Error(`print not confirmed: ${reason}. PrintEnd was sent, so the paper has been fed out — check the labels, they may be blank, short or repeated.`);",
  "return new Error(`print not confirmed: ${reason}`);",
);
if (!src.includes("_pageRows = H;")) {
  src = src.replace(
    "    if (deferAck) return { ackPromise: sendPageEndAsync(tag) };",
    "    _pageRows = H;\n    if (deferAck) return { ackPromise: sendPageEndAsync(tag) };",
  );
}
const pageEndAsyncOld = `  async function sendPageEndAsync(tag) {
    const ackT0 = Date.now();
    const pageEnd = await sendWait(0xe3, [0x01], 0xe4, PAGE_ACK_MS);          // PageEnd (0xE3)
    const ackMs = Date.now() - ackT0;
    const prefix = tag ? \`\${tag}: \` : "";
    tlog(pageEnd != null
      ? \`\${prefix}PageEnd acked in \${ackMs} ms\`
      : \`\${prefix}PageEnd UNACKED after \${ackMs} ms (PAGE_ACK_MS)\`);
    return pageEnd != null;
  }`;
const pageEndAsyncNew = `  async function sendPageEndAsync(tag) {
    const limit = Math.min(60000, Math.max(15000, COMPLETION_MS | 0));
    const ackT0 = Date.now();
    stamp(\`PageEnd e3 sent, waiting up to \${limit}ms for e4 while the next page is sent\`);
    const pageEnd = await sendWait(0xe3, [0x01], 0xe4, limit);
    const ackMs = Date.now() - ackT0;
    const prefix = tag ? \`\${tag}: \` : "";
    const why = refused("PageEnd", pageEnd);
    stamp(why
      ? \`\${prefix}PageEnd e4 missing after \${ackMs}ms row=\${_printRow}\`
      : \`\${prefix}PageEnd e4 \${hex((pageEnd && pageEnd.data) || [])} after \${ackMs}ms row=\${_printRow}\`);
    return !why;
  }`;
if (src.includes(pageEndAsyncOld)) src = src.replace(pageEndAsyncOld, pageEndAsyncNew);
const batchOld = `    // Single job for the whole batch (both tasks): pages stream back-to-back, no
    // retract between. The B1 (protocol 3) supports this natively — printStart7b
    // with totalPages>1 parks the paper at the printhead after each PageEnd and only
    // feeds out on the final PrintEnd (verified against niimbluelib's B1PrintTask).
    await beginJob(model, N, onProgress, density);`;
const batchNew = `    // batch streams the next page during the print. 0xE4 on this B1 arrives with
    // the last printed row, so waiting for it before the next image leaves a gap
    // and a separate PrintEnd retracts the paper. One PrintEnd feeds the batch.
    await beginJob(model, N, onProgress, density);`;
if (src.includes(batchOld)) src = src.replace(batchOld, batchNew);
const batchLoopOld = `    tlog(\`job started (\${N} pages)\`);
    // Anything that means "the printer stopped confirming" stops the loop. Sending more
    // pages into a printer that is not keeping up is how a batch ends up short AND
    // desynchronised — the 4-of-5 run on 2026-08-13 came out with every label numbered 1.
    let problem = null;
    for (let i = 0; i < N && !problem; i++) {
      const tag = \`label \${i + 1}/\${N}\`;
      onProgress && onProgress(\`\${tag}: sending…\`);
      const { buf, stride } = await imageToPacked(urls[i], size.w_px, size.h_px, offsetY);
      tlog(\`page \${i}: start sending\`);
      const acked = await sendPagePacked(model, size, buf, stride, 1,
        (s) => onProgress && onProgress(\`\${tag}: \${s}\`), tag);
      tlog(acked ? \`page \${i}: PageEnd acked\` : \`page \${i}: sent but PageEnd went UNACKED\`);
      if (!acked) { problem = \`page \${i + 1} of \${N} was never acknowledged after \${PAGE_ACK_MS}ms (no PageEnd ack)\`; break; }
      // Send page i, THEN wait for page i-LOOKAHEAD to finish — so the just-sent
      // page is already buffered before the printer needs it (no inter-label stop).
      if (i - LOOKAHEAD >= 0) {
        const want = i - LOOKAHEAD + 1;
        if (!await waitPage(want, (s) => onProgress && onProgress(\`\${tag}: \${s}\`))) {
          problem = \`printer counter stalled at page \${_pageSeen == null ? "?" : _pageSeen} of \${want} while streaming (\${PAGE_WAIT_MS}ms)\`;
        }
      }
    }
    if (!problem && !await waitPage(N, onProgress)) {                       // drain remaining pages
      problem = \`printer counter stopped at page \${_pageSeen == null ? "?" : _pageSeen} of \${N} after \${PAGE_WAIT_MS}ms\`;
    }
    // PrintEnd goes out either way — it is what feeds out and retracts the paper.
    // The throw comes after, never instead. (See finishJob for the same ordering.)
    tlog(problem ? \`job UNCONFIRMED (\${problem}); sending PrintEnd anyway\` : \`all \${N} pages printed; sending PrintEnd\`);
    await endJob();
    if (problem) throw unconfirmed(problem);`;
const batchLoopNew = `    tlog(\`job started (\${N} pages, next page streams during the print)\`);
    let problem = null;
    const pending = [];
    try {
      for (let i = 0; i < N && !problem; i++) {
        const tag = \`label \${i + 1}/\${N}\`;
        onProgress && onProgress(\`\${tag}: sending…\`);
        const { buf, stride } = await imageToPacked(urls[i], size.w_px, size.h_px, offsetY);
        tlog(\`page \${i}: start sending\`);
        const sent = await sendPagePacked(model, size, buf, stride, 1,
          (s) => onProgress && onProgress(\`\${tag}: \${s}\`), tag, true);
        pending.push(sent.ackPromise);
        if (pending.length > 1) {
          const acked = await pending.shift();
          if (!acked) problem = \`page \${i} of \${N} was never acknowledged (no PageEnd ack)\`;
        }
      }
      while (pending.length && !problem) {
        const acked = await pending.shift();
        if (!acked) problem = \`a page was never acknowledged (no PageEnd ack)\`;
      }
      if (problem) {
        stamp(\`batch stopped (\${problem}); PrintEnd once, job not resent\`);
        await send(0xf3, [0x01]);
        _pageAck = true;
        throw unconfirmed(problem);
      }
      _pageAck = true;
      await finishJob(model, N, onProgress);
    } catch (error) {
      if (!_pageAck) {
        stamp(\`batch failed before the feed; PrintEnd once, job not resent\`);
        try { await send(0xf3, [0x01]); } catch (releaseError) { logAlways(\`PrintEnd after a failed batch: \${releaseError && releaseError.message ? releaseError.message : releaseError}\`); }
      }
      throw error;
    }`;
if (src.includes(batchLoopOld)) src = src.replace(batchLoopOld, batchLoopNew);
if (!src.includes("function refused(name, res)") || !src.includes("batch streams the next page during the print") || !src.includes("function noteStatus(") || !src.includes("function niimblueCounts(") || !src.includes("PrintEnd was not sent") || src.includes("_pageSeen == null) return") || src.includes("data[2] = 0;")) {
  console.error("niimbot finish patch did not match the installed driver");
  process.exit(1);
}
fs.writeFileSync(file, src);
