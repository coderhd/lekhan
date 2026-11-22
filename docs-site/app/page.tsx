import { redirect } from "next/navigation";

/**
 * The docs site has one real entry point: Getting Started. Deep links and the
 * marketing site should land on usable content, never a bare app shell.
 */
export default function Home() {
	redirect("/docs/getting-started");
}
