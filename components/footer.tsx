import React from 'react';

export default function Footer() {
  return (
    <footer className="w-full py-4 px-6 border-t border-black/10 dark:border-white/10 bg-surface dark:bg-surface-container flex flex-col sm:flex-row justify-between items-center text-sm text-on-surface-variant">
      <div className="flex items-center gap-2 mb-2 sm:mb-0">
        <span className="font-semibold">Harsh Dave</span>
        <span className="text-black/30 dark:text-white/30">|</span>
        <span>House of EdTech Assignment</span>
      </div>
      <div className="flex gap-4">
        <a 
          href="https://github.com/coderhd" 
          target="_blank" 
          rel="noopener noreferrer"
          className="hover:text-primary transition-colors flex items-center gap-1"
        >
          GitHub
        </a>
        <a 
          href="https://www.linkedin.com/in/harsh-dave-1095/" 
          target="_blank" 
          rel="noopener noreferrer"
          className="hover:text-primary transition-colors flex items-center gap-1"
        >
          LinkedIn
        </a>
      </div>
    </footer>
  );
}
