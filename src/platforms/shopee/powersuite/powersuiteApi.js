const PRODUCT_FIELDS = `
  itemId shopId productName productLink offerLink imageUrl
  priceMin priceMax priceDiscountRate sales ratingStar
  commissionRate sellerCommissionRate shopeeCommissionRate commission
  shopName shopType periodStartTime periodEndTime
`;

function applyClientFilters(nodes, searchParams) {
  const minPct = Number(searchParams.minCommission || 0);
  const st = searchParams.shopType || {};

  return (nodes || []).filter((p) => {
    const pct = parseFloat(p.commissionRate || 0) * 100;
    if (pct < minPct) return false;
    const type = Number(p.shopType);
    if (type === 1 && st.mall === false) return false;
    if (type === 2 && st.star === false) return false;
    if (type === 4 && st.starPlus === false) return false;
    return true;
  });
}

function buildProductOfferQuery(searchParams) {
  const vars = {
    keyword: searchParams.keyword?.trim() || undefined,
    listType: parseInt(searchParams.listType, 10) || 1,
    sortType: parseInt(searchParams.sortType, 10) || 5,
    isAMSOffer: Boolean(searchParams.isAMSOffer),
    isKeySeller: Boolean(searchParams.isKeySeller),
    page: 1,
    limit: 20,
  };

  const query = `
    query getProductOffers($keyword: String, $listType: Int, $sortType: Int, $page: Int, $limit: Int, $isAMSOffer: Boolean, $isKeySeller: Boolean) {
      productOfferV2(
        keyword: $keyword,
        listType: $listType,
        sortType: $sortType,
        page: $page,
        limit: $limit,
        isAMSOffer: $isAMSOffer,
        isKeySeller: $isKeySeller
      ) {
        nodes { ${PRODUCT_FIELDS} }
        pageInfo { page limit hasNextPage }
      }
    }
  `;

  return { query, variables: vars };
}

export async function callAffiliateGraphql(graphQlBody, apiConfig = {}) {
  const url = apiConfig.affiliateGraphqlUrl || import.meta.env.VITE_AFFILIATE_GRAPHQL_URL;
  const secret = apiConfig.backfillSecret || import.meta.env.VITE_BACKFILL_SECRET;
  if (!url || !secret) {
    throw new Error("Configure VITE_AFFILIATE_GRAPHQL_URL e VITE_BACKFILL_SECRET no .env");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(graphQlBody),
  });

  const result = await response.json();
  if (!response.ok || result.success === false) {
    throw new Error(result.error || `Erro ${response.status} na API`);
  }
  return result;
}

export async function searchSuperComissoes({ searchParams, apiConfig }) {
  const graphQlBody = buildProductOfferQuery(searchParams);
  const result = await callAffiliateGraphql(graphQlBody, apiConfig);
  const nodes = result.data?.productOfferV2?.nodes || [];
  return applyClientFilters(nodes, searchParams);
}

export async function generateTrackedShortLink({ originUrl, subIds, apiConfig }) {
  const cleanSubIds = (subIds || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5);

  const mutationBody = {
    query: `
      mutation generateLink($originUrl: String!, $subIds: [String!]) {
        generateShortLink(input: { originUrl: $originUrl, subIds: $subIds }) {
          shortLink
        }
      }
    `,
    variables: {
      originUrl,
      subIds: cleanSubIds.length ? cleanSubIds : undefined,
    },
  };

  const result = await callAffiliateGraphql(mutationBody, apiConfig);
  const link = result.data?.generateShortLink?.shortLink;
  if (!link) throw new Error("Falha ao gerar link curto");
  return link;
}

export function shopTypeLabel(shopType) {
  const t = Number(shopType);
  if (t === 1) return "Mall";
  if (t === 4) return "Star+";
  if (t === 2) return "Star";
  return "Loja";
}

export function pctFromRate(rate) {
  return (parseFloat(rate || 0) * 100).toFixed(1);
}
