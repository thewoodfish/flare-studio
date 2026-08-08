/** @type {import('next').NextConfig} */
export default {
  // The policy package is consumed as TypeScript source rather than a build
  // artifact, so the app and the package can never drift out of sync.
  transpilePackages: ['@flare-studio/policy'],

  webpack: (config) => {
    // That package writes ESM-correct `./foo.js` specifiers that point at
    // `foo.ts` on disk. Node resolves this natively; bundlers need telling.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    }
    return config
  },
}
