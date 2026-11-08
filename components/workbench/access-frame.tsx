'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import ThemeToggle from '../theme-toggle'
import styles from './access.module.css'

/** Access presentation only; each route keeps its own session and form handlers. */
export default function AccessFrame({ children, story = true }: { children: ReactNode; story?: boolean }) {
 return <div className={styles.frame}>
  <header className={styles.header}><Link href="/" className={styles.logo}>Lekhan</Link><ThemeToggle /></header>
  <main className={story ? styles.body : styles.publicBody}>
   {story && <aside className={styles.story} aria-label="About Lekhan">
    <h2>Your second brain.<br />Your files.<br />Your AI.</h2>
    <p>A local-first knowledge workspace. Keep the writing connected without giving up control of the work.</p>
   </aside>}
   <div className={styles.form}>{children}</div>
  </main>
  <footer className={styles.footer}><span>Lekhan</span><nav aria-label="Legal"><Link href="/privacy-policy">Privacy</Link><Link href="/terms-of-service">Terms</Link></nav></footer>
 </div>
}
