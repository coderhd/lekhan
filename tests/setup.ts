// Mock global APIs if they are missing in jsdom
if (typeof global.structuredClone !== 'function') {
	global.structuredClone = (val: any) => {
		return JSON.parse(JSON.stringify(val))
	}
}
