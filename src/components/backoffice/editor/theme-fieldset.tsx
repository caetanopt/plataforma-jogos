import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { ThemeColorField } from "@/components/backoffice/editor/theme-color-field";
import { SyncedInput, SyncedSelect } from "@/components/forms/synced-fields";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { BRAND_THEME_LIMITS } from "@/lib/validation/brand";
import { LEGAL_LINK_KEYS, LEGAL_LINK_LABELS, readLegalLinks } from "@/features/brand/legal-links";
import { themeContrastWarnings } from "@/features/brand/public-theme";
import type { MediaAsset } from "@/generated/prisma/client";

const FONT_OPTIONS = ["Montserrat", "Inter", "Roboto", "Open Sans", "Arial"];

const FIELD_CLASS =
  "h-10 w-full rounded-lg border border-caetano-medium-gray bg-white px-3 text-sm text-caetano-anthracite focus-visible:border-caetano-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan aria-invalid:border-danger";

export interface ThemeFieldsetValues {
  logoMediaId: string | null;
  logoAltText: string | null;
  faviconMediaId: string | null;
  backgroundImageMediaId: string | null;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  buttonColor: string;
  buttonTextColor: string;
  fontFamily: string;
  borderRadiusPx: number;
  shadowEnabled: boolean;
  /** JSON gravado (ver legal-links.ts). */
  legalLinks?: unknown;
}

const COLOR_FIELDS = [
  ["primaryColor", "Cor primária"],
  ["secondaryColor", "Cor secundária"],
  ["backgroundColor", "Cor de fundo"],
  ["textColor", "Cor do texto"],
  ["buttonColor", "Cor dos botões"],
  ["buttonTextColor", "Cor do texto dos botões"],
] as const;

/**
 * Campos do tema, partilhados pela etapa Marca e design e pelos brand kits.
 *
 * Sem `key` por versão: antes cada gravação remontava os blocos para que um
 * brand kit aplicado aparecesse, o que tirava o foco a quem estava a escrever
 * e matava um upload a decorrer noutro campo. Os campos seguem agora o valor
 * gravado sem remontar (SyncedInput/SyncedSelect; o MediaUploadField segue
 * os seus valores por omissão).
 *
 * `idPrefix`: a página Identidade visual tem um destes por brand kit, e os
 * ids repetidos ligavam as labels ao input do primeiro kit.
 */
export function ThemeFieldset({
  theme,
  media,
  idPrefix = "",
}: {
  theme: ThemeFieldsetValues;
  media: { logo: MediaAsset | null; favicon: MediaAsset | null; background: MediaAsset | null };
  idPrefix?: string;
}) {
  const fieldId = (name: string) => `${idPrefix}${name}`;
  // Uma tipografia gravada fora da lista (kit antigo) continua escolhida: sem
  // a opção, o select mostrava a primeira e a gravação seguinte trocava-a.
  const fontOptions = FONT_OPTIONS.includes(theme.fontFamily) ? FONT_OPTIONS : [theme.fontFamily, ...FONT_OPTIONS];
  const legalLinks = readLegalLinks(theme.legalLinks);
  // Do tema gravado: a gravação automática volta a desenhar a página.
  const contrastWarnings = themeContrastWarnings(theme);

  return (
    <>
      <MediaUploadField
        name="logoMediaId"
        label="Logótipo"
        defaultMediaId={theme.logoMediaId}
        defaultUrl={media.logo?.url}
        defaultKind={media.logo?.kind}
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
      />
      {/* Junto ao logótipo: é o que os leitores de ecrã dizem dele no jogo.
          Fica no tema (copiado com ele), não no ficheiro nem no nome do kit. */}
      <div>
        <Label htmlFor={fieldId("logoAltText")}>Texto alternativo do logótipo</Label>
        <SyncedInput
          id={fieldId("logoAltText")}
          name="logoAltText"
          maxLength={BRAND_THEME_LIMITS.logoAltText}
          defaultValue={theme.logoAltText ?? ""}
          aria-describedby={fieldId("logoAltText-help")}
          className={FIELD_CLASS}
        />
        <p id={fieldId("logoAltText-help")} className="mt-1 text-xs text-caetano-anthracite-80">
          O nome da marca, tal como aparece no logótipo. Vazio, o jogo usa o nome da organização.
        </p>
      </div>
      <MediaUploadField
        name="faviconMediaId"
        label="Favicon"
        defaultMediaId={theme.faviconMediaId}
        defaultUrl={media.favicon?.url}
        defaultKind={media.favicon?.kind}
        accept="image/png,image/svg+xml"
      />
      <MediaUploadField
        name="backgroundImageMediaId"
        label="Imagem de fundo"
        defaultMediaId={theme.backgroundImageMediaId}
        defaultUrl={media.background?.url}
        defaultKind={media.background?.kind}
        accept="image/jpeg,image/png,image/webp"
      />

      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 sm:grid-cols-3">
        {COLOR_FIELDS.map(([name, label]) => (
          <ThemeColorField key={name} id={fieldId(name)} name={name} label={label} defaultValue={theme[name]} />
        ))}
      </div>

      {contrastWarnings.length > 0 && (
        <Alert variant="warning">
          <p>Algumas cores não têm contraste suficiente para se lerem (WCAG 2.2 AA):</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {contrastWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={fieldId("fontFamily")}>Tipografia</Label>
          <SyncedSelect
            id={fieldId("fontFamily")}
            name="fontFamily"
            defaultValue={theme.fontFamily}
            className={FIELD_CLASS}
          >
            {fontOptions.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </SyncedSelect>
        </div>
        <div>
          <Label htmlFor={fieldId("borderRadiusPx")}>Border radius (px)</Label>
          <SyncedInput
            id={fieldId("borderRadiusPx")}
            name="borderRadiusPx"
            type="number"
            inputMode="numeric"
            min={BRAND_THEME_LIMITS.borderRadiusMin}
            max={BRAND_THEME_LIMITS.borderRadiusMax}
            step={1}
            defaultValue={theme.borderRadiusPx}
            className={FIELD_CLASS}
          />
        </div>
      </div>

      {/* Checkbox com sentinela (ver CheckboxField), mas sincronizada: aplicar
          um brand kit também muda a sombra. */}
      <label className="flex items-center gap-2 text-sm text-caetano-anthracite">
        <input type="hidden" name="shadowEnabled" value="" />
        <SyncedInput
          type="checkbox"
          name="shadowEnabled"
          defaultChecked={theme.shadowEnabled}
          className="h-4 w-4 rounded border-caetano-medium-gray"
        />
        Aplicar sombras nos elementos
      </label>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-caetano-anthracite">Links legais</legend>
        <p id={fieldId("legalLinks-help")} className="text-xs text-caetano-anthracite-80">
          Aparecem no jogo, junto ao formulário de leads e no rodapé. Endereços completos, a começar por https://.
        </p>
        {LEGAL_LINK_KEYS.map((key) => (
          <div key={key}>
            <Label htmlFor={fieldId(key)}>{LEGAL_LINK_LABELS[key]}</Label>
            <SyncedInput
              id={fieldId(key)}
              name={key}
              type="url"
              inputMode="url"
              maxLength={500}
              placeholder="https://"
              defaultValue={legalLinks[key] ?? ""}
              aria-describedby={fieldId("legalLinks-help")}
              className={FIELD_CLASS}
            />
          </div>
        ))}
      </fieldset>
    </>
  );
}
