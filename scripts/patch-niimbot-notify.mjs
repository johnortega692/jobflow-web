import fs from "node:fs";
import path from "node:path";

const file = path.join("node_modules", "niimbot-web-bluetooth", "src", "niimbot.js");
if (!fs.existsSync(file)) process.exit(0);

let src = fs.readFileSync(file, "utf8");
if (src.includes("_pageSeen == null) return")) process.exit(0);

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
    // PageEnd already parked the label. PrintEnd is what feeds it out, and a B1 often
    // never sends a page counter for that. An acknowledged PrintEnd, or a counter that
    // never spoke at all, means the label was fed. A counter that did speak and stopped
    // short is a real stall.
    const end = await sendWait(0xf3, [0x01], 0xf4, 4000);
    if (reached || end || _pageSeen == null) return;
    throw unconfirmed(\`printer counter stopped at page \${_pageSeen} of \${want} after \${PAGE_WAIT_MS}ms\`);
  }`;

if (!src.includes(waitPage) || !src.includes(finish)) {
  console.error("niimbot finish patch did not match the installed driver");
  process.exit(1);
}

src = src.replace(waitPage, waitPagePatched).replace(finish, finishPatched);
src = src
  .replaceAll(
    "if (!await waitPage(want, (s) => onProgress && onProgress(`${tag}: ${s}`))) {",
    "if (!await waitPage(want, (s) => onProgress && onProgress(`${tag}: ${s}`)) && _pageSeen != null) {",
  )
  .replaceAll(
    "if (!problem && !await waitPage(N, onProgress)) {",
    "if (!problem && !await waitPage(N, onProgress) && _pageSeen != null) {",
  );
if (!src.includes("_pageSeen == null) return") || src.includes("if (!problem && !await waitPage(N, onProgress)) {")) {
  console.error("niimbot finish patch did not match the installed driver");
  process.exit(1);
}
fs.writeFileSync(file, src);
