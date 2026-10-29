import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

function walk(dir) {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		return statSync(full).isDirectory() ? walk(full) : [full];
	});
}

const root = "content/docs";
const files = walk(root).filter((f) => f.endsWith(".mdx"));
const routes = new Set(files.map((file) => {
	const rel = relative(root, file).replace(/\.mdx$/, "");
	if (rel === "index") return "/docs";
	if (rel.endsWith("/index")) return `/docs/${rel.slice(0, -"/index".length)}`;
	return `/docs/${rel}`;
}));

const links = new Set();
for (const file of files) {
	const body = readFileSync(file, "utf8");
	for (const match of body.matchAll(/\]\((\/docs[^)\s]*)\)/g)) {
		links.add(match[1].split("#")[0]);
	}
	for (const match of body.matchAll(/href="(\/docs[^"\s]*)"/g)) {
		links.add(match[1].split("#")[0]);
	}
}

const broken = [...links].filter((link) => !routes.has(link)).sort();
console.log(JSON.stringify({ pages: files.length, routes: [...routes].sort(), links: [...links].sort(), broken }, null, 2));
if (broken.length) process.exit(1);
