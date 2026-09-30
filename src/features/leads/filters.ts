import { resolveDateRange, type DateRange } from "@/lib/dates/range";
import { parseMarketingConsentFilter, type LeadsFilters } from "@/features/leads/queries";

export interface LeadsQueryParams {
  campaignId?: string;
  search?: string;
  period?: string;
  from?: string;
  to?: string;
  excludeTest?: string;
  marketingConsent?: string;
  hideAnonymized?: string;
}

/**
 * Os filtros da lista de leads a partir dos parâmetros do pedido. A lista, a
 * exportação e a anonimização "de tudo o que os filtros mostram" leem-nos
 * daqui: têm de apanhar exatamente as mesmas participações.
 */
export function leadsFiltersFromParams(params: LeadsQueryParams): { range: DateRange; filters: LeadsFilters } {
  return {
    range: resolveDateRange(params),
    filters: {
      campaignId: params.campaignId || undefined,
      search: params.search || undefined,
      excludeTest: params.excludeTest !== "false",
      marketingConsent: parseMarketingConsentFilter(params.marketingConsent),
      hideAnonymized: params.hideAnonymized === "true",
    },
  };
}

/** Os mesmos filtros de volta em parâmetros (ligações, exportação, paginação). */
export function leadsFiltersToParams(range: DateRange, filters: LeadsFilters, params: LeadsQueryParams): Record<string, string> {
  return {
    ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
    ...(filters.search ? { search: filters.search } : {}),
    period: range.preset,
    ...(range.preset === "custom" ? { from: params.from ?? "", to: params.to ?? "" } : {}),
    excludeTest: String(filters.excludeTest !== false),
    ...(filters.marketingConsent ? { marketingConsent: filters.marketingConsent } : {}),
    ...(filters.hideAnonymized ? { hideAnonymized: "true" } : {}),
  };
}
