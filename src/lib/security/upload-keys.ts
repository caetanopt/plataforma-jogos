import { nanoid } from "nanoid";

/**
 * Chaves de upload: `uploads/<organizationId>/<id>.<extensão>`.
 *
 * A organização vai na chave para a confirmação poder verificar que o
 * objeto veio de um presign dessa organização. Antes, a confirmação aceitava
 * qualquer `key` e qualquer `publicUrl` enviados pelo browser: dava para
 * registar como media da organização um URL externo arbitrário, ou um
 * objeto carregado por outra organização.
 */
export function uploadKeyFor(organizationId: string, extension: string): string {
  return `uploads/${organizationId}/${nanoid()}.${extension}`;
}

const ID_PATTERN = "[A-Za-z0-9_-]{21}";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isUploadKeyOf(organizationId: string, key: string, extension: string): boolean {
  const pattern = new RegExp(
    `^uploads/${escapeRegExp(organizationId)}/${ID_PATTERN}\\.${escapeRegExp(extension)}$`,
  );
  return pattern.test(key);
}

/**
 * Chave definitiva de uma media confirmada: `media/...` em vez de
 * `uploads/...`. O URL de upload assinado continua válido uns minutos e
 * permitia escrever por cima do objeto já confirmado (com outro conteúdo);
 * a confirmação copia-o para uma chave que nenhum URL assinado permite
 * escrever.
 */
export function confirmedKeyFor(uploadKey: string): string {
  return uploadKey.replace(/^uploads\//, "media/");
}
