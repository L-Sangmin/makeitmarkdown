// Dependency DAG mini-map for notebook results — inline SVG, rule-based
// arc-diagram layout, no graph library (HANDOFF §1.5.4, $0 principle).
//
// Consumes the `notebook` block produced by parsers/ipynb.js:
//   { cells: [{ position, display, execCount }], edges: [{ from, to, vars }],
//     execOrderFlags: [position] }
//
// Nodes sit on one baseline in notebook order; arcs above link definer →
// user, labelled with the variable names. Out-of-order cells carry a ⚠.
// Positioned honestly: the caption says "approximate dependency hints".

const THEMES = {
  light: {
    node: "#ffffff",
    nodeStroke: "#d0d0d5",
    text: "#18181b",
    muted: "#71717a",
    arc: "#4f46e5",
    warn: "#b45309",
  },
  dark: {
    node: "#131317",
    nodeStroke: "#37373f",
    text: "#ededf0",
    muted: "#7a7a84",
    arc: "#818cf8",
    warn: "#fbbf24",
  },
};

const FONT = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
const NODE_H = 26;
const NODE_GAP = 36;
const PAD_X = 20;
const CAPTION = "approximate dependency hints";

// Above these, an arc diagram becomes an unreadable hairball. Cap to the
// busiest cells and drop per-arc labels so the mini-map stays screenshot-clean.
const MAX_NODES = 16;
const LABEL_MAX_ARCS = 12;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderDependencyDag(notebook, options = {}) {
  const t = THEMES[options.theme ?? "light"] ?? THEMES.light;
  const cells = notebook?.cells ?? [];
  const edges = notebook?.edges ?? [];
  const flagged = new Set(notebook?.execOrderFlags ?? []);

  const involved = new Set(edges.flatMap((e) => [e.from, e.to]));
  for (const p of flagged) involved.add(p);
  let nodes = cells.filter((c) => involved.has(c.position));
  const totalInvolved = nodes.length;

  // Cap large graphs to the busiest cells (highest edge degree). Keep
  // notebook order for layout; filter edges to surviving endpoints.
  let capped = false;
  let visibleEdges = edges;
  if (nodes.length > MAX_NODES) {
    capped = true;
    const degree = new Map();
    for (const e of edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const keep = new Set(
      [...nodes]
        .sort((a, b) => (degree.get(b.position) ?? 0) - (degree.get(a.position) ?? 0) || a.position - b.position)
        .slice(0, MAX_NODES)
        .map((c) => c.position)
    );
    nodes = nodes.filter((c) => keep.has(c.position));
    visibleEdges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  }

  if (!nodes.length) {
    const msg = "No cross-cell dependencies detected";
    const w = msg.length * 7.5 + PAD_X * 2;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 48" width="${w}" height="48" ` +
      `role="img" aria-label="${esc(msg)}">` +
      `<text x="${w / 2}" y="28" text-anchor="middle" font-family='${FONT}' font-size="12" fill="${t.muted}">${esc(msg)}</text>` +
      `</svg>`
    );
  }

  // --- layout: single row, notebook order --------------------------------
  const boxes = new Map(); // position -> {x, w, cx}
  let cursor = PAD_X;
  for (const n of nodes) {
    const w = Math.max(44, n.display.length * 7.5 + 18);
    boxes.set(n.position, { x: cursor, w, cx: cursor + w / 2 });
    cursor += w + NODE_GAP;
  }
  const width = cursor - NODE_GAP + PAD_X;

  const arcs = visibleEdges
    .filter((e) => boxes.has(e.from) && boxes.has(e.to))
    .map((e) => {
      const span = Math.abs(boxes.get(e.to).cx - boxes.get(e.from).cx);
      const h = 26 + Math.min(64, span * 0.14);
      return { ...e, h };
    });
  const maxArc = arcs.length ? Math.max(...arcs.map((a) => a.h)) : 24;
  const showLabels = arcs.length <= LABEL_MAX_ARCS;
  const arcStroke = arcs.length > 40 ? 1 : 1.5;
  const arcOpacity = arcs.length > 40 ? 0.5 : 1;

  const topPad = flagged.size ? 18 : 8; // room for ⚠ above nodes
  const baseline = maxArc + 16 + topPad; // node top y
  const height = baseline + NODE_H + 34;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
      `role="img" aria-label="Cell dependency graph (approximate)">`
  );
  parts.push(
    `<defs><marker id="dagArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
      `<path d="M0 0.5 L7.5 4 L0 7.5 Z" fill="${t.arc}"/></marker></defs>`
  );

  // arcs first (under the nodes)
  for (const a of arcs) {
    const x1 = boxes.get(a.from).cx;
    const x2 = boxes.get(a.to).cx;
    const y = baseline - 2;
    const apexY = y - a.h;
    parts.push(
      `<path d="M ${x1} ${y} C ${x1} ${apexY}, ${x2} ${apexY}, ${x2} ${y}" ` +
        `fill="none" stroke="${t.arc}" stroke-width="${arcStroke}" stroke-opacity="${arcOpacity}" marker-end="url(#dagArrow)"/>`
    );
    if (showLabels) {
      const label =
        a.vars.length > 3
          ? `${a.vars.slice(0, 3).join(", ")} +${a.vars.length - 3}`
          : a.vars.join(", ");
      parts.push(
        `<text x="${(x1 + x2) / 2}" y="${apexY + a.h * 0.25 - 5}" text-anchor="middle" ` +
          `font-family='${FONT}' font-size="11" fill="${t.arc}">${esc(label)}</text>`
      );
    }
  }

  // nodes
  for (const n of nodes) {
    const b = boxes.get(n.position);
    const isWarn = flagged.has(n.position);
    const stroke = isWarn ? t.warn : t.nodeStroke;
    parts.push(
      `<g>` +
        `<title>Cell [${esc(n.display.replace(/^In\[|\]$/g, ""))}]${isWarn ? " — executed out of notebook order" : ""}</title>` +
        `<rect x="${b.x}" y="${baseline}" width="${b.w}" height="${NODE_H}" rx="6" ` +
        `fill="${t.node}" stroke="${stroke}" stroke-width="1.25"/>` +
        `<text x="${b.cx}" y="${baseline + NODE_H / 2 + 4}" text-anchor="middle" ` +
        `font-family='${FONT}' font-size="12" fill="${t.text}">${esc(n.display)}</text>` +
        (isWarn
          ? `<text x="${b.cx}" y="${baseline - 6}" text-anchor="middle" font-size="11" fill="${t.warn}">⚠</text>`
          : "") +
        `</g>`
    );
  }

  // captions
  const captionY = baseline + NODE_H + 22;
  if (flagged.size) {
    parts.push(
      `<text x="${PAD_X}" y="${captionY}" font-family='${FONT}' font-size="10" fill="${t.warn}">⚠ executed out of order</text>`
    );
  }
  const rightCaption = capped
    ? `busiest ${nodes.length} of ${totalInvolved} cells · ${CAPTION}`
    : CAPTION;
  parts.push(
    `<text x="${width - PAD_X}" y="${captionY}" text-anchor="end" font-family='${FONT}' font-size="10" fill="${t.muted}">${esc(rightCaption)}</text>`
  );

  parts.push("</svg>");
  return parts.join("");
}
