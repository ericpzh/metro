// Audit runtime display sinks. Authored station/sign text and data are inputs,
// not copy to translate. Site/art catalogues have their own coverage checks.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from '../game/node_modules/typescript/lib/typescript.js'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogues = new Set(['messages.ts', 'i18n.js', 'artworks.js'])
const technical = new Set(['m', 'ms', 'GitHub'])
const attributes = new Set(['title', 'aria-label', 'placeholder', 'alt'])
const findings = []
let checked = 0

function human(text) {
  return /[A-Za-z\u3400-\u9fff]/u.test(text) && !technical.has(text.trim())
}

function scan(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  checked++
  function report(node, kind, text) {
    if (!human(text)) return
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
    findings.push(relative(repo, file) + ':' + line + ' ' + kind + ': ' + JSON.stringify(text.trim()))
  }
  function copy(node, kind) {
    // Catalog lookup arguments and authored values are not inline display copy.
    if (ts.isCallExpression(node)) return
    if (ts.isStringLiteralLike(node)) report(node, kind, node.text)
    else if (ts.isTemplateExpression(node)) {
      report(node, kind, [node.head.text, ...node.templateSpans.map(s => s.literal.text)].join(''))
    } else if (ts.isConditionalExpression(node)) {
      copy(node.whenTrue, kind)
      copy(node.whenFalse, kind)
    } else if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if ([ts.SyntaxKind.PlusToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(op)) {
        copy(node.left, kind)
        copy(node.right, kind)
      } else if (op === ts.SyntaxKind.AmpersandAmpersandToken) copy(node.right, kind)
    } else if (ts.isParenthesizedExpression(node)) copy(node.expression, kind)
  }
  function visit(node) {
    if (ts.isJsxText(node)) report(node, 'JSX text', node.text)
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) copy(node.expression, 'JSX copy')
    if (ts.isJsxAttribute(node) && attributes.has(node.name.getText(source)) && node.initializer) {
      const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer
      if (value) copy(value, node.name.getText(source))
    }
    if (ts.isCallExpression(node)) {
      const fn = node.expression
      if (ts.isPropertyAccessExpression(fn) && ['fillText', 'strokeText'].includes(fn.name.text) && node.arguments[0]) {
        copy(node.arguments[0], 'canvas copy')
      } else if (ts.isIdentifier(fn) && fn.text === 'drawModelText' && node.arguments[1]) {
        copy(node.arguments[1], 'model decal')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (/\.[jt]sx?$/.test(entry.name) && !catalogues.has(entry.name)) scan(file)
  }
}
walk(join(repo, 'game/src'))
walk(join(repo, 'web/src'))
if (findings.length) {
  console.error(findings.join('\n'))
  process.exitCode = 1
} else console.log('i18n audit: ' + checked + ' runtime source files; no inline interface or decal copy')
