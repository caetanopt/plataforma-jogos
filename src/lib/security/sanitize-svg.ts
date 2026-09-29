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
 *
 * O SVG é XML: os nomes são sensíveis a maiúsculas. O parser do
 * sanitize-html passava-os a minúsculas, por isso `viewBox`,
 * `gradientUnits` e `linearGradient` nunca batiam certo com a lista branca —
 * os SVG perdiam o viewBox e deixavam de escalar. As comparações de
 * segurança (script, on*, javascript:) fazem-se sem distinguir maiúsculas.
 */
/** Elementos cujo conteúdo é descartado, não só a marcação. */
const NON_TEXT_TAGS = ["script", "style", "foreignobject", "noscript", "textarea", "iframe", "object"];
const NON_TEXT_TAG_PATTERN = new RegExp(`<(\\/?)\\s*(${NON_TEXT_TAGS.join("|")})\\b`, "gi");

export function sanitizeSvg(rawSvg: string): string {
  // Com os nomes em caixa preservada, <SCRIPT> já não coincidia com a lista
  // de elementos cujo conteúdo o sanitize-html descarta: ficava como texto.
  // Estes nomes passam a minúsculas antes de sanitizar.
  const normalized = rawSvg.replace(NON_TEXT_TAG_PATTERN, (_m, slash: string, tag: string) => `<${slash}${tag.toLowerCase()}`);
  return sanitizeHtml(normalized, {
    allowedTags: ALLOWED_SVG_TAGS,
    allowedAttributes: { "*": ALLOWED_SVG_ATTRIBUTES },
    allowVulnerableTags: false,
    disallowedTagsMode: "discard",
    nonTextTags: NON_TEXT_TAGS,
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
    transformTags: {
      "*": (tagName, attribs) => {
        const safeAttribs = Object.fromEntries(
          Object.entries(attribs).filter(([name, value]) => {
            const lower = name.toLowerCase();
            if (lower.startsWith("on")) return false;
            // Só referências internas (#id): um href externo num <use>
            // carregava recursos de outro domínio.
            if (lower === "href" || lower === "xlink:href") return /^\s*#/.test(value);
            return true;
          }),
        );
        return { tagName, attribs: safeAttribs };
      },
    },
  });
}
