import React, { useState } from 'react';

export default function CodeBlock({ children, language = 'typescript', title }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-4 rounded-lg overflow-hidden bg-gray-900">
      {title && (
        <div className="px-4 py-2 bg-gray-800 text-gray-400 text-xs font-mono border-b border-gray-700">
          {title}
        </div>
      )}
      <div className="relative">
        <pre className="p-4 overflow-x-auto text-sm">
          <code className={`language-${language} text-gray-100`}>
            {children}
          </code>
        </pre>
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 px-2 py-1 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function InlineCode({ children }) {
  return (
    <code className="px-1.5 py-0.5 bg-gray-100 text-gray-800 text-sm rounded font-mono">
      {children}
    </code>
  );
}
