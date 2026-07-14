import sanitizeHtml from "sanitize-html";

const ALLOWED_SVG_TAGS = [
  "svg",
  "g",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "ellipse",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "text",
  "tspan",
  "title",
  "desc",
  "clipPath",
  "mask",
  "use",
];

const ALLOWED_SVG_ATTRIBUTES = [
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "transform",
  "id",
  "class",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "xmlns",
  "xmlns:xlink",
  "xlink:href",
  "href",
  "clip-path",
  "font-size",
  "font-family",
  "text-anchor",
];

/**
 * Sanitiza SVG carregado por utilizadores removendo scripts, event handlers e
 * elementos/atributos fora de uma lista branca (secção 9 e 25: "SVG apenas
 * sanitizado"). Ficheiros perigosos ficam reduzidos a marcação vazia/inerte
 * em vez de rejeitados, para não expor detalhes de parsing ao cliente.
 */
export function sanitizeSvg(rawSvg: string): string {
  return sanitizeHtml(rawSvg, {
    allowedTags: ALLOWED_SVG_TAGS,
    allowedAttributes: { "*": ALLOWED_SVG_ATTRIBUTES },
    allowVulnerableTags: false,
    disallowedTagsMode: "discard",
    exclusiveFilter: (frame) => frame.tag === "script" || frame.tag === "foreignobject",
    transformTags: {
      "*": (tagName, attribs) => {
        const safeAttribs = Object.fromEntries(
          Object.entries(attribs).filter(([name, value]) => {
            if (name.startsWith("on")) return false;
            if ((name === "href" || name === "xlink:href") && /^\s*javascript:/i.test(value)) {
              return false;
            }
            return true;
          }),
        );
        return { tagName, attribs: safeAttribs };
      },
    },
  });
}
