import { customAlphabet } from "nanoid";

const suffixAlphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const generateSuffix = customAlphabet(suffixAlphabet, 6);

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function generateCampaignSlug(internalName: string): string {
  const base = slugify(internalName) || "campanha";
  return `${base}-${generateSuffix()}`;
}
