const fs = require('fs');
const ts = require('typescript');

function formatDiagnostic(source, diagnostic) {
  if (typeof diagnostic.start !== 'number') return diagnostic.messageText;

  const position = source.getLineAndCharacterOfPosition(diagnostic.start);
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  return `${source.fileName}:${position.line + 1}:${position.character + 1} - ${message}`;
}

function parseSource(src, fileName = 'src/App.tsx') {
  const source = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diagnostics = source.parseDiagnostics;

  if (diagnostics.length > 0) {
    throw new Error(diagnostics.map((diagnostic) => formatDiagnostic(source, diagnostic)).join('\n'));
  }

  return [];
}

if (require.main === module) {
  try {
    const src = fs.readFileSync('src/App.tsx', 'utf8');
    const stack = parseSource(src);
    console.log('Remaining stack length:', stack.length);
    console.log('Tail:', stack.slice(-20));
  } catch (error) {
    console.log(error.message);
    process.exit(1);
  }
}

module.exports = { parseSource };
