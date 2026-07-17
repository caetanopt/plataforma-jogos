import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { MediaAsset } from "@/generated/prisma/client";

const FONT_OPTIONS = ["Montserrat", "Inter", "Roboto", "Open Sans", "Arial"];

export interface ThemeFieldsetValues {
  logoMediaId: string | null;
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
  updatedAt: Date;
}

function ColorField({ id, label, defaultValue }: { id: string; label: string; defaultValue: string }) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          id={id}
          name={id}
          defaultValue={defaultValue}
          className="h-10 w-14 cursor-pointer rounded-lg border border-caetano-medium-gray"
        />
        <span className="text-sm text-caetano-medium-gray">{defaultValue}</span>
      </div>
    </div>
  );
}

export function ThemeFieldset({
  theme,
  media,
}: {
  theme: ThemeFieldsetValues;
  media: { logo: MediaAsset | null; favicon: MediaAsset | null; background: MediaAsset | null };
}) {
  // Cada bloco de topo leva um `key` derivado de `theme.updatedAt` — sem
  // isto, ao aplicar um brand kit (que substitui todos estes valores de
  // uma vez via `applyBrandKitAction`), o React reconcilia os inputs
  // não controlados existentes em vez de os recriar, e `defaultValue`/
  // `defaultChecked` só são aplicados na montagem inicial. O resultado era
  // cores, border-radius, sombra e os uploads de logo/favicon/fundo a
  // continuarem a mostrar os valores antigos depois de aplicar o kit,
  // apesar do texto ao lado de cada cor (que lê `theme.*` diretamente) já
  // mostrar o valor novo.
  const version = theme.updatedAt.toISOString();

  return (
    <>
      <MediaUploadField
        key={`logo-${version}`}
        name="logoMediaId"
        label="Logótipo"
        defaultMediaId={theme.logoMediaId}
        defaultUrl={media.logo?.url}
        defaultKind={media.logo?.kind}
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
      />
      <MediaUploadField
        key={`favicon-${version}`}
        name="faviconMediaId"
        label="Favicon"
        defaultMediaId={theme.faviconMediaId}
        defaultUrl={media.favicon?.url}
        defaultKind={media.favicon?.kind}
        accept="image/png,image/svg+xml"
      />
      <MediaUploadField
        key={`background-${version}`}
        name="backgroundImageMediaId"
        label="Imagem de fundo"
        defaultMediaId={theme.backgroundImageMediaId}
        defaultUrl={media.background?.url}
        defaultKind={media.background?.kind}
        accept="image/jpeg,image/png,image/webp"
      />

      <div key={`colors-${version}`} className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <ColorField id="primaryColor" label="Cor primária" defaultValue={theme.primaryColor} />
        <ColorField id="secondaryColor" label="Cor secundária" defaultValue={theme.secondaryColor} />
        <ColorField id="backgroundColor" label="Cor de fundo" defaultValue={theme.backgroundColor} />
        <ColorField id="textColor" label="Cor do texto" defaultValue={theme.textColor} />
        <ColorField id="buttonColor" label="Cor dos botões" defaultValue={theme.buttonColor} />
        <ColorField
          id="buttonTextColor"
          label="Cor do texto dos botões"
          defaultValue={theme.buttonTextColor}
        />
      </div>

      <div key={`typography-${version}`} className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="fontFamily">Tipografia</Label>
          <select
            id="fontFamily"
            name="fontFamily"
            defaultValue={theme.fontFamily}
            className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm"
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="borderRadiusPx">Border radius (px)</Label>
          <Input
            id="borderRadiusPx"
            name="borderRadiusPx"
            type="number"
            min={0}
            max={48}
            defaultValue={theme.borderRadiusPx}
          />
        </div>
      </div>

      <label key={`shadow-${version}`} className="flex items-center gap-2 text-sm text-caetano-anthracite">
        <input
          type="checkbox"
          name="shadowEnabled"
          defaultChecked={theme.shadowEnabled}
          className="h-4 w-4 rounded border-caetano-medium-gray"
        />
        Aplicar sombras nos elementos
      </label>
    </>
  );
}
