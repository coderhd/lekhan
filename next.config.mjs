/** @type {import('next').NextConfig} */
const nextConfig = {
	turbopack: {
		root: process.cwd(),
	},
	webpack: (config, { isServer }) => {
		if (!isServer) {
			config.resolve.fallback = {
				...config.resolve.fallback,
				fs: false,
				path: false,
				crypto: false,
			}
		}
		return config
	},
}

export default nextConfig
