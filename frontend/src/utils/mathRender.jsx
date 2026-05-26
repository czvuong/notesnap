/**
 * mathRender.jsx — shared KaTeX rendering utilities.
 *
 * Imported by NoteEditor and StudyTools so both render math consistently.
 */
import katex from 'katex'
import 'katex/dist/katex.min.css'

/** Strip leading/trailing ** from a heading string the model may have emitted. */
export function stripMdBold(text) {
  if (!text) return text
  return text.replace(/^\*\*(.+)\*\*$/, '$1').trim()
}

/**
 * Parse a string and replace math markup with rendered KaTeX elements.
 * Handles:
 *   $$...$$  — display math (block)
 *   $...$    — inline math
 *   \[...\]  — display math (standard LaTeX)
 *   \(...\)  — inline math (standard LaTeX)
 *   \cmd     — bare LaTeX commands (e.g. \therefore, \leftarrow)
 */
export function renderInlineMath(text) {
  if (!text) return []

  // Split on all supported math delimiters
  const parts = text.split(
    /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g
  )

  return parts.flatMap((part, i) => {
    // $$...$$ — display
    if (part.startsWith('$$') && part.endsWith('$$') && part.length > 4) {
      const inner = part.slice(2, -2).trim()
      try {
        const html = katex.renderToString(inner, { displayMode: true, throwOnError: false })
        return [<span key={i} className="inline-math-display" dangerouslySetInnerHTML={{ __html: html }} />]
      } catch { return [part] }
    }
    // $...$ — inline
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      const inner = part.slice(1, -1).trim()
      try {
        const html = katex.renderToString(inner, { displayMode: false, throwOnError: false })
        return [<span key={i} className="inline-math" dangerouslySetInnerHTML={{ __html: html }} />]
      } catch { return [part] }
    }
    // \[...\] — display
    if (part.startsWith('\\[') && part.endsWith('\\]')) {
      const inner = part.slice(2, -2).trim()
      try {
        const html = katex.renderToString(inner, { displayMode: true, throwOnError: false })
        return [<span key={i} className="inline-math-display" dangerouslySetInnerHTML={{ __html: html }} />]
      } catch { return [part] }
    }
    // \(...\) — inline
    if (part.startsWith('\\(') && part.endsWith('\\)')) {
      const inner = part.slice(2, -2).trim()
      try {
        const html = katex.renderToString(inner, { displayMode: false, throwOnError: false })
        return [<span key={i} className="inline-math" dangerouslySetInnerHTML={{ __html: html }} />]
      } catch { return [part] }
    }
    // Bare LaTeX commands like \therefore
    if (!part.includes('\\')) return [part]
    const subParts = part.split(/(\\[a-zA-Z]+(?:\{[^}]*\})*)/g)
    return subParts.map((sub, j) => {
      if (sub.startsWith('\\')) {
        try {
          const html = katex.renderToString(sub, { displayMode: false, throwOnError: true, output: 'html' })
          return <span key={`${i}-${j}`} className="inline-math" dangerouslySetInnerHTML={{ __html: html }} />
        } catch { return sub }
      }
      return sub
    })
  })
}

/**
 * Render text that may contain **bold** markers AND inline math.
 * Returns an array of React nodes.
 */
export function renderRichText(text) {
  if (!text) return []
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g)
  return boldParts.flatMap((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const inner = part.slice(2, -2)
      return [<strong key={`b${i}`}>{renderInlineMath(inner)}</strong>]
    }
    return renderInlineMath(part).map((node, j) =>
      typeof node === 'string' ? node : <span key={`${i}-${j}`}>{node}</span>
    )
  })
}
