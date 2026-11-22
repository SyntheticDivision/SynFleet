export type DutchCoin = {
  ticker: string;
  name: string;
  algo: "SHA-256" | "Scrypt";
  slug: string;
};

/** SHA-256 and Scrypt pools listed on Mining Dutch as of September 2026. */
export const DUTCH_COINS: DutchCoin[] = [
  { ticker: "ACG", name: "AurumCryptoGold", algo: "SHA-256", slug: "aurumcryptogold" },
  { ticker: "BTC", name: "Bitcoin", algo: "SHA-256", slug: "bitcoin" },
  { ticker: "BCH2", name: "BitcoinCashII", algo: "SHA-256", slug: "bitcoincashii" },
  { ticker: "BCH", name: "BitcoinCashNode", algo: "SHA-256", slug: "bitcoincashnode" },
  { ticker: "BC2", name: "Bitcoinii", algo: "SHA-256", slug: "bitcoinii" },
  { ticker: "BTCS", name: "BitcoinSilver", algo: "SHA-256", slug: "bitcoinsilver" },
  { ticker: "BSV", name: "BitcoinSV", algo: "SHA-256", slug: "bitcoinsv" },
  { ticker: "DVT", name: "DeVault", algo: "SHA-256", slug: "devault" },
  { ticker: "DGB_SHA256", name: "Digibyte SHA256", algo: "SHA-256", slug: "digibyte_sha256" },
  { ticker: "XEC", name: "ECash", algo: "SHA-256", slug: "ecash" },
  { ticker: "EMC", name: "Emercoin", algo: "SHA-256", slug: "emercoin" },
  { ticker: "XRG", name: "Ergon", algo: "SHA-256", slug: "ergon" },
  { ticker: "FIX", name: "FixedCoin", algo: "SHA-256", slug: "fixedcoin" },
  { ticker: "FB", name: "FractalBitcoin", algo: "SHA-256", slug: "fractalbitcoin" },
  { ticker: "FB_MERGED", name: "FractalBitcoin merged", algo: "SHA-256", slug: "fractalbitcoin_merged" },
  { ticker: "FCH", name: "FreeCash", algo: "SHA-256", slug: "freecash" },
  { ticker: "SPACE", name: "MVC", algo: "SHA-256", slug: "mvc" },
  { ticker: "NMC", name: "Namecoin", algo: "SHA-256", slug: "namecoin" },
  { ticker: "PPC", name: "Peercoin", algo: "SHA-256", slug: "peercoin" },
  { ticker: "QUAI", name: "Quai", algo: "SHA-256", slug: "quai" },
  { ticker: "TRC", name: "Terracoin", algo: "SHA-256", slug: "terracoin" },
  { ticker: "WJK", name: "Wojakcoin", algo: "SHA-256", slug: "wojakcoin" },
  { ticker: "CHI", name: "Xaya", algo: "SHA-256", slug: "xaya" },
  { ticker: "B1T", name: "B1T", algo: "Scrypt", slug: "b1t" },
  { ticker: "BEL", name: "Bells", algo: "Scrypt", slug: "bells" },
  { ticker: "XCCX", name: "BlockChainCoinX", algo: "Scrypt", slug: "blockchaincoinx" },
  { ticker: "BONC", name: "BonkCoin", algo: "Scrypt", slug: "bonkcoin" },
  { ticker: "CAT", name: "Catcoin", algo: "Scrypt", slug: "catcoin" },
  { ticker: "CRC", name: "Craftcoin", algo: "Scrypt", slug: "craftcoin" },
  { ticker: "CY", name: "Cyberyen", algo: "Scrypt", slug: "cyberyen" },
  { ticker: "DGB", name: "Digibyte", algo: "Scrypt", slug: "digibyte" },
  { ticker: "DINGO", name: "Dingocoin", algo: "Scrypt", slug: "dingocoin" },
  { ticker: "DOGE", name: "Dogecoin", algo: "Scrypt", slug: "dogecoin" },
  { ticker: "EAC", name: "Earthcoin", algo: "Scrypt", slug: "earthcoin" },
  { ticker: "FEC", name: "Ferrite", algo: "Scrypt", slug: "ferrite" },
  { ticker: "FLOP", name: "Flopcoin", algo: "Scrypt", slug: "flopcoin" },
  { ticker: "IBH", name: "Ibithub", algo: "Scrypt", slug: "ibithub" },
  { ticker: "JKC", name: "Junkcoin", algo: "Scrypt", slug: "junkcoin" },
  { ticker: "LBW", name: "Lebowskiscoin", algo: "Scrypt", slug: "lebowskiscoin" },
  { ticker: "LTC", name: "Litecoin", algo: "Scrypt", slug: "litecoin" },
  { ticker: "LC2", name: "LitecoinII", algo: "Scrypt", slug: "litecoinii" },
  { ticker: "LKY", name: "Luckycoin", algo: "Scrypt", slug: "luckycoin" },
  { ticker: "MTBC", name: "MateableCoin", algo: "Scrypt", slug: "mateablecoin" },
  { ticker: "MOON", name: "Mooncoin", algo: "Scrypt", slug: "mooncoin" },
  { ticker: "NYC", name: "Newyorkcoin", algo: "Scrypt", slug: "newyorkcoin" },
  { ticker: "PEP", name: "Pepecoin", algo: "Scrypt", slug: "pepecoin" },
  { ticker: "QUAI_SCRYPT", name: "Quai Scrypt", algo: "Scrypt", slug: "quai_scrypt" },
  { ticker: "SHIC", name: "ShibaInucoin", algo: "Scrypt", slug: "shibainucoin" },
  { ticker: "SOH", name: "StohnCoin", algo: "Scrypt", slug: "stohncoin" },
  { ticker: "TMC", name: "TheMinerzCoin", algo: "Scrypt", slug: "theminerzcoin" },
  { ticker: "TRMP", name: "Trumpow", algo: "Scrypt", slug: "trumpow" },
  { ticker: "XVG", name: "Verge", algo: "Scrypt", slug: "verge" },
  { ticker: "WDC", name: "Worldcoin", algo: "Scrypt", slug: "worldcoin" },
];

export function findDutchCoin(
  ticker: string,
  list: readonly DutchCoin[] = DUTCH_COINS,
): DutchCoin | undefined {
  return list.find((coin) => coin.ticker === ticker);
}
