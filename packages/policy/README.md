# @flare-studio/policy

The shared spine. The browser, the TEE, and the contracts all agree here or not
at all.

## Commitment

`commitment.ts` is the most dangerous file in the repo -- not because it is
complex, but because the same hash must be produced by three implementations:
TypeScript (browser, at deploy), Solidity (`ConfidentialPolicy.execute`), and Go
(inside the TEE, before signing).

`fixtures/commitment-vectors.json` is the contract between them. All three test
suites assert against it.

```bash
pnpm vectors   # regenerate from the TypeScript reference implementation
```

Expect the Solidity and Go suites to fail after regenerating. That failure is the
safety net working -- do not silence it.

## The split

`compile.ts` divides a policy into `publicArgs` (on-chain, world-readable) and
`privateConfig` (encrypted to the enclave). Putting a field on the wrong side
would break confidentiality while every other test still passed, so
`test/compile.test.ts` asserts on the *serialized* public half rather than on
known field names.
