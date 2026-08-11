'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type EIP1193Provider,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { coston2 } from './chain'

/**
 * Wallet connection, hand-rolled against EIP-1193.
 *
 * The plan specified wagmi + RainbowKit. Neither is here, deliberately: the app
 * needs one chain, one connector and about six calls, and RainbowKit's modal
 * would be the only part of the product that does not look like the product.
 * The cost of doing without is this file, which is smaller than the config
 * those libraries would have required.
 */

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

export type WalletState = {
  account: Address | null
  chainId: number | null
  connecting: boolean
  error: string | null
  /** False when no injected wallet is present at all -- a different problem. */
  available: boolean
  onCoston2: boolean
  connect: () => Promise<void>
  /** Prompts a network switch, adding Coston2 if the wallet has never seen it. */
  switchToCoston2: () => Promise<void>
}

/** Read-only client. Always available, no wallet required. */
export function publicClient(): PublicClient {
  return createPublicClient({ chain: coston2, transport: http() })
}

export function walletClient(account: Address): WalletClient {
  const provider = window.ethereum
  if (!provider) throw new Error('no injected wallet')
  return createWalletClient({ account, chain: coston2, transport: custom(provider) })
}

export function useWallet(): WalletState {
  const [account, setAccount] = useState<Address | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [available, setAvailable] = useState(false)

  // Reconnect silently on load. `eth_accounts` -- unlike `eth_requestAccounts` --
  // never prompts, so a returning user sees their address without a popup they
  // did not ask for.
  useEffect(() => {
    const provider = window.ethereum
    if (!provider) return
    setAvailable(true)

    let cancelled = false
    void (async () => {
      const accounts = (await provider.request({ method: 'eth_accounts' })) as Address[]
      const id = (await provider.request({ method: 'eth_chainId' })) as string
      if (cancelled) return
      setAccount(accounts[0] ?? null)
      setChainId(Number.parseInt(id, 16))
    })()

    const onAccountsChanged = (accounts: unknown) =>
      setAccount((accounts as Address[])[0] ?? null)
    // A chain switch invalidates every address, balance and nonce on screen.
    // Reloading is blunt, but it is also what every wallet's own docs recommend,
    // and it is far better than rendering Coston2 data under a Mainnet header.
    const onChainChanged = () => window.location.reload()

    provider.on('accountsChanged', onAccountsChanged)
    provider.on('chainChanged', onChainChanged)

    return () => {
      cancelled = true
      provider.removeListener('accountsChanged', onAccountsChanged)
      provider.removeListener('chainChanged', onChainChanged)
    }
  }, [])

  const switchToCoston2 = useCallback(async () => {
    const provider = window.ethereum
    if (!provider) throw new Error('no injected wallet')

    const hexId = `0x${coston2.id.toString(16)}`
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexId }],
      })
    } catch (e) {
      // 4902: the wallet has never heard of this chain. Adding it is the whole
      // remedy, and every wallet that returns 4902 supports wallet_addEthereumChain.
      if ((e as { code?: number }).code !== 4902) throw e
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: hexId,
            chainName: coston2.name,
            nativeCurrency: coston2.nativeCurrency,
            rpcUrls: [...coston2.rpcUrls.default.http],
            blockExplorerUrls: [coston2.blockExplorers.default.url],
          },
        ],
      })
    }
    setChainId(coston2.id)
  }, [])

  const connect = useCallback(async () => {
    const provider = window.ethereum
    if (!provider) {
      setError('No wallet found. Install MetaMask or another EVM wallet to continue.')
      return
    }

    setConnecting(true)
    setError(null)
    try {
      const accounts = (await provider.request({
        method: 'eth_requestAccounts',
      })) as Address[]
      setAccount(accounts[0] ?? null)

      const id = (await provider.request({ method: 'eth_chainId' })) as string
      if (Number.parseInt(id, 16) !== coston2.id) await switchToCoston2()
      else setChainId(coston2.id)
    } catch (e) {
      setError(walletErrorMessage(e))
    } finally {
      setConnecting(false)
    }
  }, [switchToCoston2])

  return useMemo(
    () => ({
      account,
      chainId,
      connecting,
      error,
      available,
      onCoston2: chainId === coston2.id,
      connect,
      switchToCoston2,
    }),
    [account, chainId, connecting, error, available, connect, switchToCoston2],
  )
}

/**
 * Wallet errors arrive as sprawling objects whose useful sentence is buried
 * several levels down. Users get the sentence; the console keeps the object.
 */
export function walletErrorMessage(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const err = e as { code?: number; shortMessage?: string; message?: string }
    if (err.code === 4001) return 'You rejected the request in your wallet.'
    if (err.shortMessage) return err.shortMessage
    if (err.message) return err.message.split('\n')[0]!
  }
  return String(e)
}
