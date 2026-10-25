import { PDFDocument, PDFHexString, PDFRef } from "pdf-lib";

/** PDF bookmark. Page index is 0-based. Children nest under this item, like the table of contents. */
export type PdfOutlineItem = {
  title: string;
  to: number;
  children?: PdfOutlineItem[];
};

type OutlineNode = {
  title: string;
  to: number;
  ref: PDFRef;
  children: OutlineNode[];
};

/** Open descendants, so a viewer shows nested bookmarks expanded. */
function openDescendantCount(node: OutlineNode): number {
  return node.children.reduce((total, child) => total + 1 + openDescendantCount(child), 0);
}

/**
 * Add a document outline (bookmarks panel) via pdf-lib low-level objects.
 * Adapted from marp-cli (MIT): https://github.com/marp-team/marp-cli
 */
export function setPdfOutlines(doc: PDFDocument, outlines: readonly PdfOutlineItem[]): void {
  if (!outlines.length) return;

  const rootRef = doc.context.nextRef();
  const pageRefs: PDFRef[] = [];
  doc.catalog.Pages().traverse((kid, ref) => {
    if (kid.get(kid.context.obj("Type"))?.toString() === "/Page") {
      pageRefs.push(ref);
    }
  });

  const buildNodes = (items: readonly PdfOutlineItem[]): OutlineNode[] =>
    items.map((item) => ({
      title: item.title,
      to: item.to,
      ref: doc.context.nextRef(),
      children: buildNodes(item.children ?? []),
    }));

  const writeNodes = (nodes: OutlineNode[], parentRef: PDFRef) => {
    nodes.forEach((node, index) => {
      const pageIndex = node.to;
      const dest =
        pageIndex >= 0 && pageIndex < pageRefs.length ? { Dest: [pageRefs[pageIndex], "Fit"] } : {};
      const childCount = openDescendantCount(node);
      doc.context.assign(
        node.ref,
        doc.context.obj({
          Title: PDFHexString.fromText(node.title),
          Parent: parentRef,
          ...(index > 0 ? { Prev: nodes[index - 1]!.ref } : {}),
          ...(index < nodes.length - 1 ? { Next: nodes[index + 1]!.ref } : {}),
          ...(node.children.length
            ? {
                First: node.children[0]!.ref,
                Last: node.children[node.children.length - 1]!.ref,
                Count: childCount,
              }
            : {}),
          ...dest,
        }),
      );
      writeNodes(node.children, node.ref);
    });
  };

  const nodes = buildNodes(outlines);
  writeNodes(nodes, rootRef);

  doc.context.assign(
    rootRef,
    doc.context.obj({
      Type: "Outlines",
      First: nodes[0]!.ref,
      Last: nodes[nodes.length - 1]!.ref,
      Count: nodes.reduce((total, node) => total + 1 + openDescendantCount(node), 0),
    }),
  );

  doc.catalog.set(doc.context.obj("Outlines"), rootRef);
}
