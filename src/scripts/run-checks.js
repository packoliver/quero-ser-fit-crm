/* eslint-disable */
const { execSync } = require('child_process');

console.log('=== 1. Executando Bateria de Testes Vitest ===');
try {
  const vitestOutput = execSync('node node_modules/vitest/vitest.mjs run', { encoding: 'utf8', stdio: 'pipe' });
  console.log(vitestOutput);
} catch (err) {
  console.error('Vitest falhou:', err.stdout || err.message);
  process.exit(1);
}

console.log('=== 2. Executando TypeScript Strict Typecheck (npx tsc --noEmit) ===');
try {
  const tscOutput = execSync('node node_modules/typescript/bin/tsc --noEmit', { encoding: 'utf8', stdio: 'pipe' });
  console.log(tscOutput || '0 erros de TypeScript.');
} catch (err) {
  console.error('TypeScript falhou:', err.stdout || err.message);
  process.exit(1);
}

console.log('=== 3. Executando ESLint (npm run lint) ===');
try {
  const eslintOutput = execSync('node node_modules/eslint/bin/eslint.js .', { encoding: 'utf8', stdio: 'pipe' });
  console.log(eslintOutput || '0 erros de ESLint.');
} catch (err) {
  console.error('ESLint falhou:', err.stdout || err.message);
  process.exit(1);
}

console.log('=== 4. Executando Build de Produção Next.js (next build) ===');
try {
  const buildOutput = execSync('node node_modules/next/dist/bin/next build', { encoding: 'utf8', stdio: 'pipe' });
  console.log(buildOutput);
  console.log('\n✅ BUILD DE PRODUÇÃO CONCLUÍDO COM SUCESSO! Exit code 0.');
} catch (err) {
  console.error('Build falhou:', err.stdout || err.message);
  process.exit(1);
}
