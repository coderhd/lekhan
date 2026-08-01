/** @type {import('next').NextConfig} */
const nextConfig = {
	turbopack: {
		resolveAlias: {
			fs: './lib/empty.js',
			path: './lib/empty.js',
			crypto: './lib/empty.js',
		},
	},
	webpack: (config, { isServer }) => {
		if (!isServer) {
			config.resolve.fallback = {
				...config.resolve.fallback,
				fs: false,
				path: false,
				crypto: false,
				stream: false,
				util: false,
			}
		}
		return config
	},
}

export default nextConfig
