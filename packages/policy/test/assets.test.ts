import { describe, expect, it } from 'vitest'
import { ASSETS, getAsset, liveAssets } from '../src/assets.js'

/**
 * The asset registry is where the BTC-readiness claim lives: adding an asset
 * should be one entry here and no other change. These tests enforce the shape
 * that claim depends on.
 */
describe('asset registry', () => {
  it('every entry is complete, so a new asset cannot be half-added', () => {
    for (const [key, asset] of Object.entries(ASSETS)) {
      expect(asset.symbol, `${key}.symbol`).toBeTruthy()
      expect(asset.name, `${key}.name`).toBeTruthy()
      expect(asset.assetManagerKey, `${key}.assetManagerKey`).toMatch(/^AssetManager/)
      expect(asset.decimals, `${key}.decimals`).toBeGreaterThan(0)
      expect(asset.fdcSourceId, `${key}.fdcSourceId`).toBeTruthy()
      expect(asset.ftsoFeedId, `${key}.ftsoFeedId`).toMatch(/^0x[0-9a-f]{42}$/)
      expect(asset.minimumHeartbeat, `${key}.minimumHeartbeat`).toBeGreaterThan(0n)
    }
  })

  it('key matches symbol, so getAsset(symbol) always resolves', () => {
    for (const [key, asset] of Object.entries(ASSETS)) {
      expect(asset.symbol).toBe(key)
    }
  })

  /**
   * Verified against Coston2 on 2026-08-08:
   *   registry 0xaD67...6019
   *     -> getContractAddressByName("AssetManagerFXRP") = 0xc1Ca...bDFA
   *     -> fAsset() = 0x0b6A3645c240605887a5532109323A3E12273dc7
   *     -> name "FXRP", symbol "FTestXRP", decimals 6
   *
   * Decimals are pinned because getting them wrong misreports every balance in
   * the product by a factor of 100 or more, and it would look like a UI bug
   * rather than a data bug.
   */
  it('pins FXRP facts verified on Coston2', () => {
    const fxrp = getAsset('FXRP')
    expect(fxrp.decimals).toBe(6)
    expect(fxrp.onChainSymbol).toBe('FTestXRP')
    expect(fxrp.assetManagerKey).toBe('AssetManagerFXRP')
    expect(fxrp.live).toBe(true)
  })

  it('carries a not-yet-live asset, proving the shape accommodates one', () => {
    const notLive = Object.values(ASSETS).filter((a) => !a.live)
    expect(notLive.length).toBeGreaterThan(0)
    expect(liveAssets().every((a) => a.live)).toBe(true)
  })

  it('names the unknown asset and lists the known ones', () => {
    expect(() => getAsset('NOPE')).toThrow(/NOPE.*FXRP/s)
  })
})
