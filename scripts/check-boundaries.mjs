// Enforces the feature boundaries described in docs/feature-boundaries.md.
// Usage: node scripts/check-boundaries.mjs
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const repo = path.resolve(import.meta.dirname, '..');
const apps = [
  {
    name: 'api',
    dir: 'apps/api',
    entries: ['index.ts', 'tables.ts'],
    // The unit of work holds every feature's repository for one transaction.
    exempt: (from, to) =>
      from === 'src/unit-of-work/unit-of-work-context.ts' &&
      to.endsWith('.repository.ts'),
    // Data-layer files are loaded by the unit of work, which every service
    // imports, so reaching a feature's index from them closes an import cycle.
    dataLayer: /\.(repository|table|persistence)\.ts$/,
    unitOfWork: 'src/unit-of-work/unit-of-work-context.ts',
  },
  {
    name: 'web',
    dir: 'apps/web',
    entries: ['index.ts'],
    // Routes compose features, so they may import screens directly.
    composition: (file) => file.startsWith('src/app/'),
    // Shared components and utilities stay independent of features.
    independent: (file) =>
      file.startsWith('src/lib/') ||
      (file.startsWith('src/components/') &&
        !file.startsWith('src/components/layout/')),
  },
];

const isTest = (file) =>
  /\.test\.tsx?$/.test(file) || file.split('/').includes('testing');
const featureOf = (file) =>
  file.startsWith('src/features/') ? file.split('/')[2] : null;

const problems = [];
const report = (app, sf, node, message) => {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  problems.push(
    `${app.dir}/${path.relative(app.root, sf.fileName)}:${line + 1}  ${message}`,
  );
};

for (const app of apps) {
  app.root = path.join(repo, app.dir);
  const configPath = path.join(app.root, 'tsconfig.json');
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, ts.sys.readFile).config,
    ts.sys,
    app.root,
  );
  const files = config.fileNames.filter(
    (f) => f.startsWith(path.join(app.root, 'src')) && !f.endsWith('.d.ts'),
  );
  const rel = (f) => path.relative(app.root, f).split(path.sep).join('/');
  const resolve = (spec, from) => {
    const found = ts.resolveModuleName(
      spec,
      from,
      config.options,
      ts.sys,
    ).resolvedModule;
    return found && !found.isExternalLibraryImport
      ? rel(path.resolve(found.resolvedFileName))
      : null;
  };
  const program = app.unitOfWork
    ? ts.createProgram(files, config.options)
    : null;
  const featureEdges = new Map(); // "a>b" -> first importing file
  const runtimeImports = new Map(); // file -> Set(file)

  for (const fileName of files) {
    const file = rel(fileName);
    const sf =
      program?.getSourceFile(fileName) ??
      ts.createSourceFile(
        fileName,
        fs.readFileSync(fileName, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
    const own = featureOf(file);
    const test = isTest(file);
    for (const statement of sf.statements) {
      if (
        !(
          ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
        ) ||
        !statement.moduleSpecifier
      )
        continue;
      const target = resolve(statement.moduleSpecifier.text, fileName);
      if (!target) continue;
      const clause = ts.isImportDeclaration(statement)
        ? statement.importClause
        : statement;
      const bindings = clause?.namedBindings;
      const typeOnly =
        !!clause?.isTypeOnly ||
        (!clause?.name &&
          !!bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) {
        const set = runtimeImports.get(file) ?? new Set();
        runtimeImports.set(file, set.add(target));
      }

      const feature = featureOf(target);
      if (!feature || feature === own) continue;
      if (app.independent?.(file)) {
        report(app, sf, statement, `shared code imports feature ${feature}`);
        continue;
      }
      if (app.composition?.(file) || app.exempt?.(file, target)) continue;
      const entry = target.slice(`src/features/${feature}/`.length);
      if (entry === 'testing/index.ts') {
        if (!test)
          report(app, sf, statement, `${feature}/testing is for tests only`);
      } else if (!app.entries.includes(entry))
        report(
          app,
          sf,
          statement,
          `deep import of ${target}; use ${app.entries.map((e) => `${feature}/${e}`).join(' or ')}`,
        );
      else if (app.dataLayer?.test(file) && entry !== 'tables.ts')
        report(
          app,
          sf,
          statement,
          `data-layer file imports ${feature}/${entry}; use ${feature}/tables.ts`,
        );
      else if (own && !test && entry === 'index.ts') {
        const key = `${own}>${feature}`;
        if (!featureEdges.has(key)) featureEdges.set(key, file);
      }
    }
  }

  // Feature dependencies through public APIs must form a DAG. Table reads
  // are allowed in either direction and are not part of this graph.
  const featureGraph = new Map();
  for (const key of featureEdges.keys()) {
    const [a, b] = key.split('>');
    featureGraph.set(a, [...(featureGraph.get(a) ?? []), b]);
  }
  for (const cycle of stronglyConnected(featureGraph))
    problems.push(
      `${app.dir}: feature cycle ${cycle.join(' ⇄ ')}\n` +
        [...featureEdges]
          .filter(([key]) => key.split('>').every((f) => cycle.includes(f)))
          .map(([key, file]) => `    ${key.replace('>', ' → ')} (${file})`)
          .join('\n'),
    );
  // Runtime import cycles leave a module half-initialized when another reads
  // it; with decorators that surfaces as an undefined injection token.
  const fileGraph = new Map(
    [...runtimeImports].map(([file, targets]) => [file, [...targets]]),
  );
  for (const cycle of stronglyConnected(fileGraph))
    problems.push(`${app.dir}: import cycle\n    ${cycle.join('\n    ')}`);

  if (program) checkDataAccess(app, program, files, rel);
}

// Features write only their own tables and reach the unit of work's
// repositories only for their own feature; other effects go through services.
function checkDataAccess(app, program, files, rel) {
  const checker = program.getTypeChecker();
  const declaringFeature = (symbol) => {
    if (!symbol) return null;
    if (symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const decl = symbol.declarations?.[0];
    return decl ? rel(decl.getSourceFile().fileName) : null;
  };
  // Map each unit-of-work repository property to the feature owning its class.
  const unitOfWork = program.getSourceFile(path.join(app.root, app.unitOfWork));
  const repositories = new Map();
  const collect = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isNewExpression(node.initializer)) {
      const owner = declaringFeature(
        checker.getSymbolAtLocation(node.initializer.expression),
      );
      repositories.set(node, featureOf(owner));
    }
    ts.forEachChild(node, collect);
  };
  collect(unitOfWork);

  for (const fileName of files) {
    const file = rel(fileName);
    const own = featureOf(file);
    if (!own || isTest(file)) continue;
    const sf = program.getSourceFile(fileName);
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ['insert', 'update', 'delete'].includes(node.expression.name.text) &&
        node.arguments[0] &&
        ts.isIdentifier(node.arguments[0])
      ) {
        const table = declaringFeature(
          checker.getSymbolAtLocation(node.arguments[0]),
        );
        if (table?.endsWith('.table.ts') && featureOf(table) !== own)
          report(
            app,
            sf,
            node,
            `${node.expression.name.text} on ${featureOf(table)}'s table; call its service`,
          );
      }
      if (ts.isPropertyAccessExpression(node)) {
        const symbol = checker.getSymbolAtLocation(node.name);
        for (const root of symbol ? checker.getRootSymbols(symbol) : []) {
          const owner = repositories.get(root.declarations?.[0]);
          if (owner && owner !== own)
            report(
              app,
              sf,
              node,
              `uses ${owner}'s repository from the unit of work; call its service`,
            );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

// Tarjan's algorithm; returns components with more than one node.
function stronglyConnected(graph) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const low = new Map();
  const found = [];
  const visit = (v) => {
    indices.set(v, index);
    low.set(v, index++);
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!indices.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w))
        low.set(v, Math.min(low.get(v), indices.get(w)));
    }
    if (low.get(v) === indices.get(v)) {
      const component = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) found.push(component.sort());
    }
  };
  for (const v of graph.keys()) if (!indices.has(v)) visit(v);
  return found;
}

if (problems.length) {
  console.error(
    `Feature boundary violations:\n\n${problems.join('\n')}\n\nSee docs/feature-boundaries.md.`,
  );
  process.exit(1);
}
console.log('Feature boundaries hold.');
