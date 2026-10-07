// Conservative static audit: findings are review candidates, never auto-deletions.
// Shared classic scripts are checked together so cross-file globals stay live.
import ts from 'typescript';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';

const files = execFileSync('git', ['ls-files'], {encoding:'utf8'}).trim().split(/\r?\n/)
  .filter(file => existsSync(file) && /\.(?:js|mjs|ts|tsx)$/.test(file) && !/^(?:public|scripts|components)\//.test(file));
const program = ts.createProgram(files, {allowJs:true, noEmit:true, target:ts.ScriptTarget.ESNext,
  module:ts.ModuleKind.ESNext, moduleResolution:ts.ModuleResolutionKind.Bundler,
  moduleDetection:ts.ModuleDetectionKind.Legacy});
const checker = program.getTypeChecker(), references = new Map(), declarations = [];
for (const file of files) {
  const source = program.getSourceFile(file);
  if (!source) continue;
  const visit = node => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol) references.set(symbol, (references.get(symbol)||0)+1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const statement of source.statements) {
    if (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export) continue;
    const names = ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)
      ? [statement.name] : ts.isVariableStatement(statement)
        ? statement.declarationList.declarations.map(declaration=>declaration.name) : [];
    for (const name of names.filter(name=>name&&ts.isIdentifier(name))) {
      const symbol=checker.getSymbolAtLocation(name);
      declarations.push({file, name:name.text, line:source.getLineAndCharacterOfPosition(name.getStart()).line+1, symbol});
    }
  }
}
console.log(JSON.stringify({files:files.length, candidates:declarations.filter(d=>(references.get(d.symbol)||0)<=1)
  .map(({symbol,...details})=>details)},null,2));
