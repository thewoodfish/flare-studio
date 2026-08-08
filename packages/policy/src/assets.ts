/**
 * Every asset-specific fact lives here and nowhere else.
 *
 * The test of this file is a claim we make in the README: adding FBTC the day it
 * goes live should be one entry here and no other change -- no contract, no
 * compiler, no new trigger. `assets.test.ts` enforces the shape; the FBTC entry
 * below is deliberately present and disabled to prove the shape accommodates it.
 *
 * This works because the underlying Flare primitives are already multi-chain:
 * FDC's ReferencedPaymentNonexistence supports XRP, BTC and DOGE, so the
 * proof-of-life trigger takes `fdcSourceId` as a parameter rather than baking in
 * a chain.
 */

export type AddressFormat = 'xrpl' | 'btc' | 'doge'

export type SupportedAsset = {
  /** What we call it in the product. */
  symbol: string
  name: string
  /** FlareContractRegistry key -> AssetManager -> fAsset(). Never a hardcoded token address. */
  assetManagerKey: string
  /**
   * The token's own `symbol()`, where it differs from ours. Testnet FAssets are
   * prefixed (FTestXRP), and showing that in the primary flow would confuse
   * users about which asset they hold.
   */
  onChainSymbol?: string
  decimals: number
  /** FDC attestation source id, e.g. 'testXRP'. */
  fdcSourceId: string
  /** FTSOv2 feed id for price conditions. */
  ftsoFeedId: `0x${string}`
  /** Governs how the UI validates a proof-of-life destination address. */
  addressFormat: AddressFormat
  /** Smallest sensible proof-of-life payment, in the chain's base unit. */
  minimumHeartbeat: bigint
  /** Live assets are selectable; others are visible but disabled in the UI. */
  live: boolean
}

export const ASSETS: Record<string, SupportedAsset> = {
  FXRP: {
    symbol: 'FXRP',
    name: 'XRP',
    assetManagerKey: 'AssetManagerFXRP',
    // Verified on-chain, Coston2: registry -> AssetManagerFXRP
    // (0xc1Ca...bDFA) -> fAsset() -> 0x0b6A3645c240605887a5532109323A3E12273dc7,
    // which reports name "FXRP", symbol "FTestXRP", decimals 6.
    //
    // The testnet token's *symbol* is FTestXRP, not FXRP. We deliberately show
    // "FXRP" in the UI because that is the asset users are reasoning about; the
    // on-chain symbol appears in the under-the-hood panel where precision
    // matters more than familiarity.
    onChainSymbol: 'FTestXRP',
    decimals: 6,
    fdcSourceId: 'testXRP',
    // XRP/USD. Verify against the Flare dev hub feed table before mainnet.
    ftsoFeedId: '0x015852502f55534400000000000000000000000000',
    addressFormat: 'xrpl',
    // 0.1 XRP in drops -- large enough to be unambiguous, small enough to be free.
    minimumHeartbeat: 100_000n,
    live: true,
  },

  /**
   * Not yet live as an FAsset. Present so the shape is proven now rather than
   * assumed: when FBTC ships, flipping `live` is the whole change.
   */
  FBTC: {
    symbol: 'FBTC',
    name: 'Bitcoin',
    assetManagerKey: 'AssetManagerFBTC',
    decimals: 8,
    fdcSourceId: 'testBTC',
    ftsoFeedId: '0x014254432f55534400000000000000000000000000',
    addressFormat: 'btc',
    minimumHeartbeat: 1_000n,
    live: false,
  },
}

export function getAsset(symbol: string): SupportedAsset {
  const asset = ASSETS[symbol]
  if (!asset) {
    throw new Error(
      `Unknown asset "${symbol}". Known: ${Object.keys(ASSETS).join(', ')}. ` +
        `Adding an asset should be one entry in assets.ts and nothing else.`,
    )
  }
  return asset
}

export function liveAssets(): SupportedAsset[] {
  return Object.values(ASSETS).filter((a) => a.live)
}
