// Copia ffmpeg-core.js/.wasm de node_modules/@ffmpeg/core (versão single-thread — não
// precisa de cabeçalhos COOP/COEP pra rodar, ao contrário da variante -mt) pra
// public/ffmpeg, de onde o navegador carrega em runtime só quando alguém tenta enviar um
// vídeo grande demais (ver src/lib/media/compress.ts). Roda automaticamente depois de
// `npm install` (inclusive na Vercel, antes do build) — o arquivo .wasm (~32MB) nunca é
// versionado no git, só a dependência em si (ver .gitignore).
const fs = require('fs')
const path = require('path')

const DEST_DIR = path.join(__dirname, '..', 'public', 'ffmpeg')

// ffmpeg.js (o wrapper em si, build UMD) é carregado via <script> injetada em runtime em
// vez de importado pelo bundler — o pacote @ffmpeg/ffmpeg usa `new Worker(new
// URL(classWorkerURL, import.meta.url))` internamente, e o Turbopack do Next.js não
// consegue analisar isso estaticamente quando importado como módulo ES ("Cannot find
// module as expression is too dynamic"). O build UMD é self-contained (embute seu
// próprio bundler interno) e não tem esse problema quando carregado como <script> comum.
const FFMPEG_UMD_DIR = path.join(__dirname, '..', 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'umd')
const CORE_COPIES = [
  { src: ['@ffmpeg', 'core', 'dist', 'umd', 'ffmpeg-core.js'], dest: 'ffmpeg-core.js' },
  { src: ['@ffmpeg', 'core', 'dist', 'umd', 'ffmpeg-core.wasm'], dest: 'ffmpeg-core.wasm' },
]

function main() {
  fs.mkdirSync(DEST_DIR, { recursive: true })

  for (const { src, dest } of CORE_COPIES) {
    const srcPath = path.join(__dirname, '..', 'node_modules', ...src)
    const destPath = path.join(DEST_DIR, dest)
    if (!fs.existsSync(srcPath)) {
      console.warn(`[copy-ffmpeg-core] Arquivo esperado não encontrado (dependência instalada?): ${srcPath}`)
      continue
    }
    fs.copyFileSync(srcPath, destPath)
  }

  // Copia ffmpeg.js E o(s) chunk(s) que ele carrega em runtime (ex: 814.ffmpeg.js — o
  // worker propriamente dito) — o nome do chunk pode mudar entre versões do pacote, daí
  // copiar todo *.ffmpeg.js do diretório UMD em vez de um nome fixo.
  if (fs.existsSync(FFMPEG_UMD_DIR)) {
    for (const file of fs.readdirSync(FFMPEG_UMD_DIR)) {
      // "ffmpeg.js" (entrada principal) e os chunks numerados tipo "814.ffmpeg.js"
      // (worker) — não pega os .map de source map, que não precisam ir pro navegador.
      if (file === 'ffmpeg.js' || file.endsWith('.ffmpeg.js')) {
        fs.copyFileSync(path.join(FFMPEG_UMD_DIR, file), path.join(DEST_DIR, file))
      }
    }
  } else {
    console.warn(`[copy-ffmpeg-core] Diretório não encontrado (dependência instalada?): ${FFMPEG_UMD_DIR}`)
  }

  console.log('[copy-ffmpeg-core] ffmpeg.js + chunks + ffmpeg-core copiados para public/ffmpeg/.')
}

main()
