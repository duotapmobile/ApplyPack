import type { ArtifactProvenance } from "@/lib/documents/generate";

/** XMP need not duplicate PDF's standard catalog /Lang entry. */
export function pdfCatalogLanguageMatches(pdf: Buffer, expected: string) {
  const text = pdf.toString("latin1");
  const root = [...text.matchAll(/\/Root\s+(\d+)\s+(\d+)\s+R\b/g)].at(-1);
  if (!root) return false;
  const object = new RegExp(`(?:^|[\\r\\n])${root[1]}\\s+${root[2]}\\s+obj\\b([\\s\\S]*?)endobj`).exec(text)?.[1];
  if (!object || !/\/Type\s*\/Catalog\b/.test(object)) return false;
  return /\/Lang\s*\(([^()\\]+)\)/.exec(object)?.[1].toLowerCase() === expected.toLowerCase();
}

export function pdfStructureIsValid(
  output: string,
  artifactType: ArtifactProvenance["artifact"],
) {
  type Tag = "Document" | "StructTreeRoot" | "P" | "H1" | "L" | "LI" | "Lbl" | "LBody" | "Link";
  type Node = { tag: Tag; indent: number; parent: number | null };
  const nodes: Node[] = [];
  const stack: number[] = [];
  for (const line of output.replace(/\r/g, "").split("\n")) {
    const match = /^(\s*)(Document|StructTreeRoot|P|H1|L|LI|Lbl|LBody|Link)(?:\s|\(|:|$)/.exec(line);
    if (!match) continue;
    const indent = match[1].replace(/\t/g, "  ").length;
    while (stack.length && nodes[stack.at(-1)!].indent >= indent) stack.pop();
    const node: Node = { tag: match[2] as Tag, indent, parent: stack.at(-1) ?? null };
    nodes.push(node);
    stack.push(nodes.length - 1);
  }
  if (!nodes.length || !["Document", "StructTreeRoot"].includes(nodes[0].tag) || nodes[0].parent !== null) return false;
  if (nodes.slice(1).some((node) => node.parent === null)) return false;
  const children = (index: number) => nodes.map((node, child) => ({ node, child }))
    .filter((entry) => entry.node.parent === index);
  const allowedParent: Record<Tag, Tag[]> = {
    Document: [], StructTreeRoot: [], P: ["Document", "StructTreeRoot", "LBody"],
    H1: ["Document", "StructTreeRoot"], L: ["Document", "StructTreeRoot"],
    LI: ["L"], Lbl: ["LI"], LBody: ["LI"], Link: ["P"],
  };
  if (nodes.slice(1).some((node) => node.parent === null
    || !allowedParent[node.tag].includes(nodes[node.parent].tag))) return false;
  const rootChildren = children(0);
  const paragraphs = nodes.filter((node) => node.tag === "P").length;
  const links = nodes.filter((node) => node.tag === "Link").length;
  if (!paragraphs || !links) return false;
  for (const { child } of nodes.map((node, child) => ({ node, child })).filter(({ node }) => node.tag === "L")) {
    const items = children(child);
    if (!items.length || items.some(({ node }) => node.tag !== "LI")) return false;
    for (const item of items) {
      const parts = children(item.child);
      const label = parts.find(({ node }) => node.tag === "Lbl");
      const body = parts.find(({ node }) => node.tag === "LBody");
      if (!label || !body || !children(body.child).some(({ node }) => node.tag === "P")) return false;
    }
  }
  const headingPositions = rootChildren.filter(({ node }) => node.tag === "H1").map(({ child }) => child);
  if (artifactType === "COVER_LETTER") return paragraphs >= 8 && !headingPositions.length;
  if (!headingPositions.length || headingPositions.some((position) => !nodes.slice(position + 1)
    .some((node) => node.parent === 0 && node.tag === "P"))) return false;
  if (artifactType === "REFERENCE_SHEET") return !nodes.some((node) => node.tag === "L");
  const listPositions = rootChildren.filter(({ node }) => node.tag === "L").map(({ child }) => child);
  return listPositions.length > 0 && listPositions.every((position) => {
    const previousRoot = [...rootChildren].reverse().find(({ child }) => child < position);
    return previousRoot?.node.tag === "P";
  });
}
