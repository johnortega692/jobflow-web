import assert from "node:assert/strict";
import test from "node:test";
import { driveFolderId, folderNeedsAccess, parseDriveFolderPage, parseEmbeddedFolder } from "./driveFolder.ts";

test("a shared folder link yields the folder id", () => {
  assert.equal(
    driveFolderId("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345?usp=sharing"),
    "1AbCdEfGhIjKlMnOpQrStUvWxYz012345",
  );
  assert.equal(driveFolderId("https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345"), "1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  assert.equal(driveFolderId("not a link"), null);
});

test("the public folder page lists only pdf names", () => {
  const html = `
    <div class="flip-entry" id="entry-1AbCdEfGhIjKlMnOpQrStUvWxYz012345">
      <div class="flip-entry-title">Kelly 4412.pdf</div>
    </div>
    <div class="flip-entry" id="entry-1ZzYyXxWwVvUuTtSsRrQqPpOoNnMm098765">
      <div class="flip-entry-title">notes.txt</div>
    </div>
    <a href="https://drive.google.com/file/d/1QqWwEeRrTtYyUuIiOoPpAaSsDdFf012345/view">Dunn Edwards.pdf</a>
  `;
  assert.deepEqual(parseEmbeddedFolder(html), [
    { id: "1QqWwEeRrTtYyUuIiOoPpAaSsDdFf012345", name: "Dunn Edwards.pdf" },
    { id: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345", name: "Kelly 4412.pdf" },
  ]);
});

test("the current Drive folder page pairs each pdf with its file id", () => {
  const html = `<div data-id="1qJ_DxvlFtK-B7vEx5gWdUbWyXAOTrkrJ" data-tooltip="DE2006A22291.pdf PDF"><strong>DE2006A22291.pdf</strong></div>`;
  assert.deepEqual(parseDriveFolderPage(html), [
    { id: "1qJ_DxvlFtK-B7vEx5gWdUbWyXAOTrkrJ", name: "DE2006A22291.pdf" },
  ]);
});

test("a private folder page is recognized", () => {
  assert.equal(folderNeedsAccess("<title>You need access</title>"), true);
  assert.equal(folderNeedsAccess("<div class='flip-entry-title'>Invoice.pdf</div>"), false);
});
