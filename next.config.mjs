/* global process */
/** @type {import('next').NextConfig} */
const nextConfig = {
	turbopack: {
		root: process.cwd(),
		resolveAlias: {
			fs: {},
			path: {},
			crypto: {},
		},
	},
}

export default nextConfig
