/* eslint-disable */
/**
 * Gera os ícones do PWA a partir de um SVG, aqui no arquivo.
 *
 * Rodar: node src/scripts/generate-icons.js
 *
 * Não faz parte do build — os PNGs ficam versionados em public/. Isto existe pra que o
 * ícone possa ser refeito sem abrir editor de imagem, e pra deixar registrado como ele
 * foi desenhado. A versão anterior deste arquivo preenchia todos os pixels de verde
 * liso: o ícone na tela de início do iPhone era um quadrado verde sem nada dentro.
 *
 * `sharp` vem junto com o Next (otimização de imagem). Se um dia sumir, os PNGs já
 * gerados continuam valendo — só este gerador para de rodar.
 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const VERDE_CLARO = '#34d399' // emerald-400
const VERDE_ESCURO = '#059669' // emerald-600
const GRAFITE = '#052e21' // verde quase preto: contraste alto sem virar cinza morto

// Halteres do lucide-react (mesmo desenho da marca no menu lateral), viewBox 24.
const HALTERES = `
  <path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z" />
  <path d="m2.5 21.5 1.4-1.4" />
  <path d="m20.1 3.9 1.4-1.4" />
  <path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z" />
  <path d="m9.6 14.4 4.8-4.8" />
`

/**
 * @param {number} lado tamanho do PNG em pixels
 * @param {number} proporcaoGlifo quanto do lado o desenho ocupa (0–1)
 * @param {boolean} fundo false = glifo branco em fundo transparente (ícone de notificação)
 * @param {number|null} tracoPersonalizado espessura do traço; null usa o padrão
 */
function montarSvg(lado, proporcaoGlifo, fundo = true, tracoPersonalizado = null) {
  const glifo = lado * proporcaoGlifo
  const escala = glifo / 24
  const margem = (lado - glifo) / 2
  // 2.7 e não os 2 do lucide: na tela de início do iPhone o ícone aparece com 60px, e
  // com traço fino os halteres viram um rabisco. Comparado lado a lado em 60px antes de
  // fechar esse número — acima de ~3 os entalhes começam a se fechar e vira um borrão.
  const traco = tracoPersonalizado ?? 2.7

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}" viewBox="0 0 ${lado} ${lado}">
  ${
    fundo
      ? `<defs>
    <linearGradient id="fundo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${VERDE_CLARO}" />
      <stop offset="1" stop-color="${VERDE_ESCURO}" />
    </linearGradient>
  </defs>
  <rect width="${lado}" height="${lado}" fill="url(#fundo)" />`
      : ''
  }
  <g transform="translate(${margem} ${margem}) scale(${escala})"
     fill="none" stroke="${fundo ? GRAFITE : '#ffffff'}" stroke-width="${traco}"
     stroke-linecap="round" stroke-linejoin="round">
    ${HALTERES}
  </g>
</svg>`
}

/**
 * Empacota PNGs num .ico. O formato aceita PNG cru dentro de cada entrada desde o
 * Windows Vista, e todo navegador atual lê assim — evita ter que escrever BMP + máscara.
 *
 * Cabeçalho: 6 bytes de diretório + 16 por imagem, e aí os PNGs em sequência.
 */
function montarIco(imagens) {
  const cabecalho = Buffer.alloc(6)
  cabecalho.writeUInt16LE(0, 0) // reservado
  cabecalho.writeUInt16LE(1, 2) // 1 = ícone
  cabecalho.writeUInt16LE(imagens.length, 4)

  let deslocamento = 6 + imagens.length * 16
  const entradas = imagens.map(({ lado, png }) => {
    const entrada = Buffer.alloc(16)
    entrada.writeUInt8(lado >= 256 ? 0 : lado, 0) // 0 quer dizer 256
    entrada.writeUInt8(lado >= 256 ? 0 : lado, 1)
    entrada.writeUInt8(0, 2) // paleta
    entrada.writeUInt8(0, 3) // reservado
    entrada.writeUInt16LE(1, 4) // planos
    entrada.writeUInt16LE(32, 6) // bits por pixel
    entrada.writeUInt32LE(png.length, 8)
    entrada.writeUInt32LE(deslocamento, 12)
    deslocamento += png.length
    return entrada
  })

  return Buffer.concat([cabecalho, ...entradas, ...imagens.map((i) => i.png)])
}

const publicDir = path.join(__dirname, '..', '..', 'public')

const arquivos = [
  // Tela de início do iPhone: quadrado inteiro, sem transparência — o iOS aplica o
  // próprio arredondamento, e canto transparente vira canto preto.
  { nome: 'apple-touch-icon.png', lado: 180, glifo: 0.66 },
  { nome: 'icon-192.png', lado: 192, glifo: 0.66 },
  { nome: 'icon-512.png', lado: 512, glifo: 0.66 },
  // Maskable: o Android recorta até 20% de cada borda. O desenho fica menor pra caber
  // inteiro dentro do círculo seguro, independente do formato que o launcher usar.
  { nome: 'icon-maskable-512.png', lado: 512, glifo: 0.5 },
  // Ícone pequeno da barra de status do Android, desenhado como silhueta branca — é
  // assim que o Android o renderiza. O iOS ignora este campo.
  { nome: 'badge-72.png', lado: 72, glifo: 0.72, fundo: false },
]

// Ícone da aba do navegador. Nos tamanhos pequenos o desenho vai proporcionalmente
// maior e com traço mais grosso — em 16px, o traço de 2.7 some. Cada um é rasterizado
// em 4x e reduzido, que dá um antialias bem melhor do que desenhar direto no tamanho.
const TAMANHOS_ICO = [
  { lado: 16, glifo: 0.8, traco: 3.6 },
  { lado: 32, glifo: 0.74, traco: 3.1 },
  { lado: 48, glifo: 0.7, traco: 2.9 },
  { lado: 256, glifo: 0.66, traco: 2.7 },
]

async function gerar() {
  for (const { nome, lado, glifo, fundo = true } of arquivos) {
    await sharp(Buffer.from(montarSvg(lado, glifo, fundo)))
      .png()
      .toFile(path.join(publicDir, nome))
    console.log(`  ${nome} (${lado}x${lado})`)
  }

  const imagens = []
  for (const { lado, glifo, traco } of TAMANHOS_ICO) {
    const png = await sharp(Buffer.from(montarSvg(lado * 4, glifo, true, traco)))
      .resize(lado, lado)
      .png()
      .toBuffer()
    imagens.push({ lado, png })
  }
  const destinoIco = path.join(__dirname, '..', 'app', 'favicon.ico')
  fs.writeFileSync(destinoIco, montarIco(imagens))
  console.log(`  favicon.ico (${TAMANHOS_ICO.map((t) => t.lado).join(', ')})`)
}

gerar().then(() => console.log('Ícones gerados.'))
