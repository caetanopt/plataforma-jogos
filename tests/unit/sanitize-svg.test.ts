import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "@/lib/security/sanitize-svg";

describe("sanitizeSvg", () => {
  it("mantém viewBox e os atributos/elementos em camelCase (o SVG é XML)", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#002E5D"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>',
    );
    expect(out).toContain('viewBox="0 0 10 10"');
    expect(out).toContain("<linearGradient");
    expect(out).toContain('gradientUnits="userSpaceOnUse"');
  });

  it("remove scripts, handlers (em qualquer caixa) e foreignObject", () => {
    const out = sanitizeSvg(
      '<svg onLoad="alert(1)" ONCLICK="x()"><script>alert(1)</script><SCRIPT>alert(2)</SCRIPT><foreignObject><div>x</div></foreignObject><circle r="1"/></svg>',
    );
    expect(out).not.toMatch(/alert|onload|onclick|script|foreignobject/i);
    expect(out).toContain("<circle");
  });

  it("recusa hrefs externos e javascript:, mantém referências internas", () => {
    const out = sanitizeSvg(
      '<svg><use href="https://evil.example/x.svg#a"/><use xlink:href="javascript:alert(1)"/><use href="#simbolo"/></svg>',
    );
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("javascript:");
    expect(out).toContain('href="#simbolo"');
  });

  it("remove animações SMIL e estilos embutidos", () => {
    const out = sanitizeSvg(
      '<svg><a><animate attributeName="href" to="javascript:alert(1)"/></a><set attributeName="onmouseover" to="alert(1)"/><style>*{background:url(https://t.example)}</style></svg>',
    );
    expect(out).not.toMatch(/animate|<set|javascript|<style|t\.example/i);
  });
});
