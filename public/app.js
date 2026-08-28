/* Venera — biblioteca de estudo. Estado local primeiro, servidor a seguir. */

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const DIA = 864e5;
const TIPOS = ["notas", "cartoes", "livros", "areas"];

const COR = {
  "financas-geopolitica": "var(--latao)",
  "inteligencia-artificial": "var(--indigo)",
  "curso-uteis": "var(--sobe)",
  "curso-historia": "var(--rust)",
  "curso-linguas": "var(--indigo)",
};
let NOMES = {
  "financas-geopolitica": "Finanças & Geopolítica",
  "inteligencia-artificial": "Inteligência Artificial",
  "curso-uteis": "Melhoria Pessoal",
  "curso-historia": "História",
  "curso-linguas": "Línguas",
};

/* Todos os cursos vivem na aba Aprender. A de IA à cabeça, por ser a mais antiga. */
const CURSOS = ["inteligencia-artificial", "curso-historia", "curso-linguas", "curso-uteis"];

/* --------------------------------------------------------------- estado --- */

const guardado = (chave, valorInicial) => {
  try {
    return JSON.parse(localStorage.getItem(chave)) ?? valorInicial;
  } catch {
    return valorInicial;
  }
};

const estado = {
  chave: localStorage.getItem("venera:chave") || "",
  biblioteca: guardado("venera:biblioteca", { notas: {}, cartoes: {}, livros: {}, areas: {} }),
  sujos: new Set(guardado("venera:sujos", [])),
  desde: guardado("venera:desde", 0),
  vista: "estante",
  edicaoAberta: null,
  fila: [],
  cartaoAtual: null,
  versoVisivel: false,
  focoGeo: null, // índice do acontecimento escolhido no mapa
};

// Quem já usava a app tem uma biblioteca gravada sem a gaveta dos livros.
for (const tipo of TIPOS) estado.biblioteca[tipo] ||= {};

function gravarLocal() {
  localStorage.setItem("venera:biblioteca", JSON.stringify(estado.biblioteca));
  localStorage.setItem("venera:sujos", JSON.stringify([...estado.sujos]));
  localStorage.setItem("venera:desde", JSON.stringify(estado.desde));
}

/** Marca um item como alterado: carimba a hora, grava e agenda sincronização. */
function alterar(tipo, item) {
  item.atualizado_em = Date.now();
  estado.biblioteca[tipo][item.id] = item;
  estado.sujos.add(`${tipo}:${item.id}`);
  gravarLocal();
  agendarSync();
}

const vivos = (tipo) => Object.values(estado.biblioteca[tipo]).filter((i) => !i.apagado);

/* ------------------------------------------------------------------ rede --- */

function marcarEstado(texto, tipo) {
  const alvo = $("#estado");
  alvo.textContent = texto;
  alvo.dataset.estado = tipo;
}

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${estado.chave}`,
      ...(opcoes.body ? { "Content-Type": "application/json" } : {}),
      ...opcoes.headers,
    },
  });
  if (resposta.status === 401) {
    localStorage.removeItem("venera:chave");
    estado.chave = "";
    irPara("chave");
    throw new Error("chave recusada");
  }
  if (!resposta.ok) throw new Error(`http ${resposta.status}`);
  return resposta.json();
}

let temporizador;
function agendarSync() {
  clearTimeout(temporizador);
  temporizador = setTimeout(sincronizar, 1200);
}

/**
 * O botão do topo: sincroniza e volta a pedir a edição, em vez de esperar pelo
 * temporizador. A seta roda enquanto isso acontece, senão ninguém sabe se pegou.
 */
async function atualizarTudo() {
  const botao = $("#btn-atualizar");
  botao.dataset.girar = "sim";
  try {
    cacheEstante = { quando: 0, dados: null }; // força ir buscar de novo
    await sincronizar();
    if (ROTINA_DO_MODULO[estado.vista]) await carregarModulo(ROTINA_DO_MODULO[estado.vista]);
  } finally {
    botao.dataset.girar = "nao";
  }
}

async function sincronizar() {
  if (!estado.chave) return;
  if (!navigator.onLine) return marcarEstado("offline", "offline");

  marcarEstado("a sincronizar", "a-sincronizar");
  const porEnviar = { notas: [], cartoes: [], livros: [], areas: [] };
  for (const marca of estado.sujos) {
    const [tipo, item] = marca.split(":");
    const dados = estado.biblioteca[tipo]?.[item];
    if (dados) porEnviar[tipo].push(dados);
  }

  try {
    const r = await api("/api/sync", {
      method: "POST",
      body: JSON.stringify({ desde: estado.desde, ...porEnviar }),
    });
    for (const tipo of TIPOS) {
      for (const vindo of r[tipo] || []) {
        const atual = estado.biblioteca[tipo][vindo.id];
        if (!atual || vindo.atualizado_em > atual.atualizado_em) {
          estado.biblioteca[tipo][vindo.id] = vindo;
        }
      }
    }
    estado.sujos.clear();
    estado.desde = r.agora;
    gravarLocal();
    marcarEstado("guardado", "ligado");
    contarRevisao();
    if (estado.vista === "notas") desenharNotas();
  } catch (erro) {
    marcarEstado(navigator.onLine ? "por guardar" : "offline", "offline");
  }
}

/* ----------------------------------------------------------------- rotas --- */

const VISTAS = [
  "chave",
  "noticias",
  "aprendizagem",
  "leitura",
  "notas",
  "revisao",
  "definicoes",
  "edicao",
  "artigo",
];

/** Cada rotina tem o seu módulo: as edições deixaram de partilhar uma estante. */
const MODULO = {
  "financas-geopolitica": "noticias",
  "inteligencia-artificial": "aprendizagem",
  "curso-uteis": "aprendizagem",
  "curso-historia": "aprendizagem",
  "curso-linguas": "aprendizagem",
};
const ROTINA_DO_MODULO = { noticias: "financas-geopolitica", aprendizagem: "inteligencia-artificial" };

/**
 * Navegar é duas coisas: mostrar a vista e deixar rasto no histórico. O rasto
 * é o que faz o gesto de voltar do telemóvel recuar dentro da app em vez de a
 * fechar — antes disto, sair de um artigo era impossível sem tocar no rodapé.
 */
const posicoes = {};

function irPara(vista, ...args) {
  if (estado.vista) posicoes[estado.vista] = window.scrollY;
  const dados = { venera: true, vista, args };
  // A primeira navegação substitui a entrada em branco; as seguintes empilham.
  // Repetir a mesma vista também substitui, senão o histórico enchia-se de cópias.
  if (history.state?.venera && !(history.state.vista === vista && !args.length)) {
    history.pushState(dados, "");
  } else {
    history.replaceState(dados, "");
  }
  mostrar(vista, args);
}

window.addEventListener("popstate", (evento) => {
  const dados = evento.state;
  if (!dados?.venera) return; // já não é nosso: deixa o browser fazer o que quer
  mostrar(dados.vista, dados.args || [], true);
});

function mostrar(vista, args = [], restaurar = false) {
  if (estado.vista && estado.vista !== vista) posicoes[estado.vista] = window.scrollY;
  estado.vista = vista;
  VISTAS.forEach((v) => {
    const alvo = $(`#v-${v}`);
    if (alvo) alvo.dataset.ativa = v === vista ? "sim" : "nao";
  });
  document.querySelectorAll(".aba").forEach((aba) => {
    const ativa =
      aba.dataset.ir === vista ||
      ((vista === "edicao" || vista === "artigo") && aba.dataset.ir === (estado.moduloOrigem || "noticias"));
    aba.setAttribute("aria-current", ativa ? "page" : "false");
  });
  // A voltar, recupera-se o sítio onde se ia; a entrar de novo, começa-se em cima.
  const alvoScroll = restaurar ? posicoes[vista] || 0 : 0;
  window.scrollTo({ top: alvoScroll, behavior: "instant" });

  if (ROTINA_DO_MODULO[vista]) carregarModulo(ROTINA_DO_MODULO[vista]);
  if (vista === "leitura") desenharLivros();
  if (vista === "notas") { desenharQuote(); desenharNotas(); }
  if (vista === "revisao") comecarRevisao();
  if (vista === "definicoes") desenharDefinicoes();
  if (vista === "edicao") abrirEdicao(...args);
  if (vista === "artigo") abrirArtigo(...args);

  // O conteúdo de algumas vistas só chega depois do pedido à rede, e nessa altura
  // a página ainda não tem altura para lá chegar. Duas tentativas resolvem.
  if (alvoScroll) {
    requestAnimationFrame(() => window.scrollTo({ top: alvoScroll, behavior: "instant" }));
    setTimeout(() => window.scrollTo({ top: alvoScroll, behavior: "instant" }), 300);
  }
}

/* --------------------------------------------------------------- estante --- */

const dataCurta = (iso) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

const porExtenso = (iso) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("pt-PT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/** Um pedido serve os dois módulos; sem isto trocar de aba refazia tudo. */
let cacheEstante = { quando: 0, dados: null };

async function buscarEstante() {
  if (cacheEstante.dados && Date.now() - cacheEstante.quando < 30000) return cacheEstante.dados;
  const [estanteDados, feed] = await Promise.all([api("/api/estante"), api("/api/feed")]);
  cacheEstante = { quando: Date.now(), dados: { estanteDados, feed } };
  return cacheEstante.dados;
}

async function carregarModulo(rotina) {
  const modulo = MODULO[rotina];
  try {
    const { estanteDados, feed } = await buscarEstante();
    NOMES = estanteDados.rotinas || NOMES;
    marcarEstado("guardado", "ligado");
    // Na aprendizagem não há uma rotina, há sete: a estante e o arquivo juntam-nas.
    const daVista = (r) => (modulo === "aprendizagem" ? MODULO[r] === "aprendizagem" : r === rotina);
    desenharEstante(estanteDados.lombadas.filter((l) => daVista(l.rotina)), modulo);
    desenharDossies(feed.edicoes.filter((e) => daVista(e.rotina)), rotina, modulo);
    if (modulo === "aprendizagem") {
      // A aula mais recente de cada curso, pela ordem em que os cursos vivem.
      estado.cursos = CURSOS.map((r) => feed.edicoes.find((e) => e.rotina === r)).filter(Boolean);
      estado.edicaoCurso = feed.edicoes.find((e) => e.rotina === rotina) || null;
      // O cabeçalho é a data de hoje, não a da última aula: a página é de hoje,
      // a aula é que pode ser velha — e isso já se diz no cartão dela.
      $("#data-aprendizagem").textContent = porExtensoComDia(new Date().toISOString().slice(0, 10));
      desenharAprendizagem();
    }

    if (modulo === "noticias") {
      const hoje = feed.edicoes.find((e) => e.rotina === rotina);
      estado.edicaoNoticias = hoje || null;
      const dataMostrar = hoje?.data || estanteDados.lombadas.find((l) => l.rotina === rotina)?.data;
      if (dataMostrar) {
        const hojeIso = dataMostrar;
        $("#data-noticias-dia").textContent = porExtenso(hojeIso);
        $("#data-noticias-semana").textContent = new Date(hojeIso + "T12:00:00Z")
          .toLocaleDateString("pt-PT", { weekday: "long" });
      }
      desenharNoticias();
      api(`/api/historico/${rotina}`)
        .then((h) => {
          estado.historico = h.series;
          desenharNoticias();
        })
        .catch(() => {});
      const primeira = estanteDados.lombadas.find((l) => l.rotina === rotina);
      if (primeira) mostrarResumoDoDia(rotina, primeira.data);
    }
  } catch {
    marcarEstado(navigator.onLine ? "sem ligação" : "offline", "offline");
    if (!$(`#estante-${modulo}`).children.length) {
      $(`#dossies-${modulo}`).innerHTML = vazio(
        "Não foi possível carregar",
        "Verifica a ligação. O que já leste continua disponível offline."
      );
    }
  }
}

const vazio = (titulo, texto, botao = "") =>
  `<div class="vazio"><strong>${esc(titulo)}</strong><p>${esc(texto)}</p>${botao}</div>`;

const porExtensoComDia = (iso) => {
  const d = new Date(iso + "T12:00:00Z");
  const dia = d.toLocaleDateString("pt-PT", { weekday: "long" });
  return `${porExtenso(iso)} · ${dia}`;
};

/* --------------------------------------------------------------- artigo --- */

/** "há 2 horas". Sem hora no item, cai para a data da edição. */
function haQuanto(item, edicao) {
  const quando = item.publicado_em ? Date.parse(item.publicado_em) : null;
  if (!Number.isFinite(quando)) return porExtenso(edicao.data);
  const minutos = Math.max(0, Math.round((Date.now() - quando) / 60000));
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  return porExtenso(edicao.data);
}


function abrirArtigo(indice) {
  const edicao = estado.edicaoNoticias;
  if (!edicao) return irPara("noticias");
  const item = edicao.itens[indice];
  if (!item) return irPara("noticias");

  estado.artigoIndice = indice;
  $("#artigo-seccao").textContent = item.rubrica || "Tema";

  const partes = String(item.texto).split(/Porque interessa:\s*/i);
  const paragrafos = partes[0].trim().split(/\n{2,}/).filter(Boolean);
  const entrada = paragrafos.shift() || "";
  const porque = partes[1]?.trim().replace(/^./, (c) => c.toUpperCase());
  const marcada = vivos("notas").some((n) => n.origem?.chave === chaveItem(item));
  $("#artigo-marcar").setAttribute("aria-pressed", marcada);


  $("#artigo-corpo").innerHTML = `
    <p class="etiqueta">
      <span class="selo">${esc(item.rubrica || "Tema")}</span>
      <span class="quando">· ${esc(haQuanto(item, edicao))}</span>
    </p>
    <h1>${esc(item.titulo)}</h1>
    <p class="entrada">${esc(entrada)}</p>

    ${(() => {
      // Só quando não há fotografia própria: a foto do Commons manda sempre.
      if (item.imagem) return "";
      const empresa = empresaDe(item.titulo, item.rubrica);
      if (!empresa) return "";
      return `<div class="cartao-empresa">
        <span class="logo">
          <img src="https://www.google.com/s2/favicons?domain=${esc(empresa.dominio)}&sz=128"
               alt="" loading="lazy" decoding="async"
               onerror="this.closest('.cartao-empresa')?.remove()">
        </span>
        <span class="quem">
          <b>${esc(empresa.nome)}</b>
          ${empresa.ticker ? `<i>${esc(empresa.ticker)}</i>` : ""}
        </span>
      </div>`;
    })()}

    ${
      item.imagem
        ? `<figure class="foto-artigo">
             <img src="${esc(item.imagem.url)}" alt="" loading="lazy" decoding="async">
             <figcaption>${esc(item.imagem.credito)}</figcaption>
           </figure>`
        : ""
    }

    ${
      item.pontos
        ? `<section class="resumo-rapido">
             <p class="cabeca rotulo">
               <svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>
               Resumo rápido
             </p>
             <ol>${item.pontos.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>
           </section>`
        : ""
    }

    <div class="corpo">${paragrafos.map((p) => `<p>${esc(p)}</p>`).join("")}</div>

    ${porque ? `<div class="porque" style="--marcador:${COR[edicao.rotina]}"><b>Porque interessa</b>${esc(porque)}</div>` : ""}

    <div class="fontes">${item.fontes
      .map(
        (f) =>
          `<a class="fonte" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.titulo)} ↗</a>`
      )
      .join("")}</div>`;

  const passo = (i, rotulo, alinhar) => {
    const outro = edicao.itens[i];
    return `<button data-passo="${i}" ${outro ? "" : "disabled"} style="text-align:${alinhar}">
      <span class="rotulo">${rotulo}</span>
      <span class="t">${outro ? esc(outro.titulo.slice(0, 34)) + (outro.titulo.length > 34 ? "…" : "") : "—"}</span>
    </button>`;
  };
  $("#artigo-passos").innerHTML = passo(indice - 1, "‹ Anterior", "left") + passo(indice + 1, "Próxima ›", "right");

  window.scrollTo({ top: 0, behavior: "instant" });
}

$("#artigo-voltar").addEventListener("click", () => irPara("noticias"));

$("#artigo-marcar").addEventListener("click", () => {
  const edicao = estado.edicaoNoticias;
  const item = edicao?.itens[estado.artigoIndice];
  if (!item) return;
  alternarNota(item, edicao);
  abrirArtigo(estado.artigoIndice);
});

$("#artigo-partilhar").addEventListener("click", async () => {
  const item = estado.edicaoNoticias?.itens[estado.artigoIndice];
  if (!item) return;
  const texto = `${item.titulo}\n\n${item.fontes?.[0]?.url || ""}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: item.titulo, text: texto });
    } catch {
      /* cancelado */
    }
  } else {
    navigator.clipboard?.writeText(texto);
  }
});

$("#artigo-passos").addEventListener("click", (e) => {
  const passo = e.target.closest("[data-passo]");
  if (passo && !passo.disabled) abrirArtigo(Number(passo.dataset.passo));
});

/* -------------------------------------------------------------- notícias --- */

/** Linha do percurso do índice. Com menos de dois dias não se desenha nada. */
function faisca(pontos, sinal) {
  if (!pontos || pontos.length < 3) return "";
  const niveis = pontos.map((p) => p.nivel);
  const min = Math.min(...niveis);
  const alcance = Math.max(...niveis) - min || 1;
  // Margem de 2 em cada lado: encostado à borda, metade do traço ficava cortada.
  const d = niveis
    .map((n, i) => {
      const x = 2 + (i / (niveis.length - 1)) * 96;
      const y = 23 - ((n - min) / alcance) * 20;
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  // non-scaling-stroke: sem isto o esticar horizontal deformava a espessura.
  return `<svg class="faisca" data-sinal="${sinal}" viewBox="0 0 100 26" preserveAspectRatio="none">
    <path d="${d}" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/**
 * A que metade pertence o item. O campo "modulo" manda; as edições antigas não
 * o trazem, e para essas resta olhar para a rubrica.
 */
const REGIOES = /geopol|m[ée]dio oriente|europa|[áa]sia|am[ée]ricas|áfrica|africa/i;
const E_GEO = (item) =>
  item.modulo ? item.modulo === "geopolitica" : REGIOES.test(item.rubrica || "");

/* ------------------------------------------------------------ mapa do mundo --- */

/**
 * O mapa é uma fotografia: public/mapa-mundo.jpg, uma composição de satélite
 * equirretangular recortada entre os 82°N e os 60°S — fora fica só calote, onde
 * não há acontecimentos. As legendas gravadas na imagem original (nomes de
 * continentes e graus) foram apagadas antes de a meter na app.
 */
const MAPA_LAT_TOPO = 82;
const MAPA_LAT_BASE = -60;
const MAPA_LARG = 360;
/* A altura de desenho é maior do que a proporção real: o mapa fica mais alto no
   ecrã, que é o que se quer num telemóvel, ao custo de esticar as latitudes. */
const MAPA_ALT = 172;
const MAPA_ESCALA_Y = MAPA_ALT / (MAPA_LAT_TOPO - MAPA_LAT_BASE);

/* Os nomes dos continentes vinham gravados na fotografia e ficavam ilegíveis ao
   tamanho do telemóvel. Voltam como texto do próprio mapa: nítidos em qualquer
   ampliação e na tipografia da app. */
const CONTINENTES = [
  ["América do Norte", 48, -102],
  ["América do Sul", -20, -60],
  ["Europa", 57, 26],
  ["África", 6, 18],
  ["Ásia", 48, 96],
  ["Oceânia", -27, 134],
];

/** Projeção equirretangular: longitude para x, latitude para y. */
const projX = (lon) => lon + 180;
const projY = (lat) => (MAPA_LAT_TOPO - lat) * MAPA_ESCALA_Y;

/* Onde pousar o ponto de cada país. Centróides aproximados — a capital exata não
   mudava nada a esta escala. */
const COORD = {
  US: [39.5, -98.5], CN: [35, 105], RU: [60, 90], UA: [49, 32], IR: [32, 53],
  IL: [31.6, 35.1], PS: [31.4, 34.3], TW: [23.7, 121], JP: [36, 138], KP: [40, 127],
  KR: [36.5, 127.8], IN: [22, 79], TR: [39, 35], SA: [24, 45], AE: [24, 54],
  QA: [25.3, 51.2], YE: [15.5, 48], LB: [33.9, 35.9], SY: [35, 38], IQ: [33, 44],
  EG: [26, 30], VE: [7, -66], BR: [-10, -52], MX: [23, -102], CA: [58, -106],
  GB: [54, -2], DE: [51, 10], FR: [46.5, 2.5], IT: [42.8, 12.5], ES: [40, -3.5],
  PT: [39.5, -8], NL: [52.2, 5.5], PL: [52, 19.5], GR: [39, 22], NO: [62, 10],
  SE: [62, 15], CH: [46.8, 8.2], BY: [53.5, 28], HU: [47, 19.5], RO: [46, 25],
  RS: [44, 20.8], NG: [9.5, 8], ZA: [-29, 24], DZ: [28, 3], LY: [27, 17],
  SD: [15.5, 30], ET: [9, 39.5], MA: [32, -6], PK: [30, 70], AF: [34, 66],
  ID: [-2, 118], VN: [16, 106], PH: [12.5, 122], TH: [15, 101], AU: [-25, 134],
  AR: [-35, -64], CL: [-35, -71], CO: [4, -73], PE: [-10, -76], KZ: [48, 68],
  AZ: [40.3, 47.7], AM: [40.2, 45], SG: [1.35, 103.8], MY: [4, 102], EU: [50.8, 4.4],
};

const NOME_PAIS = {
  US: "Estados Unidos", CN: "China", RU: "Rússia", UA: "Ucrânia", IR: "Irão",
  IL: "Israel", PS: "Palestina", TW: "Taiwan", JP: "Japão", KP: "Coreia do Norte",
  KR: "Coreia do Sul", IN: "Índia", TR: "Turquia", SA: "Arábia Saudita",
  AE: "Emirados", QA: "Catar", YE: "Iémen", LB: "Líbano", SY: "Síria", IQ: "Iraque",
  EG: "Egito", VE: "Venezuela", BR: "Brasil", MX: "México", CA: "Canadá",
  GB: "Reino Unido", DE: "Alemanha", FR: "França", IT: "Itália", ES: "Espanha",
  PT: "Portugal", NL: "Países Baixos", PL: "Polónia", GR: "Grécia", NO: "Noruega",
  SE: "Suécia", CH: "Suíça", BY: "Bielorrússia", HU: "Hungria", RO: "Roménia",
  RS: "Sérvia", NG: "Nigéria", ZA: "África do Sul", DZ: "Argélia", LY: "Líbia",
  SD: "Sudão", ET: "Etiópia", MA: "Marrocos", PK: "Paquistão", AF: "Afeganistão",
  ID: "Indonésia", VN: "Vietname", PH: "Filipinas", TH: "Tailândia", AU: "Austrália",
  AR: "Argentina", CL: "Chile", CO: "Colômbia", PE: "Peru", KZ: "Cazaquistão",
  AZ: "Azerbaijão", AM: "Arménia", SG: "Singapura", MY: "Malásia", EU: "União Europeia",
};

/* --------------------------------------------------------------- empresas --- */

/**
 * Os temas de mercado não trazem fotografia — e uma fotografia genérica de bolsa
 * não diz nada. O que diz é o logótipo de quem está em causa, por isso lê-se a
 * empresa no título e mostra-se a marca no topo do artigo.
 */
const EMPRESAS = [
  ["NVIDIA", "NVDA", /\bnvidia\b|\bnvda\b/i, "nvidia.com"],
  ["Broadcom", "AVGO", /\bbroadcom\b|\bavgo\b/i, "broadcom.com"],
  ["Amazon", "AMZN", /\bamazon\b|\bamzn\b|\baws\b/i, "amazon.com"],
  ["IREN", "IREN", /\biren\b|iris energy/i, "iren.com"],
  ["Rocket Lab", "RKLB", /rocket lab|\brklb\b/i, "rocketlabusa.com"],
  ["Nebius", "NBIS", /\bnebius\b|\bnbis\b/i, "nebius.com"],
  ["Microsoft", "MSFT", /\bmicrosoft\b|\bmsft\b|\bazure\b/i, "microsoft.com"],
  ["Apple", "AAPL", /\bapple\b|\baapl\b/i, "apple.com"],
  ["Alphabet", "GOOGL", /\balphabet\b|\bgoogle\b|\bgoogl\b/i, "abc.xyz"],
  ["Meta", "META", /\bmeta platforms\b|\bmeta\b(?! descrit)|\bfacebook\b/i, "meta.com"],
  ["Tesla", "TSLA", /\btesla\b|\btsla\b/i, "tesla.com"],
  ["AMD", "AMD", /\bamd\b|advanced micro/i, "amd.com"],
  ["Intel", "INTC", /\bintel\b|\bintc\b/i, "intel.com"],
  ["TSMC", "TSM", /\btsmc\b|taiwan semiconductor/i, "tsmc.com"],
  ["ASML", "ASML", /\basml\b/i, "asml.com"],
  ["Palantir", "PLTR", /\bpalantir\b|\bpltr\b/i, "palantir.com"],
  ["Oracle", "ORCL", /\boracle\b|\borcl\b/i, "oracle.com"],
  ["Micron", "MU", /\bmicron\b/i, "micron.com"],
  ["Marvell", "MRVL", /\bmarvell\b|\bmrvl\b/i, "marvell.com"],
  ["Qualcomm", "QCOM", /\bqualcomm\b|\bqcom\b/i, "qualcomm.com"],
  ["Arm", "ARM", /\barm holdings\b/i, "arm.com"],
  ["Super Micro", "SMCI", /super micro|\bsmci\b/i, "supermicro.com"],
  ["Vertiv", "VRT", /\bvertiv\b/i, "vertiv.com"],
  ["Coinbase", "COIN", /\bcoinbase\b/i, "coinbase.com"],
  ["Strategy", "MSTR", /\bmicrostrategy\b|\bmstr\b/i, "strategy.com"],
  ["Netflix", "NFLX", /\bnetflix\b|\bnflx\b/i, "netflix.com"],
  ["Walmart", "WMT", /\bwalmart\b|\bwmt\b/i, "walmart.com"],
  ["Salesforce", "CRM", /\bsalesforce\b/i, "salesforce.com"],
  ["Adobe", "ADBE", /\badobe\b/i, "adobe.com"],
  ["Uber", "UBER", /\buber\b/i, "uber.com"],
  ["Boeing", "BA", /\bboeing\b/i, "boeing.com"],
  ["ExxonMobil", "XOM", /\bexxon\b/i, "exxonmobil.com"],
  ["Chevron", "CVX", /\bchevron\b/i, "chevron.com"],
  ["Shell", "SHEL", /\bshell\b/i, "shell.com"],
  ["JPMorgan", "JPM", /\bjpmorgan\b|\bjp morgan\b/i, "jpmorganchase.com"],
  ["Goldman Sachs", "GS", /goldman sachs/i, "goldmansachs.com"],
  ["Berkshire", "BRK", /\bberkshire\b/i, "berkshirehathaway.com"],
  ["OpenAI", "", /\bopenai\b|\bchatgpt\b/i, "openai.com"],
  ["Anthropic", "", /\banthropic\b|\bclaude\b/i, "anthropic.com"],
  ["Reserva Federal", "", /reserva federal|\bfed\b|\bfomc\b/i, "federalreserve.gov"],
  ["BCE", "", /\bbce\b|banco central europeu/i, "ecb.europa.eu"],
  ["Bitcoin", "BTC", /\bbitcoin\b|\bbtc\b/i, "bitcoin.org"],
  ["Ethereum", "ETH", /\bethereum\b|\beth\b/i, "ethereum.org"],
];

function empresaDe(...textos) {
  const alvo = textos.filter(Boolean).join(" ");
  if (!alvo) return null;
  for (const [nome, ticker, padrao, dominio] of EMPRESAS)
    if (padrao.test(alvo)) return { nome, ticker, dominio };
  return null;
}

/* --------------------------------------------------------------- bandeiras --- */

/**
 * Nem toda a edição traz foto: as antigas não trazem nenhuma e o Commons às
 * vezes não devolve nada. Nesses casos lê-se o país no título e desenha-se a
 * bandeira. São emojis de indicador regional — o telemóvel e o Mac desenham-nas
 * como imagem, não gastam pedido nenhum e funcionam sem rede.
 */
const PAISES = [
  ["US", /\beua\b|estados unidos|washington|casa branca|reserva federal|\bfed\b|wall street/i],
  ["CN", /\bchina\b|chin[êe]s|pequim|xi jinping/i],
  ["RU", /\br[úu]ssia\b|russo|moscovo|kremlin|putin/i],
  ["UA", /ucr[âa]nia|ucraniano|kiev|zelensky/i],
  ["IR", /\bir[ãa]o\b|iraniano|teer[ãa]o|ormuz/i],
  ["IL", /israel|israelita|telavive|netanyahu/i],
  ["PS", /gaza|palestin|cisjord[âa]nia|hamas/i],
  ["TW", /taiwan|formosa|tsmc/i],
  ["JP", /jap[ãa]o|japon[êe]s|t[óo]quio|banco do jap[ãa]o/i],
  ["KP", /coreia do norte|norte-coreano|pyongyang/i],
  ["KR", /coreia do sul|sul-coreano|seul|samsung/i],
  ["IN", /[íi]ndia\b|indiano|nova deli/i],
  ["TR", /turquia|turco|ancara|erdogan/i],
  ["SA", /ar[áa]bia saudita|saudita|riade|\bopep\b/i],
  ["AE", /emirados|dubai|abu dhabi/i],
  ["QA", /catar|qatar|doha/i],
  ["YE", /i[ée]men|houthi|mar vermelho/i],
  ["LB", /l[íi]bano|libanês|beirute|hezbollah/i],
  ["SY", /s[íi]ria|damasco/i],
  ["IQ", /iraque|bagdade/i],
  ["EG", /egito|cairo|suez/i],
  ["VE", /venezuela|caracas|maduro/i],
  ["BR", /brasil|bras[íi]lia|petrobras/i],
  ["MX", /m[ée]xico|cidade do m[ée]xico/i],
  ["CA", /canad[áa]|otava/i],
  ["GB", /reino unido|brit[âa]nico|londres|inglaterra|banco de inglaterra/i],
  ["DE", /alemanha|alem[ãa]o|berlim|bundesbank/i],
  ["FR", /fran[çc]a|franc[êe]s|paris/i],
  ["IT", /it[áa]lia|italiano|roma\b/i],
  ["ES", /espanha|espanhol|madrid/i],
  ["PT", /portugal|portugu[êe]s|lisboa/i],
  ["NL", /pa[íi]ses baixos|holanda|amesterd[ãa]o|\basml\b/i],
  ["PL", /pol[óo]nia|vars[óo]via/i],
  ["GR", /gr[ée]cia|atenas/i],
  ["NO", /noruega|oslo/i],
  ["SE", /su[ée]cia|estocolmo/i],
  ["CH", /su[íi][çc]a|zurique|berna/i],
  ["BY", /bielorr[úu]ssia|minsk/i],
  ["HU", /hungria|budapeste|orb[áa]n/i],
  ["RO", /rom[ée]nia|bucareste/i],
  ["RS", /s[ée]rvia|belgrado/i],
  ["NG", /nig[ée]ria|abuja|lagos/i],
  ["ZA", /[áa]frica do sul|joanesburgo|pret[óo]ria/i],
  ["DZ", /arg[ée]lia|argel\b/i],
  ["LY", /l[íi]bia|tr[íi]poli/i],
  ["SD", /sud[ãa]o|cartum/i],
  ["ET", /eti[óo]pia|adis abeba/i],
  ["MA", /marrocos|rabat/i],
  ["PK", /paquist[ãa]o|islamabade/i],
  ["AF", /afeganist[ãa]o|cabul|talib[ãa]/i],
  ["ID", /indon[ée]sia|jacarta/i],
  ["VN", /vietname|han[óo]i/i],
  ["PH", /filipinas|manila/i],
  ["TH", /tail[âa]ndia|banguecoque/i],
  ["AU", /austr[áa]lia|camberra|sydney/i],
  ["AR", /argentina|buenos aires|milei/i],
  ["CL", /chile|santiago do chile|l[íi]tio/i],
  ["CO", /col[ôo]mbia|bogot[áa]/i],
  ["PE", /\bperu\b|lima\b/i],
  ["KZ", /cazaquist[ãa]o|astana/i],
  ["AZ", /azerbaij[ãa]o|baku/i],
  ["AM", /arm[ée]nia|erevan/i],
  ["SG", /singapura/i],
  ["MY", /mal[áa]sia|kuala lumpur/i],
  ["EU", /uni[ãa]o europeia|\bue\b|bruxelas|banco central europeu|\bbce\b|zona euro/i],
];

/** Duas letras ISO viram bandeira somando-lhes o bloco de indicadores regionais. */
const emojiBandeira = (iso) =>
  String.fromCodePoint(...[...iso].map((letra) => 0x1f1e6 + letra.charCodeAt(0) - 65));

/** Todos os países mencionados, pela ordem em que aparecem no texto. */
function isosDe(...textos) {
  const alvo = textos.filter(Boolean).join(" ");
  if (!alvo) return [];
  const achados = [];
  for (const [iso, padrao] of PAISES) {
    const m = alvo.match(padrao);
    if (m) achados.push({ iso, onde: m.index });
  }
  return achados.sort((a, b) => a.onde - b.onde).map((a) => a.iso);
}

function isoDe(...textos) {
  const alvo = textos.filter(Boolean).join(" ");
  if (!alvo) return "";
  // Ganha quem for mencionado mais cedo. Pela ordem da tabela, "o Irão restringe
  // o tráfego dos EUA" dava bandeira americana a uma notícia sobre o Irão.
  let melhor = "";
  let onde = Infinity;
  for (const [iso, padrao] of PAISES) {
    const achado = alvo.match(padrao);
    if (achado && achado.index < onde) {
      onde = achado.index;
      melhor = iso;
    }
  }
  return melhor;
}

function bandeiraDe(...textos) {
  const iso = isoDe(...textos);
  return iso ? emojiBandeira(iso) : "";
}

/** Minutos de leitura a 200 palavras por minuto — a conta de sempre das redações. */
const minutos = (item) => Math.max(1, Math.round(String(item.texto || "").split(/\s+/).length / 200));

/** Duas letras sempre: com a inicial só, "Mercados" e "Macro" ficavam iguais. */
const SIGLA = (texto) => {
  const palavras = (texto || "?").replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean);
  if (!palavras.length) return "?";
  if (palavras.length === 1) return palavras[0].slice(0, 2).toUpperCase();
  return palavras.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
};

/**
 * O ícone vem do próprio site da fonte, não de um serviço pelo meio: já se está
 * a ler essa fonte, não faz sentido contar a mais ninguém. Se falhar, fica a sigla.
 */
function iconeDaFonte(item) {
  const url = item.fontes?.[0]?.url;
  if (!url) return "";
  try {
    return `<img src="${esc(new URL(url).origin)}/favicon.ico" alt="" loading="lazy" decoding="async">`;
  } catch {
    return "";
  }
}

function linhaNoticia(item, i, cor, semRubrica = false) {
  const marcada = vivos("notas").some((n) => n.origem?.chave === chaveItem(item));
  // Nos temas de geopolítica o mosaico passa a ser o sítio: a foto do dia, ou a
  // bandeira do país, ou — se nada disso houver — a sigla de sempre.
  const geo = E_GEO(item);
  const bandeira = geo ? bandeiraDe(item.titulo, item.rubrica) : "";
  const mosaico = item.imagem
    ? `<span class="mosaico-noticia com-foto"><img src="${esc(item.imagem.url)}" alt="" loading="lazy" decoding="async"></span>`
    : bandeira
      ? `<span class="mosaico-noticia com-bandeira"><b class="bandeira">${bandeira}</b></span>`
      : `<span class="mosaico-noticia"><b>${esc(SIGLA(item.rubrica || item.titulo))}</b>${iconeDaFonte(item)}</span>`;
  return `<button class="noticia" data-item-noticia="${i}" style="--marcador:${cor}">
    ${mosaico}
    <span class="corpo">
      <h3>${esc(item.titulo)}</h3>
      <span class="meta">${semRubrica ? "" : `${esc(item.rubrica || "Tema")} `}<em data-nivel="${esc(
        item.impacto
      )}">${esc(item.impacto)}</em> <span class="min">${minutos(item)} min</span></span>
    </span>
    <span class="lado">
      <span class="marcador-nota" data-marcar="${i}" aria-pressed="${marcada}">
        <svg viewBox="0 0 24 24"><path d="M6 4h12v17l-6-4-6 4z"/></svg>
      </span>
      <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
    </span>
  </button>`;
}

const chaveItem = (item) => `${estado.edicaoNoticias?.data || ""}:${item.titulo}`;

/* Guardado à parte para o clique no mapa saber quantos temas tem cada país. */
let marcadoresDoDia = [];

function desenharNoticias() {
  const alvo = $("#noticias-corpo");
  const edicao = estado.edicaoNoticias;
  if (!edicao) {
    alvo.innerHTML = vazio(
      "Sem edição de hoje",
      "Assim que a rotina publicar, os temas do dia aparecem aqui."
    );
    return;
  }

  const meia = estado.meiaNoticias || "geral";
  const cor = COR["financas-geopolitica"];
  const painel = edicao.painel || {};
  const geo = painel.geopolitica || {};
  const itens = edicao.itens.map((item, i) => ({ item, i }));
  const mercado = itens.filter(({ item }) => !E_GEO(item));
  const geopoliticos = itens.filter(({ item }) => E_GEO(item));

  const lista = (conjunto, semNada) =>
    `<div class="grupo">${
      conjunto.map(({ item, i }) => linhaNoticia(item, i, cor)).join("") ||
      `<p class="linha"><span class="texto"><span>${semNada}</span></span></p>`
    }</div>`;

  /* Por tópicos: a rubrica passa a ser cabeçalho e cada assunto fica junto do
     seu. Uma lista de doze linhas seguidas lê-se muito pior do que quatro
     grupos de três. */
  const listaPorTopico = (conjunto, semNada) => {
    if (!conjunto.length) return lista(conjunto, semNada);
    const grupos = new Map();
    for (const entrada of conjunto) {
      const chave = entrada.item.rubrica || "Outros";
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(entrada);
    }
    // Primeiro os tópicos com mais temas: dá uma hierarquia natural ao dia.
    return [...grupos.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(
        ([topico, itens]) =>
          `<p class="topico"><span>${esc(topico)}</span><i>${itens.length}</i></p>` +
          `<div class="grupo">${itens
            .map(({ item, i }) => linhaNoticia(item, i, cor, true))
            .join("")}</div>`
      )
      .join("");
  };

  // O VIX é um índice de medo, não um preço: o número absoluto não diz nada a
  // quem olha de relance, e roubava um terço da fila aos índices que interessam.
  const indicesUteis = (painel.indices || []).filter((l) => !/\bvix\b/i.test(l.nome || ""));

  const blocoIndices = () =>
    indicesUteis.length
      ? `<div class="indices">${indicesUteis
          .map((l) => {
            const sinal =
              typeof l.variacao !== "number" ? "igual" : l.variacao > 0 ? "sobe" : l.variacao < 0 ? "desce" : "igual";
            const seta = sinal === "sobe" ? "↑" : sinal === "desce" ? "↓" : "→";
            return `<div class="cartao-indice">
              <span class="n">${esc(l.nome)}<span class="seta-var" data-sinal="${sinal}">${seta}</span></span>
              <span class="v">${esc(l.valor || "—")}</span>
              <span class="rodape-indice">
                ${variacao(l.variacao)}
                ${faisca(
                  l.serie ? l.serie.map((v) => ({ nivel: v })) : estado.historico?.[l.nome]?.pontos,
                  sinal
                )}
              </span>
            </div>`;
          })
          .join("")}</div>`
      : "";

  /* Focos do dia: um por país detectado, com o peso a contar os temas e o grau
     a guardar o pior impacto. É isto que acende os pontos no mapa. */
  /* ------------------------------------------------------------- mapa --- */
  /* Um marcador por acontecimento, não por país. Quando o título menciona dois
     países — "EUA anunciam tarifas sobre a China" — o primeiro é a origem e o
     segundo o alvo, e desenha-se um arco entre eles. */
  const marcadores = (marcadoresDoDia = (() => {
    const feitos = [];
    const porPais = new Map();
    for (const { item, i } of geopoliticos) {
      const isos = isosDe(item.titulo, item.rubrica).filter((iso) => COORD[iso]);
      if (!isos.length) continue;
      const origem = isos[0];
      const alvo = isos.find((iso) => iso !== origem) || "";
      // Vários acontecimentos no mesmo país afastam-se num pequeno leque, senão
      // ficavam empilhados no mesmo ponto.
      const ordem = porPais.get(origem) || 0;
      porPais.set(origem, ordem + 1);
      const angulo = (ordem * 2.4) % (Math.PI * 2);
      const raio = ordem ? 2.6 + ordem * 0.6 : 0;
      const [la, lo] = COORD[origem];
      feitos.push({
        i,
        item,
        origem,
        alvo,
        x: projX(lo) + Math.cos(angulo) * raio,
        y: projY(la) + Math.sin(angulo) * raio,
        impacto: item.impacto || "medio",
      });
    }
    return feitos;
  })());

  const escolhido = marcadores.some((m) => m.i === estado.focoGeo) ? estado.focoGeo : null;
  const marcado = marcadores.find((m) => m.i === escolhido) || null;

  /* Regiões, para o quadro de atividade por baixo do mapa. */
  const REGIOES_MAPA = ["Médio Oriente", "Europa", "Ásia", "Américas", "África"];
  const regiao = (item) => {
    const r = (item.rubrica || "").toLowerCase();
    if (/m[ée]dio oriente|golfo|magreb/.test(r)) return "Médio Oriente";
    if (/europa|b[áa]lt|balc/.test(r)) return "Europa";
    if (/[áa]sia|pac[íi]fico|indo/.test(r)) return "Ásia";
    if (/am[ée]rica|latina/.test(r)) return "Américas";
    if (/[áa]frica|sahel/.test(r)) return "África";
    return "";
  };

  const RAIO = { alto: 4.4, medio: 3.4, baixo: 2.7 };

  const mapaHTML = () => {
    if (!marcadores.length && !geopoliticos.length) return "";

    // Arcos primeiro, para os marcadores ficarem por cima.
    const arcos = marcadores
      .filter((m) => m.alvo)
      .map((m) => {
        const [la, lo] = COORD[m.alvo];
        const x2 = projX(lo);
        const y2 = projY(la);
        // Curva para cima, com altura proporcional à distância.
        const cx = (m.x + x2) / 2;
        const cy = (m.y + y2) / 2 - Math.min(38, Math.abs(x2 - m.x) * 0.34 + 8);
        return `<path class="arco" data-impacto="${esc(m.impacto)}"
          d="M${m.x.toFixed(1)} ${m.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}"/>
          <circle class="ponta" data-impacto="${esc(m.impacto)}" cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="1.8"/>`;
      })
      .join("");

    const pontos = marcadores
      .map((m) => {
        const r = RAIO[m.impacto] || RAIO.medio;
        return `<g class="foco" data-tema="${m.i}" data-impacto="${esc(m.impacto)}"
            aria-current="${escolhido === m.i}"
            data-x="${m.x.toFixed(1)}" data-y="${m.y.toFixed(1)}"
            style="transform:translate(${m.x.toFixed(1)}px,${m.y.toFixed(1)}px)">
            <circle class="halo" r="${(r * 2.4).toFixed(1)}"/>
            <circle class="anel" r="${(r * 1.55).toFixed(1)}"/>
            <circle class="nucleo" r="${r.toFixed(1)}"/>
            <circle class="alvo" r="9"/>
            <title>${esc(m.item.titulo)}</title>
          </g>`;
      })
      .join("");

    const paises = new Set(marcadores.flatMap((m) => [m.origem, m.alvo].filter(Boolean)));

    return `<div class="mapa-caixa">
      <div class="mapa-cabeca">
        <span class="rotulo"><i class="emoji">🗺️</i>Mapa do dia</span>
        <span class="rotulo conta-mapa">${marcadores.length} ${
      marcadores.length === 1 ? "acontecimento" : "acontecimentos"
    } · ${paises.size} ${paises.size === 1 ? "país" : "países"}</span>
      </div>
      <div class="mapa-palco">
        <svg class="mapa-mundo" viewBox="0 0 ${MAPA_LARG} ${MAPA_ALT}" role="img"
             aria-label="Mapa dos acontecimentos do dia" preserveAspectRatio="xMidYMid meet">
          <g class="mundo" id="mapa-mundo">
            <image href="/mapa-mundo.jpg" x="0" y="0" width="${MAPA_LARG}" height="${MAPA_ALT}"
                   preserveAspectRatio="none"/>
            ${CONTINENTES.map(
              ([nome, la, lo]) =>
                `<text class="continente" x="${projX(lo).toFixed(1)}" y="${projY(la).toFixed(1)}">${esc(nome)}</text>`
            ).join("")}
            ${arcos}
            ${pontos}
          </g>
        </svg>
        ${
          marcado
            ? `<button class="tira-mapa" data-abrir-tema="${marcado.i}">
                <span class="corpo">
                  <span class="rotulo">${
                    marcado.alvo
                      ? `${emojiBandeira(marcado.origem)} → ${emojiBandeira(marcado.alvo)} ${esc(
                          NOME_PAIS[marcado.origem] || marcado.origem
                        )} · ${esc(NOME_PAIS[marcado.alvo] || marcado.alvo)}`
                      : `${emojiBandeira(marcado.origem)} ${esc(
                          NOME_PAIS[marcado.origem] || marcado.origem
                        )} · impacto ${esc(marcado.impacto)}`
                  }</span>
                  <b>${esc(marcado.item.titulo)}</b>
                </span>
                <span class="seta">›</span>
              </button>`
            : ""
        }
      </div>
      <p class="mapa-legenda rotulo">
        <i class="bolha alto"></i>alto
        <i class="bolha medio"></i>médio
        <i class="bolha baixo"></i>baixo
        <b class="dica">${
          marcado ? "toca no cartão para abrir" : "toca num ponto para ver"
        }</b>
      </p>
    </div>`;
  };

  /* Atividade por região: barra em segmentos, como um medidor de painel. */
  const COR_REGIAO = {
    "Médio Oriente": "#e8402f",
    "Ásia": "#f08a3c",
    "Europa": "#f2b430",
    "Américas": "#4b8ede",
    "África": "#57b98a",
  };

  const blocoRegioes = () => {
    const contas = REGIOES_MAPA.map((nome) => ({
      nome,
      n: geopoliticos.filter(({ item }) => regiao(item) === nome).length,
      altos: geopoliticos.filter(({ item }) => regiao(item) === nome && item.impacto === "alto").length,
    })).filter((r) => r.n);
    if (!contas.length) return "";

    const maior = Math.max(...contas.map((c) => c.n));
    const SEGMENTOS = 10;
    const paises = new Set(marcadores.flatMap((m) => [m.origem, m.alvo].filter(Boolean)));

    return `<div class="cabecalho-lista"><span class="rotulo"><i class="emoji">📊</i>Atividade por região</span></div>
      <div class="grupo quadro-regioes">
        ${contas
          .sort((a, b) => b.n - a.n)
          .map((c) => {
            const cheios = Math.max(1, Math.round((c.n / maior) * SEGMENTOS));
            const barras = Array.from(
              { length: SEGMENTOS },
              (_, i) =>
                `<i style="${i < cheios ? `background:${COR_REGIAO[c.nome]}` : ""}"></i>`
            ).join("");
            return `<div class="linha-regiao">
              <span class="nome"><i class="ponto" style="background:${COR_REGIAO[c.nome]}"></i>${esc(c.nome)}</span>
              <b style="color:${COR_REGIAO[c.nome]}">${c.n}</b>
              <span class="segmentos">${barras}</span>
              <span class="rotulo altos">${c.altos ? `${c.altos} de impacto alto` : "sem impacto alto"}</span>
            </div>`;
          })
          .join("")}
        <div class="rodape-regioes">
          <span><b>${geopoliticos.length}</b> <i class="rotulo">acontecimentos</i></span>
          <span><b>${paises.size}</b> <i class="rotulo">países</i></span>
        </div>
      </div>`;
  };

  /* Destaques do dia: os cinco de maior gravidade, com origem e alvo à vista. */
  const ORDEM_IMPACTO = { alto: 0, medio: 1, baixo: 2 };
  const blocoDestaquesGeo = () => {
    if (!marcadores.length) return "";
    const topo = [...marcadores]
      .sort((a, b) => (ORDEM_IMPACTO[a.impacto] ?? 3) - (ORDEM_IMPACTO[b.impacto] ?? 3))
      .slice(0, 5);
    return `<div class="cabecalho-lista">
        <span class="rotulo"><i class="emoji">⭐</i>Destaques do dia</span>
        <button class="ver-mais" data-abrir-edicao>Ver todas ›</button>
      </div>
      <div class="grupo">${topo
        .map(
          (m) => `<button class="destaque-geo" data-item-noticia="${m.i}">
            <span class="bandeiras">
              <i class="emoji">${emojiBandeira(m.origem)}</i>
              ${m.alvo ? `<i class="seta-rel">→</i><i class="emoji">${emojiBandeira(m.alvo)}</i>` : ""}
            </span>
            <span class="corpo">
              <b>${esc(m.item.titulo)}</b>
              <span class="rotulo">${esc(primeiraFrase(m.item.texto).slice(0, 90))}</span>
            </span>
            <span class="selo-impacto" data-impacto="${esc(m.impacto)}">${esc(m.impacto)}</span>
          </button>`
        )
        .join("")}</div>`;
  };

  /* Os blocos ricos do painel viviam só na edição completa. Passam a aparecer
     também nas abas, que é onde se lê o dia sem abrir mais nada. */
  const emPainel = (html) => (html ? `<div class="painel painel-aba">${html}</div>` : "");

  /* Nas abas fica a primeira frase; o texto completo é para quando se abre mesmo
     a notícia ou a edição. */
  const primeiraFrase = (texto) => {
    const limpo = String(texto || "").trim();
    const fim = limpo.search(/[.!?](\s|$)/);
    return fim > 0 ? limpo.slice(0, fim + 1) : limpo;
  };

  const blocoDestaque = () => {
    const d = painel.destaque;
    if (!d) return "";
    const sinal = typeof d.variacao !== "number" ? "igual" : d.variacao > 0 ? "sobe" : "desce";
    return `<div class="cabecalho-lista"><span class="rotulo">${EMOJI("📌")}Destaque do dia</span></div>
      <div class="cartao-destaque" data-sinal="${sinal}">
        <div class="linha-topo">
          <div class="quem">
            <b>${esc(d.nome)}</b>
            ${d.descricao ? `<span>${esc(d.descricao)}</span>` : ""}
          </div>
          <div class="numeros">
            ${variacao(d.variacao)}
            ${d.valor ? `<span class="preco">${esc(d.valor)}</span>` : ""}
          </div>
        </div>
        ${d.texto ? `<p>${esc(primeiraFrase(d.texto))}</p>` : ""}
      </div>`;
  };

  /* Posições em mosaico: quatro fichas por ecrã, cada uma com o ticker, a
     variação e a razão numa linha. A lista corrida obrigava a ler tudo. */
  const mosaicoPosicoes = (linhas, titulo, emoji) =>
    linhas?.length
      ? bloco(
          `${EMOJI(emoji)}${titulo}`,
          `<div class="mosaico-posicoes">${linhas
            .map((l) => {
              const sinal =
                typeof l.variacao !== "number" ? "igual" : l.variacao > 0 ? "sobe" : "desce";
              return `<div class="ficha-posicao" data-sinal="${sinal}">
                <div class="cabeca">
                  <b>${esc(l.nome)}</b>
                  ${variacao(l.variacao)}
                </div>
                ${l.valor ? `<span class="preco">${esc(l.valor)}</span>` : ""}
                ${l.leitura ? `<p>${esc(l.leitura)}</p>` : ""}
              </div>`;
            })
            .join("")}</div>`
        )
      : "";

  /* Nas abas as tabelas são listas: o `table` deixava cair a explicação no
     telemóvel, e a explicação é justamente o que se quer ler. */
  const linhaAba = (nome, valor, direita, explicacao) =>
    `<div class="linha-aba">
      <span class="nome">${nome}</span>
      ${valor ? `<span class="valor">${esc(valor)}</span>` : ""}
      <span class="direita">${direita}</span>
      ${explicacao ? `<p class="explica">${esc(explicacao)}</p>` : ""}
    </div>`;

  const blocoCarteira = () => mosaicoPosicoes(painel.carteira, "A tua carteira hoje", "💼");
  const blocoAccoes = () => mosaicoPosicoes(painel.accoes, "Ações em foco", "📊");

  const blocoTeatros = () =>
    geo.conflitos
      ? bloco(
          `${EMOJI("🛰️")}Teatros`,
          `<div class="lista-aba">${geo.conflitos
            .map((c) => {
              const b = bandeiraDe(c.nome);
              return linhaAba(
                `${b ? `<i class="bandeira-linha">${b}</i>` : ""}${esc(c.nome)}`,
                "",
                `<span class="prob">${esc(c.probabilidade || "")}</span>`,
                c.situacao
              );
            })
            .join("")}</div>`
        )
      : "";

  const blocoImpactoCarteira = () => {
    if (!geo.impacto_carteira) return "";
    const sinais = { positivo: "▲", neutro: "→", negativo: "▼" };
    return bloco(
      `${EMOJI("🧭")}Impacto na carteira`,
      `<div class="lista-aba">${geo.impacto_carteira
        .map((i) =>
          linhaAba(
            esc(i.nome),
            "",
            `<span class="var" data-sinal="${
              i.sentido === "positivo" ? "sobe" : i.sentido === "negativo" ? "desce" : "igual"
            }">${sinais[i.sentido] || "→"}</span>`,
            i.justificacao
          )
        )
        .join("")}</div>`
    );
  };

  /* Os números soltos do risco: conflitos ativos, focos, quem está mais exposto. */
  const grelhaRisco = () => {
    const r = geo.risco || {};
    const campos = [
      ["Conflitos ativos", r.conflitos],
      ["Alertas críticos", r.alertas],
      ["Focos", r.hotspots],
      ["Mais expostos", r.expostos],
    ].filter(([, v]) => tem(v));
    return campos.length
      ? `<div class="grelha grelha-risco">${campos
          .map(([k, v]) => `<div><span>${k}</span><span>${esc(String(v))}</span></div>`)
          .join("")}</div>`
      : "";
  };

  const blocoVeredicto = (fonte, titulo, emoji) =>
    fonte?.veredicto
      ? bloco(
          `${EMOJI(emoji)}${titulo}`,
          `<div class="veredicto veredicto-aba" data-tom="${esc(fonte.veredicto.tom)}">
            ${fonte.veredicto.titulo ? `<div class="tom">${esc(fonte.veredicto.titulo)}</div>` : ""}
            <p>${esc(primeiraFrase(fonte.veredicto.texto))}</p>
          </div>`
        )
      : "";

  /* Três chegam para dar o sentido do dia; a lista toda está na edição. */
  const cortar = (lista, quantos = 3) => (lista ? lista.slice(0, quantos) : lista);
  const avaliacaoCurta = (fonte, titulo, emoji) => {
    const op = cortar(fonte.oportunidades);
    const ri = cortar(fonte.riscos);
    if (!op && !ri) return "";
    const cartao = (rotulo, itens, tom) =>
      itens?.length
        ? `<div class="cartao-avaliacao" data-tom="${tom}">
            <span class="rotulo">${rotulo}</span>
            <ul>${itens.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
          </div>`
        : "";
    return bloco(
      `${EMOJI(emoji)}${titulo}`,
      `<div class="par-avaliacao">${cartao("Oportunidades", op, "bom")}${cartao("Riscos", ri, "mau")}</div>`
    );
  };

  const semGeoAqui = "Esta edição não trouxe temas geopolíticos.";
  const cartaoGeo = ({ item, i }) => `<button class="cartao-geo" data-item-noticia="${i}" style="--marcador:${cor}">
      ${
        item.imagem
          ? `<span class="faixa-geo com-foto"><img src="${esc(item.imagem.url)}" alt="" loading="lazy" decoding="async"></span>`
          : bandeiraDe(item.titulo, item.rubrica)
            ? `<span class="faixa-geo com-bandeira"><b class="bandeira">${bandeiraDe(item.titulo, item.rubrica)}</b></span>`
            : `<span class="faixa-geo">${esc(SIGLA(item.rubrica || item.titulo))}</span>`
      }
      <span class="dentro">
        <span class="selo" style="color:${cor};align-self:flex-start">${esc(item.rubrica || "Tema")}</span>
        <h3>${esc(item.titulo)}</h3>
        <span class="pe">
          <span class="rotulo">${minutos(item)} min de leitura</span>
          <span class="marcador-nota" data-marcar="${i}"
            aria-pressed="${vivos("notas").some((n) => n.origem?.chave === chaveItem(item))}">
            <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7"><path d="M6 4h12v17l-6-4-6 4z"/></svg>
          </span>
        </span>
      </span>
    </button>`;

  const carrossel = (conjunto) =>
    conjunto.length
      ? `<div class="carrossel">${conjunto.map(cartaoGeo).join("")}</div>
         <div class="pontos-carrossel">${conjunto
           .map((_, n) => `<i data-atual="${n === 0}"></i>`)
           .join("")}</div>`
      : `<div class="grupo"><p class="linha"><span class="texto"><span>${semGeoAqui}</span></span></p></div>`;

  // Na vista geral o "ver tudo" salta para a meia correspondente; nas outras
  // continua a abrir a edição inteira.
  const cabecalho = (titulo, icone = "", meiaDestino = "") =>
    `<div class="cabecalho-lista">
      <span class="rotulo">${icone}${titulo}</span>
      <button class="ver-mais" ${
        meiaDestino ? `data-ver-meia="${meiaDestino}"` : "data-abrir-edicao"
      }>Ver tudo ›</button>
    </div>`;

  const EMOJI = (e) => `<i class="emoji">${e}</i>`;

  const blocoRisco = () =>
    geo.risco && tem(geo.risco.indice)
      ? `<div class="grupo medidor-caixa" style="padding:0.85rem 1rem 1rem">
          <div class="cabeca-medidor">
            <span class="rotulo"><i class="emoji">⚔️</i>Índice de agressividade</span>
            ${geo.risco.nivel ? `<span class="nivel-risco" data-alto="${geo.risco.indice >= 61 ? 1 : 0}">${esc(geo.risco.nivel)}</span>` : ""}
          </div>
          <div class="medidor">
            <span class="valor">${geo.risco.indice}</span>
            <span class="de">/ 100</span>
          </div>
          <div class="medidor-barra" data-alto="${geo.risco.indice >= 61 ? 1 : 0}"><i style="width:${geo.risco.indice}%"></i></div>
          <div class="escala-risco"><span>0 · calmo</span><span>50</span><span>100 · crítico</span></div>
          ${grelhaRisco()}
        </div>`
      : "";

  const blocoAlertas = () =>
    geo.alertas
      ? `<div class="cabecalho-lista"><span class="rotulo"><i class="emoji">⚠️</i>Do dia</span></div>
         <div class="grupo" style="padding:0.4rem 1rem">
           <ul class="alertas">${geo.alertas
             .slice(0, 4)
             .map((a) => {
               const b = bandeiraDe(a.texto);
               return `<li data-nivel="${esc(a.nivel)}">${b ? `<i class="bandeira-linha">${b}</i>` : ""}${esc(a.texto)}</li>`;
             })
             .join("")}</ul>
         </div>`
      : "";

  const semMercado = "Esta edição não trouxe temas de mercado.";
  const semGeo = "Esta edição não trouxe temas geopolíticos.";

  const paginas = {
    // Geral é a vista da maqueta: as duas metades seguidas, na mesma página.
    // A geral é a vista de relance: índices, quatro destaques, geopolítica e as
    // duas leituras do dia numa frase cada. O resto vive nas outras abas.
    geral: () =>
      blocoIndices() +
      cabecalho("Destaques de investimentos", EMOJI("📈"), "mercado") +
      // Três, agora que cada linha respira mais: com quatro, a geopolítica caía
      // outra vez para debaixo da barra.
      lista(mercado.slice(0, 3), semMercado) +
      cabecalho("Geopolítica", EMOJI("🌍"), "geo") +
      carrossel(geopoliticos) +
      emPainel(
        blocoVeredicto(painel, "Leitura de mercado", "📈") +
          blocoVeredicto(geo, "Leitura geopolítica", "🌍")
      ),
    mercado: () =>
      blocoIndices() +
      cabecalho("Investimentos", EMOJI("📈")) +
      listaPorTopico(mercado, semMercado) +
      blocoDestaque() +
      emPainel(
        blocoCarteira() +
          blocoAccoes() +
          avaliacaoCurta(painel, "Leitura de mercado", "⚖️") +
          blocoVeredicto(painel, "Veredicto", "🧾")
      ),
    geo: () => {
      return (
        mapaHTML() +
        blocoRisco() +
        blocoDestaquesGeo() +
        blocoRegioes() +
        blocoAlertas() +
        cabecalho("Geopolítica", EMOJI("🌍")) +
        listaPorTopico(geopoliticos, semGeo) +
        emPainel(
          blocoTeatros() +
            blocoImpactoCarteira() +
            avaliacaoCurta(geo, "Leitura geopolítica", "⚖️") +
            blocoVeredicto(geo, "Veredicto", "🧾")
        )
      );
    },
  };

  alvo.innerHTML = (paginas[meia] || paginas.geral)();
}

$("#noticias-corpo").addEventListener(
  "scroll",
  (e) => {
    const faixa = e.target.closest(".carrossel");
    if (!faixa) return;
    const largura = faixa.firstElementChild?.getBoundingClientRect().width || 1;
    const atual = Math.round(faixa.scrollLeft / (largura + 11));
    faixa.nextElementSibling
      ?.querySelectorAll("i")
      .forEach((p, n) => p.setAttribute("data-atual", n === atual));
  },
  true
);

function mudarMeia(meia) {
  estado.meiaNoticias = meia;
  document
    .querySelectorAll("[data-meia]")
    .forEach((o) => o.setAttribute("aria-selected", o.dataset.meia === meia));
  desenharNoticias();
  window.scrollTo({ top: 0, behavior: "instant" });
}

document
  .querySelectorAll("[data-meia]")
  .forEach((b) => b.addEventListener("click", () => mudarMeia(b.dataset.meia)));

// O "ver tudo" das listas é desenhado a cada pintura, por isso vai por delegação.
$("#noticias-corpo").addEventListener("click", (e) => {
  const ver = e.target.closest("[data-ver-meia]");
  if (ver) return mudarMeia(ver.dataset.verMeia);

  // O cartão que aparece sobre o mapa abre o tema.
  const tira = e.target.closest("[data-abrir-tema]");
  if (tira) return irPara("artigo", Number(tira.dataset.abrirTema));

  // Tocar no mar, fora de qualquer ponto, afasta o mapa.
  if (e.target.closest(".mapa-palco") && !e.target.closest("[data-tema]") && estado.focoGeo !== null) {
    estado.focoGeo = null;
    desenharNoticias();
    return aproximarMapa();
  }

  const ponto = e.target.closest("[data-tema]");
  if (!ponto) return;

  // Cada ponto é um acontecimento: o primeiro toque aproxima e mostra o cartão,
  // o segundo abre a notícia.
  const indice = Number(ponto.dataset.tema);
  if (indice === estado.focoGeo) return irPara("artigo", indice);

  estado.focoGeo = indice;
  desenharNoticias();
  aproximarMapa();
});

/**
 * Aproximar é mexer no transform do grupo, não no viewBox: assim o CSS trata da
 * animação e os pontos de terra ficam do mesmo tamanho, graças ao non-scaling-stroke.
 */
function aproximarMapa() {
  const g = $("#mapa-mundo");
  if (!g) return;
  const alvo = marcadoresDoDia.find((m) => m.i === estado.focoGeo);
  const k = alvo ? 2.4 : 1;

  if (!alvo) g.style.transform = "none";
  else {
    // Centra-se acima do meio: o cartão do acontecimento ocupa a parte de baixo
    // do palco e taparia o próprio ponto.
    g.style.transform = `translate(${(MAPA_LARG / 2 - k * alvo.x).toFixed(1)}px, ${(
      MAPA_ALT * 0.36 -
      k * alvo.y
    ).toFixed(1)}px) scale(${k})`;
  }

  // A terra cresce com a aproximação — é o que faz o mapa parecer mapa e não uma
  // grelha esticada. Os pontos dos países é que não: levam a escala ao contrário
  // para ficarem sempre do mesmo tamanho no ecrã.
  const inverso = (1 / k).toFixed(3);
  g.querySelectorAll(".foco").forEach((f) => {
    f.style.transform = `translate(${f.dataset.x}px, ${f.dataset.y}px) scale(${inverso})`;
  });
}

/* Resumo do dia escolhido na estante. A estante só traz o título, por isso
   o resumo completo tem de ser ido buscar à edição desse dia. */
async function mostrarResumoDoDia(rotina, data) {
  const alvo = $("#resumo-dia");
  const cor = COR[rotina];
  document.querySelectorAll("#estante-noticias .lombada").forEach((l) =>
    l.setAttribute("aria-current", l.dataset.data === data ? "true" : "false")
  );

  alvo.innerHTML = `<div class="resumo-dia"><p class="rotulo">a abrir…</p></div>`;
  try {
    const edicao = await api(`/api/edicao/${rotina}/${data}`);
    const itens = edicao.itens || [];
    const geos = itens.filter(E_GEO).length;
    const mercados = itens.length - geos;
    const altos = itens.filter((i) => i.impacto === "alto").length;
    const parte = (n) => (itens.length ? Math.round((n / itens.length) * 100) : 0);
    // Índice da edição: os temas de impacto alto primeiro, que é por onde se começa.
    const sumario = [...itens]
      .sort((a, b) => (b.impacto === "alto") - (a.impacto === "alto"))
      .slice(0, 3);

    alvo.innerHTML = `<div class="resumo-dia" style="--marcador:${cor}">
      <div class="capa-topo">
        <span class="selo-rotina" style="color:${cor};border-color:${cor}">${esc(
      NOMES[rotina] || rotina
    )}</span>
        <span class="rotulo dia">${esc(porExtensoComDia(edicao.data))}</span>
      </div>

      <h3>${esc(edicao.titulo)}</h3>
      <p class="entrada">${esc(edicao.resumo)}</p>

      <div class="balanco">
        <div class="barra-balanco" role="presentation">
          <i class="mercado" style="width:${parte(mercados)}%"></i>
          <i class="geo" style="width:${parte(geos)}%"></i>
        </div>
        <ul class="contas">
          <li><b>${mercados}</b> investimentos</li>
          <li><b>${geos}</b> geopolítica</li>
          <li><b>${altos}</b> de impacto alto</li>
        </ul>
      </div>

      ${
        sumario.length
          ? `<div class="sumario">
              <span class="rotulo">Nesta edição</span>
              <ol>${sumario
                .map(
                  (i) =>
                    `<li data-impacto="${esc(i.impacto)}"><span>${esc(i.titulo)}</span></li>`
                )
                .join("")}</ol>
            </div>`
          : ""
      }

      <div class="rodape-cartao">
        <span class="rotulo">${itens.length} temas</span>
        <button class="ver-mais" data-abrir-dia="${esc(data)}">Ler a edição ›</button>
      </div>
    </div>`;
  } catch {
    alvo.innerHTML = `<div class="resumo-dia">${vazio(
      "Não foi possível abrir",
      "Este dia ainda não está guardado neste aparelho e não há ligação."
    )}</div>`;
  }
}

$("#estante-noticias").addEventListener("click", (e) => {
  const lombada = e.target.closest("[data-data]");
  if (lombada) mostrarResumoDoDia(lombada.dataset.rotina, lombada.dataset.data);
});

$("#resumo-dia").addEventListener("click", (e) => {
  const abrir = e.target.closest("[data-abrir-dia]");
  if (abrir) irPara("edicao", "financas-geopolitica", abrir.dataset.abrirDia);
});

// Fonte sem favicon: tira-se a imagem e fica a sigla por baixo.
$("#noticias-corpo").addEventListener(
  "error",
  (e) => { if (e.target.tagName === "IMG") e.target.remove(); },
  true
);

function alternarNota(item, edicao) {
  const chave = chaveItem(item);
  const jaLa = vivos("notas").find((n) => n.origem?.chave === chave);
  if (jaLa) {
    jaLa.apagado = true;
    return alterar("notas", jaLa);
  }
  alterar("notas", {
    id: id(),
    titulo: item.titulo,
    texto: item.texto,
    origem: { chave, rotina: edicao.rotina, data: edicao.data, titulo: edicao.titulo },
    criado_em: Date.now(),
    apagado: false,
  });
}

$("#noticias-corpo").addEventListener("click", (e) => {
  if (e.target.closest("[data-abrir-edicao]")) {
    const ed = estado.edicaoNoticias;
    return irPara("edicao", ed.rotina, ed.data);
  }
  const marcar = e.target.closest("[data-marcar]");
  const linha = e.target.closest("[data-item-noticia]");
  const ed = estado.edicaoNoticias;
  if (!ed) return;

  if (marcar) {
    e.stopPropagation();
    alternarNota(ed.itens[Number(marcar.dataset.marcar)], ed);
    return desenharNoticias();
  }

  // Um tema abre sozinho, não a edição inteira.
  if (linha) irPara("artigo", Number(linha.dataset.itemNoticia));
});

function desenharEstante(lombadas, modulo) {
  const hoje = new Date().toISOString().slice(0, 10);
  const alvo = $(`#estante-${modulo}`);

  if (!lombadas.length) {
    alvo.innerHTML = `<p class="rotulo" style="align-self:center">sem volumes arquivados</p>`;
    return;
  }

  alvo.innerHTML = lombadas
    .map((l) => {
      // Mais temas, volume mais alto. O número vai impresso no topo da lombada.
      const altura = Math.min(140, 78 + l.itens * 8);
      return `<button class="lombada"
        style="height:${altura}px;background-color:${COR[l.rotina] || "var(--latao)"}"
        data-hoje="${l.data === hoje ? "sim" : "nao"}"
        data-rotina="${esc(l.rotina)}" data-data="${esc(l.data)}"
        title="${esc(NOMES[l.rotina])} — ${esc(l.titulo)}"
        aria-label="${esc(dataCurta(l.data))}, ${l.itens} temas"><i class="n">${l.itens}</i><b class="d">${esc(
        dataCurta(l.data)
      )}</b></button>`;
    })
    .join("");
}

function desenharDossies(edicoes, rotina, modulo) {
  const alvo = $(`#dossies-${modulo}`);
  // Nem todos os módulos têm linha de data — as Notícias deixaram de a mostrar.
  const data = $(`#data-${modulo}`);
  if (data) data.textContent = edicoes[0] ? porExtenso(edicoes[0].data) : "";

  alvo.innerHTML =
    edicoes
      .map(
        (e) => `<button class="dossie" style="--marcador:${COR[e.rotina]}"
      data-rotina="${esc(e.rotina)}" data-data="${esc(e.data)}">
      <span class="rotulo" style="color:${COR[e.rotina]}">${esc(NOMES[e.rotina] || e.rotina)}</span>
      <h3>${esc(e.titulo)}</h3>
      <p>${esc(e.resumo)}</p>
      <span class="linha-meta rotulo">${e.itens.length} temas · ${esc(dataCurta(e.data))}</span>
    </button>`
      )
      .join("") ||
    vazio(
      NOMES[rotina] || rotina,
      "A rotina ainda não arquivou nada aqui. A edição aparece assim que a próxima corrida terminar."
    );
}

/* ---------------------------------------------------------------- painel --- */

/** A edição manda o número; o sinal, a seta e a cor são desenhados aqui. */
function variacao(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "";
  const sinal = v > 0 ? "sobe" : v < 0 ? "desce" : "igual";
  const seta = v > 0 ? "▲" : v < 0 ? "▼" : "→";
  return `<span class="var" data-sinal="${sinal}">${seta} ${Math.abs(v).toFixed(2).replace(".", ",")}%</span>`;
}

const bloco = (titulo, corpo) =>
  corpo ? `<section class="bloco"><span class="rotulo">${titulo}</span>${corpo}</section>` : "";

const linhaCotacao = (l) => `<tr>
  <td class="nome">${esc(l.nome)}</td>
  <td class="num">${esc(l.valor || "")}</td>
  <td class="num">${variacao(l.variacao)}</td>
  <td class="leitura">${esc(l.leitura || "")}</td>
</tr>`;

const tem = (v) => v !== null && v !== undefined && v !== "";

/** Cada bloco só aparece se a edição o trouxer — o painel todo é opcional. */
function desenharPainel(p) {
  if (!p || typeof p !== "object") return "";
  let html = "";

  if (p.indices) {
    html += bloco("Índices", `<table class="tabela">${p.indices.map(linhaCotacao).join("")}</table>`);
  }

  if (p.accoes) {
    html += bloco("Ações", `<table class="tabela">${p.accoes.map(linhaCotacao).join("")}</table>`);
  }

  if (p.carteira || p.destaque) {
    let corpo = "";
    if (p.destaque) {
      const d = p.destaque;
      corpo += `<div class="destaque">
        <div class="topo">
          <div>
            <div class="tick">${esc(d.nome)}</div>
            ${d.descricao ? `<div class="desc">${esc(d.descricao)}</div>` : ""}
          </div>
          <div style="text-align:right">
            ${variacao(d.variacao)}
            ${d.valor ? `<div class="desc">${esc(d.valor)}</div>` : ""}
          </div>
        </div>
        ${d.texto ? `<p class="texto">${esc(d.texto)}</p>` : ""}
      </div>`;
    }
    if (p.carteira) corpo += `<table class="tabela">${p.carteira.map(linhaCotacao).join("")}</table>`;
    html += bloco("Carteira", corpo);
  }

  html += avaliacaoHTML(p, "Leitura de mercado");

  html += geopoliticaHTML(p.geopolitica);

  return html ? `<div class="painel">${html}</div>` : "";
}

/** Oportunidades, riscos e veredicto — as duas metades do painel têm os seus. */
function avaliacaoHTML(o, titulo) {
  let html = "";

  if (o.oportunidades || o.riscos) {
    const coluna = (rotulo, itens, tom) =>
      itens
        ? `<div><span class="rotulo">${rotulo}</span>
             <ul class="lista" data-tom="${tom}">${itens.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
           </div>`
        : "";
    html += bloco(
      titulo,
      `<div class="duas">${coluna("Oportunidades", o.oportunidades, "bom")}${coluna("Riscos", o.riscos, "mau")}</div>`
    );
  }

  if (o.veredicto) {
    const v = o.veredicto;
    html += bloco(
      "Veredicto",
      `<div class="veredicto" data-tom="${esc(v.tom)}">
        ${v.titulo ? `<div class="tom">${esc(v.titulo)}</div>` : ""}
        <p>${esc(v.texto)}</p>
      </div>`
    );
  }

  return html;
}

function geopoliticaHTML(g) {
  if (!g || typeof g !== "object") return "";
  let html = "";

  if (g.risco) {
    const r = g.risco;
    const setas = { sobe: "▲", desce: "▼", estavel: "→" };
    let corpo = "";
    if (tem(r.indice)) {
      corpo += `<div class="medidor">
          <span class="valor">${r.indice}</span>
          <span class="de">/ 100${r.nivel ? ` · ${esc(r.nivel)}` : ""}${r.tendencia ? ` ${setas[r.tendencia]}` : ""}</span>
        </div>
        <div class="medidor-barra" data-alto="${r.indice >= 61 ? 1 : 0}"><i style="width:${r.indice}%"></i></div>`;
    }
    const campos = [
      ["Conflitos ativos", r.conflitos],
      ["Alertas críticos", r.alertas],
      ["Focos", r.hotspots],
      ["Mais expostos", r.expostos],
    ].filter(([, v]) => tem(v));
    if (campos.length) {
      corpo += `<div class="grelha">${campos
        .map(([k, v]) => `<div><span>${k}</span><span>${esc(String(v))}</span></div>`)
        .join("")}</div>`;
    }
    html += bloco("Risco global", corpo);
  }

  if (g.alertas) {
    html += bloco(
      "Do dia",
      `<ul class="alertas">${g.alertas
        .map((a) => {
          const b = bandeiraDe(a.texto);
          return `<li data-nivel="${esc(a.nivel)}">${b ? `<i class="bandeira-linha">${b}</i>` : ""}${esc(a.texto)}</li>`;
        })
        .join("")}</ul>`
    );
  }

  if (g.conflitos) {
    html += bloco(
      "Teatros",
      `<table class="tabela">${g.conflitos
        .map(
          (c) => `<tr>
            <td class="nome">${bandeiraDe(c.nome) ? `<i class="bandeira-linha">${bandeiraDe(c.nome)}</i>` : ""}${esc(c.nome)}</td>
            <td class="num">${esc(c.probabilidade || "")}</td>
            <td class="leitura">${esc(c.situacao || "")}</td>
          </tr>`
        )
        .join("")}</table>`
    );
  }

  html += avaliacaoHTML(g, "Leitura geopolítica");

  if (g.impacto_carteira) {
    const sinais = { positivo: "▲", neutro: "→", negativo: "▼" };
    html += bloco(
      "Impacto na carteira",
      `<table class="tabela">${g.impacto_carteira
        .map(
          (i) => `<tr>
            <td class="nome">${esc(i.nome)}</td>
            <td class="num"><span class="var" data-sinal="${
              i.sentido === "positivo" ? "sobe" : i.sentido === "negativo" ? "desce" : "igual"
            }">${sinais[i.sentido]}</span></td>
            <td class="leitura">${esc(i.justificacao || "")}</td>
          </tr>`
        )
        .join("")}</table>`
    );
  }

  return html ? `<div class="metade"><span class="rotulo divisor">Geopolítica</span>${html}</div>` : "";
}

/** Onde vai o curso de IA. */
function desenharProgresso(pr) {
  if (!pr || typeof pr !== "object") return "";
  const selos = [];
  if (tem(pr.dia)) selos.push(`Dia <b>${pr.dia}</b>`);
  if (pr.nivel) selos.push(`<b>${esc(pr.nivel)}</b>`);
  if (tem(pr.percentagem)) selos.push(`<b>${pr.percentagem}%</b> do curso`);
  if (tem(pr.leitura_min)) selos.push(`<b>${pr.leitura_min}</b> min`);
  return selos.length
    ? `<div class="progresso">${selos.map((s) => `<span class="selo">${s}</span>`).join("")}</div>`
    : "";
}

/* --------------------------------------------------------------- leitura --- */

async function abrirEdicao(rotina, data) {
  const cabecalho = $("#edicao-cabecalho");
  const itens = $("#edicao-itens");
  cabecalho.innerHTML = `<p class="rotulo" style="margin-top:1.4rem">a abrir…</p>`;
  itens.innerHTML = "";

  let edicao;
  try {
    edicao = await api(`/api/edicao/${rotina}/${data}`);
  } catch {
    cabecalho.innerHTML = vazio(
      "Não foi possível abrir",
      "Esta edição ainda não está guardada neste aparelho e não há ligação."
    );
    return;
  }

  estado.edicaoAberta = edicao;
  // Guarda de que módulo veio, para o "voltar" não atirar sempre para Notícias.
  estado.moduloOrigem = MODULO[edicao.rotina] || "noticias";
  $("#btn-voltar-edicao").textContent =
    estado.moduloOrigem === "aprendizagem" ? "← Aprendizagem" : "← Notícias";
  const cor = COR[edicao.rotina];

  cabecalho.innerHTML = `
    <p class="rotulo" style="color:${cor};margin-top:1.4rem">${esc(NOMES[edicao.rotina] || edicao.rotina)}</p>
    <h1 class="titulo-grande">${esc(edicao.titulo)}</h1>
    <p class="linha-meta rotulo">${esc(porExtenso(edicao.data))} · ${edicao.itens.length} temas</p>
    ${desenharProgresso(edicao.progresso)}
    <p class="resumo">${esc(edicao.resumo)}</p>
    <div style="--marcador:${cor}">${desenharPainel(edicao.painel)}</div>`;

  itens.innerHTML = edicao.itens
    .map((item, i) => {
      const partes = String(item.texto).split(/Porque interessa:\s*/i);
      const corpo = partes[0].trim();
      // O rótulo já diz "Porque interessa", por isso a frase começa em maiúscula.
      const porque = partes[1]?.trim().replace(/^./, (c) => c.toUpperCase());
      const marca = [
        tem(item.capitulo) ? `Cap. ${item.capitulo}` : "",
        item.rubrica ? esc(item.rubrica) : "",
      ].filter(Boolean);
      return `<article class="verbete" style="--marcador:${cor}">
        <div class="verbete-meta">
          ${marca.length ? `<span class="capitulo rotulo">${marca.join(" · ")}</span>` : ""}
          <span class="impacto rotulo" data-nivel="${esc(item.impacto)}">
            <i></i><i></i><i></i> impacto ${esc(item.impacto)}
          </span>
        </div>
        <h3>${esc(item.titulo)}</h3>
        <p>${esc(corpo)}</p>
        ${porque ? `<div class="porque"><b>Porque interessa</b>${esc(porque)}</div>` : ""}
        <div class="fontes">${item.fontes
          .map(
            (f) =>
              `<a class="fonte" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.titulo)} ↗</a>`
          )
          .join("")}</div>
        <div class="accoes">
          <button class="btn" data-acao="nota" data-item="${i}">Guardar nota</button>
          <button class="btn" data-acao="cartao" data-item="${i}">Fazer cartão</button>
        </div>
      </article>`;
    })
    .join("");
}

/* ----------------------------------------------------------------- notas --- */

const ETIQUETAS = [
  ["☰", "Todas"],
  ["💡", "Ideias"],
  ["📖", "Leituras"],
  ["👤", "Pessoais"],
  ["🗄️", "Arquivo"],
];

/** Etiqueta escolhida nas fichas. "Todas" mostra tudo menos o arquivo. */
let etiquetaEscolhida = "Todas";

function desenharNotas() {
  const procura = $("#procura").value.trim().toLowerCase();
  const todas = vivos("notas");

  $("#etiquetas-notas").innerHTML = ETIQUETAS.map(
    ([emoji, nome]) => `<button class="ficha-genero" data-etiqueta="${esc(nome)}"
      aria-current="${etiquetaEscolhida === nome}"><i class="emoji">${emoji}</i>${esc(nome)}</button>`
  ).join("");

  const lista = todas
    .filter((n) =>
      etiquetaEscolhida === "Todas" ? n.etiqueta !== "Arquivo" : n.etiqueta === etiquetaEscolhida
    )
    .filter((n) => !procura || `${n.titulo} ${n.texto}`.toLowerCase().includes(procura))
    .sort((a, b) => b.atualizado_em - a.atualizado_em);

  if (lista.length) {
    $("#lista-notas").innerHTML = lista
      .map((n) => {
        const quando = n.origem
          ? `${NOMES[n.origem.rotina] || n.origem.rotina} · ${dataCurta(n.origem.data)}`
          : dataCurta(new Date(n.atualizado_em).toISOString().slice(0, 10));
        return `<article class="nota" data-nota="${esc(n.id)}">
          <span class="quando">${esc(quando)}</span>
          <h4>${esc(n.titulo || "Sem título")}</h4>
          ${n.texto ? `<p>${esc(n.texto)}</p>` : ""}
          ${n.etiqueta ? `<span class="selo-etiqueta" data-et="${esc(n.etiqueta)}">${esc(n.etiqueta)}</span>` : ""}
        </article>`;
      })
      .join("");
    return;
  }

  const filtrado = procura || etiquetaEscolhida !== "Todas";
  $("#lista-notas").innerHTML = todas.length && filtrado
    ? vazio(
        "Nada encontrado",
        procura ? "Nenhuma nota tem essas palavras." : `Ainda não há notas em ${etiquetaEscolhida}.`
      )
    : `<div class="convite-livros">
        <span class="medalha"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 3h9l3 3v15H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg></span>
        <h3>Ainda não há notas</h3>
        <p>Abre uma edição e guarda o que interessa — ou escreve uma nota solta.</p>
        <button class="btn" data-tom="forte" id="btn-primeira-nota">Escrever a primeira nota</button>
        <div class="duas-colunas">
          <div><b>Escreve livremente</b><span>Captura pensamentos, ideias e reflexões.</span></div>
          <div><b>Organiza e encontra</b><span>Mantém tudo arrumado e fácil de rever.</span></div>
        </div>
      </div>`;
}

$("#lista-notas").addEventListener("click", (e) => {
  if (e.target.closest("#btn-primeira-nota")) abrirFolha("nota-nova", {});
});

$("#quote").addEventListener("click", (e) => {
  // "Ver mais quotes" salta para a seguinte da lista, sem esperar por amanhã.
  if (!e.target.closest("#btn-outra-quote")) return;
  saltoQuote += 1;
  desenharQuote();
});

$("#etiquetas-notas").addEventListener("click", (e) => {
  const ficha = e.target.closest("[data-etiqueta]");
  if (!ficha) return;
  etiquetaEscolhida = ficha.dataset.etiqueta;
  desenharNotas();
});

/* --------------------------------------------------------------- revisão --- */

const NOTAS_SM2 = [
  { q: 1, rotulo: "Outra vez" },
  { q: 3, rotulo: "Difícil" },
  { q: 4, rotulo: "Bom" },
  { q: 5, rotulo: "Fácil" },
];

/**
 * SM-2 com dois desvios deliberados: no algoritmo original, "Difícil" e "Bom"
 * dão sempre o mesmo intervalo e só mexem na facilidade — os botões ficariam
 * todos com o mesmo prazo. Aqui "Fácil" salta à frente e "Difícil" avança devagar.
 * q<3 devolve o cartão ao fim da sessão em vez de o adiar para outro dia.
 */
function agendar(sm2, q) {
  let { intervalo, facilidade, repeticoes, revisoes } = sm2;
  if (q < 3) {
    repeticoes = 0;
    intervalo = 0;
  } else {
    repeticoes += 1;
    if (repeticoes === 1) intervalo = q === 5 ? 4 : 1;
    else if (repeticoes === 2) intervalo = q === 5 ? 10 : 6;
    else if (q === 3) intervalo = Math.max(intervalo + 1, Math.round(intervalo * 1.2));
    else intervalo = Math.round(intervalo * facilidade * (q === 5 ? 1.3 : 1));
  }
  facilidade = Math.max(1.3, facilidade + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  return {
    intervalo,
    facilidade: Number(facilidade.toFixed(2)),
    repeticoes,
    revisoes: (revisoes || 0) + 1,
    // Acerto é ter-se lembrado: "Difícil", "Bom" ou "Fácil". "Outra vez" não conta.
    acertos: (sm2.acertos || 0) + (q >= 3 ? 1 : 0),
    ultima: Date.now(),
    proxima: Date.now() + (intervalo === 0 ? 6e5 : intervalo * DIA),
  };
}

const prazo = (dias) => (dias === 0 ? "10 min" : dias === 1 ? "1 dia" : `${dias} dias`);

const devidos = () => vivos("cartoes").filter((c) => (c.sm2?.proxima || 0) <= Date.now());

function contarRevisao() {
  const n = devidos().length;
  const alvo = $("#conta-revisao");
  alvo.textContent = n || "";
  alvo.dataset.zero = n ? "nao" : "sim";
}

/* Entrar no módulo mostra o painel; a sessão só arranca a pedido. */
function comecarRevisao() {
  $("#revisao-painel").hidden = false;
  $("#revisao-sessao").hidden = true;
  desenharPainelRevisao();
}

function arrancarSessao() {
  estado.fila = devidos().sort((a, b) => a.sm2.proxima - b.sm2.proxima);
  estado.total = estado.fila.length;
  $("#revisao-painel").hidden = true;
  $("#revisao-sessao").hidden = false;
  proximoCartao();
}

/** A que assunto pertence o cartão: a rotina de origem, ou "Soltos". */
const assuntoDoCartao = (c) =>
  c.origem?.rotina ? NOMES[c.origem.rotina] || c.origem.rotina : "Soltos";

const COR_ASSUNTO = (nome) =>
  nome === NOMES["financas-geopolitica"]
    ? "var(--latao)"
    : nome === NOMES["inteligencia-artificial"]
      ? "var(--indigo)"
      : "var(--papel-fosco)";

function desenharPainelRevisao() {
  const cartoes = vivos("cartoes");
  const paraHoje = devidos();
  const revisoes = cartoes.reduce((n, c) => n + (c.sm2.revisoes || 0), 0);
  const acertos = cartoes.reduce((n, c) => n + (c.sm2.acertos || 0), 0);
  const taxa = revisoes ? Math.round((acertos / revisoes) * 100) : 0;

  const hoje = new Date();
  $("#data-revisao").textContent = hoje.toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" });
  $("#dia-revisao").textContent = hoje.toLocaleDateString("pt-PT", { weekday: "long" });

  const mosaico = (icone, n, etiqueta) =>
    `<div class="mosaico"><span class="icone">${icone}</span><span class="n">${n}</span><span class="et">${etiqueta}</span></div>`;

  $("#revisao-numeros").innerHTML = [
    mosaico(`<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4"/></svg>`, paraHoje.length, "A rever hoje"),
    mosaico(`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>`, revisoes, "Revisões feitas"),
    mosaico(`<svg viewBox="0 0 24 24"><path d="M12 2c1 4-2 5-2 8a4 4 0 0 0 8 0c0-1-.4-2-1-3 2 2 3 4 3 6a8 8 0 0 1-16 0c0-5 5-7 8-11z"/></svg>`, sequenciaDeDias(), "Dias seguidos"),
    mosaico(`<svg viewBox="0 0 24 24"><path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/></svg>`, revisoes ? `${taxa}%` : "—", "Taxa de acerto"),
  ].join("");

  // Hoje, por assunto
  $("#revisao-devidos").textContent = paraHoje.length;
  const porAssunto = {};
  for (const c of paraHoje) porAssunto[assuntoDoCartao(c)] = (porAssunto[assuntoDoCartao(c)] || 0) + 1;
  const assuntos = Object.entries(porAssunto).sort((a, b) => b[1] - a[1]);

  $("#revisao-legenda").innerHTML =
    assuntos
      .map(
        ([nome, n]) =>
          `<li style="--ponto:${COR_ASSUNTO(nome)}">${esc(nome)}<span class="n">${n}</span></li>`
      )
      .join("") || `<li style="--ponto:var(--tinta-3)">nada devido</li>`;

  const feitosHoje = cartoes.filter(
    (c) => c.sm2.ultima && new Date(c.sm2.ultima).toDateString() === hoje.toDateString()
  ).length;
  const alvo = paraHoje.length + feitosHoje;
  $("#revisao-anel").innerHTML = anel(alvo ? Math.round((feitosHoje / alvo) * 100) : 0);

  $("#btn-comecar-revisao").disabled = !paraHoje.length;
  $("#btn-comecar-revisao").textContent = paraHoje.length ? "▶ Começar revisão" : "Nada para rever agora";

  // Métodos: só os que existem de facto.
  $("#revisao-metodos").innerHTML = [
    {
      icone: `<svg viewBox="0 0 24 24"><rect x="3" y="6" width="14" height="11" rx="2"/><path d="M7 4h14v11"/></svg>`,
      nome: "Flashcards",
      texto: "Frente e verso, com o verso escondido até dizeres.",
      cor: "var(--latao)",
    },
    {
      icone: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`,
      nome: "Revisão espaçada",
      texto: "SM-2, com os quatro prazos visíveis em cada botão.",
      cor: "var(--indigo)",
    },
  ]
    .map(
      (m) => `<div class="metodo" style="--ponto:${m.cor}">
        <span class="icone">${m.icone}</span>
        <h4>${m.nome}</h4>
        <p>${m.texto}</p>
        <span class="selo">Ativo</span>
      </div>`
    )
    .join("");

  // Próximas: agrupadas pelo dia em que ficam devidas.
  const futuros = cartoes.filter((c) => c.sm2.proxima > Date.now());
  const porDia = {};
  for (const c of futuros) {
    const chave = new Date(c.sm2.proxima).toDateString();
    (porDia[chave] ||= []).push(c);
  }
  const dias = Object.entries(porDia)
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .slice(0, 5);

  $("#revisao-proximas").innerHTML =
    dias
      .map(([chave, lista]) => {
        const d = new Date(chave);
        const assunto = assuntoDoCartao(lista[0]);
        const emDias = Math.max(1, Math.round((d - new Date().setHours(0, 0, 0, 0)) / DIA));
        return `<div class="proxima-revisao" style="--ponto:${COR_ASSUNTO(assunto)}">
          <span class="dia"><b>${d.getDate()}</b><span>${d.toLocaleDateString("pt-PT", { month: "short" })}</span></span>
          <span class="corpo">
            <b>${lista.length} ${lista.length === 1 ? "conceito" : "conceitos"}</b>
            <span>${esc(assunto)} · daqui a ${prazo(emDias)}</span>
          </span>
        </div>`;
      })
      .join("") ||
    `<p class="linha"><span class="texto"><span>Sem revisões agendadas. Faz cartões a partir das notas ou dos temas.</span></span></p>`;
}

$("#btn-comecar-revisao").addEventListener("click", arrancarSessao);
$("#btn-sair-revisao").addEventListener("click", comecarRevisao);

function proximoCartao() {
  estado.cartaoAtual = estado.fila[0] || null;
  estado.versoVisivel = false;
  desenharRevisao();
}

function desenharRevisao() {
  const palco = $("#palco-revisao");
  const feitos = (estado.total || 0) - estado.fila.length;
  $("#progresso-revisao").textContent = estado.total ? `${feitos} de ${estado.total}` : "";
  $("#barra-revisao").style.width = estado.total ? `${(feitos / estado.total) * 100}%` : "0%";

  if (!estado.cartaoAtual) {
    const totalCartoes = vivos("cartoes").length;
    palco.innerHTML = totalCartoes
      ? vazio("Revisão em dia", "Os cartões voltam sozinhos quando chegar a altura de os rever.")
      : vazio("Ainda não há cartões", "Abre uma edição e transforma um tema num cartão.");
    contarRevisao();
    return;
  }

  const c = estado.cartaoAtual;
  palco.innerHTML = `
    <div class="cartao">
      <div class="frente">${esc(c.frente)}</div>
      ${estado.versoVisivel ? `<div class="verso">${esc(c.verso)}</div>` : ""}
    </div>
    ${
      estado.versoVisivel
        ? `<div class="notas-revisao">${NOTAS_SM2.map(
            (n) =>
              `<button class="btn" data-nota-sm2="${n.q}">${n.rotulo}<small>${prazo(
                agendar(c.sm2, n.q).intervalo
              )}</small></button>`
          ).join("")}</div>`
        : `<div class="accoes" style="margin-top:0.9rem">
             <button class="btn" data-tom="forte" id="btn-ver" style="flex:1">Ver resposta</button>
             <button class="btn" data-editar-cartao="${esc(c.id)}">Editar</button>
           </div>`
    }`;
}

function classificar(q) {
  const c = estado.cartaoAtual;
  c.sm2 = agendar(c.sm2, q);
  alterar("cartoes", c);
  estado.fila.shift();
  if (q < 3) estado.fila.push(c); // volta no fim da sessão
  proximoCartao();
}

/* ----------------------------------------------------------------- folha --- */

const folha = $("#folha");
let contexto = null;

function abrirFolha(modo, dados = {}) {
  contexto = { modo, ...dados };
  const nota = modo.startsWith("nota");
  $("#folha-rotulo").textContent = dados.origem
    ? `${NOMES[dados.origem.rotina] || dados.origem.rotina} · ${dataCurta(dados.origem.data)}`
    : "nota solta";
  $("#folha-titulo").textContent = {
    "nota-nova": "Nova nota",
    "nota-editar": "Editar nota",
    "cartao-novo": "Novo cartão",
    "cartao-editar": "Editar cartão",
  }[modo];
  $("#folha-frente").placeholder = nota ? "Título" : "Frente — a pergunta";
  $("#folha-verso").placeholder = nota ? "O que queres guardar" : "Verso — a resposta";
  $("#folha-frente").value = dados.frente || "";
  $("#folha-verso").value = dados.verso || "";
  // A etiqueta só faz sentido nas notas; nos cartões a fila esconde-se.
  $("#folha-etiquetas").hidden = !nota;
  marcarEtiqueta(dados.etiqueta || (etiquetaEscolhida !== "Todas" ? etiquetaEscolhida : ""));
  $("#folha-aviso").textContent = "";
  $("#folha-apagar").hidden = !modo.endsWith("editar");
  $("#folha-para-cartao").hidden = modo !== "nota-editar";
  folha.showModal();
  $("#folha-frente").focus();
}

function marcarEtiqueta(valor) {
  contexto.etiqueta = valor || "";
  document
    .querySelectorAll("[data-etiqueta]")
    .forEach((b) =>
      b.setAttribute("aria-current", b.dataset.etiqueta === contexto.etiqueta ? "true" : "false")
    );
}

// Tocar na etiqueta já escolhida tira-a: uma nota pode não ter nenhuma.
$("#folha-etiquetas").addEventListener("click", (e) => {
  const b = e.target.closest("[data-etiqueta]");
  if (b) marcarEtiqueta(contexto.etiqueta === b.dataset.etiqueta ? "" : b.dataset.etiqueta);
});

function guardarFolha() {
  const frente = $("#folha-frente").value.trim();
  const verso = $("#folha-verso").value.trim();
  const nota = contexto.modo.startsWith("nota");

  if (!nota && !frente) return ($("#folha-aviso").textContent = "A frente do cartão não pode ficar vazia.");
  if (nota && !frente && !verso) return ($("#folha-aviso").textContent = "Escreve um título ou um texto.");

  if (nota) {
    const item = estado.biblioteca.notas[contexto.id] || {
      id: id(),
      criado_em: Date.now(),
      origem: contexto.origem || null,
      apagado: false,
    };
    alterar("notas", { ...item, titulo: frente, texto: verso, etiqueta: contexto.etiqueta || "" });
    desenharNotas();
  } else {
    const item = estado.biblioteca.cartoes[contexto.id] || {
      id: id(),
      criado_em: Date.now(),
      origem: contexto.origem || null,
      apagado: false,
      sm2: { intervalo: 0, facilidade: 2.5, repeticoes: 0, proxima: Date.now(), revisoes: 0 },
    };
    alterar("cartoes", { ...item, frente, verso });
    contarRevisao();
    if (estado.vista === "revisao") desenharRevisao();
  }
  folha.close();
}

function apagarFolha() {
  const tipo = contexto.modo.startsWith("nota") ? "notas" : "cartoes";
  const item = estado.biblioteca[tipo][contexto.id];
  if (item) alterar(tipo, { ...item, apagado: true });
  folha.close();
  if (tipo === "notas") desenharNotas();
  else {
    estado.fila = estado.fila.filter((c) => c.id !== contexto.id);
    contarRevisao();
    proximoCartao();
  }
}

/* ---------------------------------------------------------------- eventos --- */

document.addEventListener("click", (evento) => {
  const alvo = evento.target.closest("[data-ir], [data-rotina], [data-acao], [data-nota], [data-nota-sm2], [data-editar-cartao], #btn-ver, #btn-nota-nova, #btn-chave, #folha-guardar, #folha-cancelar, #folha-apagar, #folha-para-cartao, #estado");
  if (!alvo) return;

  if (alvo.dataset.ir) return irPara(alvo.dataset.ir);
  if (alvo.dataset.rotina) return irPara("edicao", alvo.dataset.rotina, alvo.dataset.data);

  if (alvo.dataset.acao) {
    const item = estado.edicaoAberta.itens[Number(alvo.dataset.item)];
    const origem = { rotina: estado.edicaoAberta.rotina, data: estado.edicaoAberta.data };
    const texto = String(item.texto).replace(/\s*Porque interessa:\s*/i, "\n\nPorque interessa: ");
    if (alvo.dataset.acao === "nota") {
      abrirFolha("nota-nova", { origem, frente: item.titulo, verso: texto });
    } else {
      abrirFolha("cartao-novo", { origem, frente: "", verso: texto });
    }
    return;
  }

  if (alvo.dataset.nota) {
    const n = estado.biblioteca.notas[alvo.dataset.nota];
    return abrirFolha("nota-editar", {
      id: n.id,
      frente: n.titulo,
      verso: n.texto,
      origem: n.origem,
      etiqueta: n.etiqueta,
    });
  }

  if (alvo.dataset.editarCartao) {
    const c = estado.biblioteca.cartoes[alvo.dataset.editarCartao];
    return abrirFolha("cartao-editar", { id: c.id, frente: c.frente, verso: c.verso, origem: c.origem });
  }

  if (alvo.dataset.notaSm2) return classificar(Number(alvo.dataset.notaSm2));

  switch (alvo.id) {
    case "btn-ver":
      estado.versoVisivel = true;
      return desenharRevisao();
    case "btn-nota-nova":
      return abrirFolha("nota-nova", {});
    case "btn-chave":
      return ligar();
    case "folha-guardar":
      return guardarFolha();
    case "folha-cancelar":
      return folha.close();
    case "folha-apagar":
      return apagarFolha();
    case "folha-para-cartao": {
      const titulo = $("#folha-frente").value.trim();
      const corpo = $("#folha-verso").value.trim();
      folha.close();
      return abrirFolha("cartao-novo", { origem: contexto.origem, frente: titulo, verso: corpo });
    }
    case "estado":
      return sincronizar();
    case "btn-atualizar":
      return atualizarTudo();
  }
});

$("#procura").addEventListener("input", desenharNotas);
$("#campo-chave").addEventListener("keydown", (e) => e.key === "Enter" && ligar());

document.addEventListener("keydown", (evento) => {
  if (estado.vista !== "revisao" || folha.open || !estado.cartaoAtual) return;
  if (evento.key === " " && !estado.versoVisivel) {
    evento.preventDefault();
    estado.versoVisivel = true;
    return desenharRevisao();
  }
  if (estado.versoVisivel && ["1", "2", "3", "4"].includes(evento.key)) {
    classificar(NOTAS_SM2[Number(evento.key) - 1].q);
  }
});

window.addEventListener("online", sincronizar);
window.addEventListener("offline", () => marcarEstado("offline", "offline"));

$("#btn-voltar-edicao").addEventListener("click", () => irPara(estado.moduloOrigem || "noticias"));

/* ---------------------------------------------------------------- quotes --- */

/* Colectânea fixa: roda pelo dia do ano, funciona offline e não gasta corridas.
   Todas de obras publicadas e identificadas — se acrescentares, mantém a fonte. */
const QUOTES = [
  ["Não é que tenhamos pouco tempo, é que perdemos muito.", "Séneca, Sobre a Brevidade da Vida"],
  ["Enquanto se adia, a vida passa.", "Séneca, Cartas a Lucílio"],
  ["Nenhum vento é favorável a quem não sabe para que porto se dirige.", "Séneca, Cartas a Lucílio"],
  ["O impedimento à ação faz avançar a ação. O que está no caminho torna-se o caminho.", "Marco Aurélio, Meditações"],
  ["Tens poder sobre a tua mente, não sobre os acontecimentos.", "Marco Aurélio, Meditações"],
  ["A qualidade da tua vida depende da qualidade dos teus pensamentos.", "Marco Aurélio, Meditações"],
  ["Ninguém escreve um livro só; escreve-o com tudo o que leu.", "Montaigne, Ensaios"],
  ["O primeiro princípio é não te enganares a ti próprio — e tu és a pessoa mais fácil de enganar.", "Richard Feynman"],
  ["A ciência é uma forma de não nos enganarmos.", "Richard Feynman"],
  ["Não sobrevive a espécie mais forte, mas a que melhor se adapta à mudança.", "atribuído a Charles Darwin"],
  ["A ignorância gera mais confiança do que o conhecimento.", "Charles Darwin, A Origem do Homem"],
  ["Ler é conversar com os homens mais sábios de séculos passados.", "Descartes, Discurso do Método"],
  ["Divide cada dificuldade em tantas partes quantas forem possíveis para a resolver.", "Descartes, Discurso do Método"],
  ["Alguns livros devem ser provados, outros engolidos, e poucos mastigados e digeridos.", "Francis Bacon, Ensaios"],
  ["O conhecimento é poder.", "Francis Bacon, Meditationes Sacrae"],
  ["Aquele que tem um porquê para viver suporta quase qualquer como.", "Nietzsche, Crepúsculo dos Ídolos"],
  ["Os limites da minha linguagem são os limites do meu mundo.", "Wittgenstein, Tractatus"],
  ["Aquilo de que não se pode falar, deve-se calar.", "Wittgenstein, Tractatus"],
  ["Uma vida não examinada não vale a pena ser vivida.", "Sócrates, em Apologia de Platão"],
  ["Só sei que nada sei.", "atribuído a Sócrates, a partir de Platão"],
  ["Somos aquilo que fazemos repetidamente.", "Will Durant, a resumir Aristóteles"],
  ["O todo é maior do que a soma das partes.", "Aristóteles, Metafísica"],
  ["Aprender sem pensar é trabalho perdido; pensar sem aprender é perigoso.", "Confúcio, Analectos"],
  ["Não te preocupes por não seres conhecido; preocupa-te por não seres digno de o ser.", "Confúcio, Analectos"],
];

let saltoQuote = 0;

function desenharQuote() {
  const inicio = Date.UTC(new Date().getUTCFullYear(), 0, 1);
  const dia = Math.floor((Date.now() - inicio) / DIA);
  const [texto, fonte] = QUOTES[(dia + saltoQuote) % QUOTES.length];
  $("#quote").innerHTML = `<span class="rotulo">Quote do dia ❞</span>
    <blockquote>“${esc(texto)}”</blockquote>
    <figcaption>${esc(fonte)}</figcaption>
    <button class="ver-mais" id="btn-outra-quote">Ver mais quotes ›</button>`;
}

/* ---------------------------------------------------------- aprendizagem --- */

const CORES_AREA = { latao: "var(--latao)", indigo: "var(--indigo)", sobe: "var(--sobe)", rust: "var(--rust)" };

const progressoArea = (a) =>
  a.temas.length ? Math.round((a.temas.filter((t) => t.feito).length / a.temas.length) * 100) : 0;

/**
 * Sequência de dias: dias seguidos, a contar de hoje para trás, com pelo menos
 * uma alteração na biblioteca. Sai do que já existe, não de um contador à parte.
 */
function sequenciaDeDias() {
  const dias = new Set();
  for (const tipo of TIPOS) {
    for (const item of Object.values(estado.biblioteca[tipo])) {
      if (item.atualizado_em) dias.add(new Date(item.atualizado_em).toDateString());
    }
  }
  let conta = 0;
  const cursor = new Date();
  while (dias.has(cursor.toDateString())) {
    conta++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return conta;
}

const anel = (pct) => `<svg class="anel" viewBox="0 0 40 40">
  <circle class="fundo" cx="20" cy="20" r="16"/>
  <circle class="frente" cx="20" cy="20" r="16"
    stroke-dasharray="${(2 * Math.PI * 16).toFixed(1)}"
    stroke-dashoffset="${(2 * Math.PI * 16 * (1 - pct / 100)).toFixed(1)}"/>
  <text x="20" y="20">${pct}</text>
</svg>`;

/* ------------------------------------------------------------ áreas base --- */

/**
 * Seis áreas de arranque, cada uma com um percurso já escrito do princípio ao
 * fim. Semeiam-se uma vez só: se depois forem apagadas, ficam apagadas.
 */
const AREAS_SEMENTE = [
  {
    nome: "Inteligência Artificial",
    sigla: "IA",
    cor: "indigo",
    rotina: "inteligencia-artificial",
    temas: [], // esta área é o curso: o percurso vem das aulas publicadas
  },
  {
    nome: "Melhoria Pessoal",
    sigla: "MP",
    cor: "sobe",
    rotina: "curso-uteis",
    temas: [
      "Canalização básica: desentupir, trocar torneira e sifão",
      "Furar parede: brocas, buchas e onde não furar",
      "Pintar uma divisão: preparação, primário e acabamento",
      "Nós essenciais: direito, oito, volta do fiel e nó de pescador",
      "Kit de primeiros socorros e os primeiros cinco minutos",
      "Extintores: classes de fogo e qual usar",
      "Eletricidade: tensão, corrente, resistência e a lei de Ohm",
      "Quadro elétrico: disjuntores, diferencial e o que faz saltar a luz",
      "Trocar tomada, interruptor e ponto de luz em segurança",
      "Usar o multímetro: continuidade, tensão e resistência",
      "Motor a quatro tempos: as quatro fases explicadas",
      "Óleo, filtros e travões: quando mudar e o que verificar",
      "Pneus: pressão, desgaste irregular e mudança de roda",
      "Bateria e alternador: medir e arrancar com pinças",
      "Ler códigos OBD2 e perceber a luz do motor",
      "Orçamento pessoal: registar, categorizar e poupar por objetivo",
      "IRS: escalões, deduções e o que se perde por esquecimento",
      "Contratos e seguros: o que ler antes de assinar",
      "Segurança digital: gestor de palavras-passe e dois fatores",
      "Manutenção de casa e de carro por estação do ano",
      "Cozinha: faca, cortes e o refogado que é base de tudo",
      "Cozinha: ponto da carne, do peixe e dos ovos",
      "Cozinha: arroz, massa e batata sem falhar as proporções",
      "Cozinha: sopa, caldos e cozinhar em lote para a semana",
    ],
  },
  {
    nome: "História",
    sigla: "HI",
    cor: "rust",
    rotina: "curso-historia",
    temas: [
      "Mesopotâmia e Egito: escrita, cidade e Estado",
      "Grécia: pólis, democracia ateniense e o legado do pensamento",
      "Roma: república, império e as razões da queda",
      "Idade Média: feudalismo, Igreja e as invasões",
      "Formação de Portugal: condado, Afonso Henriques e a reconquista",
      "Expansão marítima: Ceuta, Índia, Brasil e o preço humano",
      "Renascimento, Reforma e revolução científica",
      "Revoluções liberais: França, América e o constitucionalismo",
      "Revolução Industrial e o nascimento do operariado",
      "Primeira República e o Estado Novo em Portugal",
      "Duas guerras mundiais e o Holocausto",
      "Guerra Fria, descolonização e o 25 de Abril",
      "Integração europeia e o mundo depois de 1989",
    ],
  },
  {
    nome: "Línguas",
    sigla: "LN",
    cor: "indigo",
    rotina: "curso-linguas",
    temas: [
      "Alfabeto, sons nasais e as ligações entre palavras",
      "Cumprimentos, apresentações e tratamento por tu ou vous",
      "Artigos definidos, indefinidos e partitivos",
      "Presente dos verbos em -er, -ir e -re",
      "Être, avoir, aller e faire: os quatro que abrem tudo",
      "Números, horas, dias e datas",
      "Perguntar: est-ce que, inversão e as palavras interrogativas",
      "Passado composto contra imperfeito",
      "Futuro próximo e futuro simples",
      "Pronomes complemento: le, la, lui, y, en",
      "Vocabulário do dia a dia: casa, comida, transportes, trabalho",
      "Subjuntivo presente: quando e porquê",
      "Ler um jornal francês e ouvir rádio sem legendas",
    ],
  },
];

/** Semeia as áreas de arranque. Uma vez só: se forem apagadas, ficam apagadas. */
function semearAreas() {
  if (localStorage.getItem("venera:areas-semente")) return;
  localStorage.setItem("venera:areas-semente", "1");
  if (vivos("areas").length) return; // quem já tinha as suas fica com elas
  for (const base of AREAS_SEMENTE) {
    alterar("areas", {
      id: id(),
      nome: base.nome,
      sigla: base.sigla,
      cor: base.cor,
      rotina: base.rotina || "",
      temas: base.temas.map((nome) => ({ nome, feito: false })),
      criado_em: Date.now(),
      apagado: false,
    });
  }
}

/**
 * Migração para a versão 2 das áreas: Mecânica e Eletricidade desaparecem e os
 * seus temas passam para Melhoria Pessoal, que era Coisas úteis. Cada área fica
 * ligada à rotina do seu curso.
 */
function migrarAreas() {
  if (localStorage.getItem("venera:areas-versao") === "2") return;
  localStorage.setItem("venera:areas-versao", "2");

  const porNome = (n) => vivos("areas").find((a) => a.nome.toLowerCase() === n);
  const uteis = porNome("coisas úteis") || porNome("melhoria pessoal");
  if (uteis) {
    const juntar = [porNome("mecânica"), porNome("eletricidade")].filter(Boolean);
    const nomesJa = new Set(uteis.temas.map((t) => t.nome));
    for (const velha of juntar) {
      for (const tema of velha.temas) if (!nomesJa.has(tema.nome)) uteis.temas.push(tema);
      velha.apagado = true;
      alterar("areas", velha);
    }
    uteis.nome = "Melhoria Pessoal";
    uteis.sigla = "MP";
    uteis.rotina = "curso-uteis";
    alterar("areas", uteis);
  }

  // As restantes ganham a rotina do curso correspondente.
  for (const base of AREAS_SEMENTE) {
    const existente = porNome(base.nome.toLowerCase());
    if (existente && !existente.rotina) {
      existente.rotina = base.rotina;
      alterar("areas", existente);
    }
  }

  // A área do curso de IA pode ainda não existir: cria-se sem temas.
  if (!porNome("inteligência artificial")) {
    const ia = AREAS_SEMENTE[0];
    alterar("areas", {
      id: id(),
      nome: ia.nome,
      sigla: ia.sigla,
      cor: ia.cor,
      rotina: ia.rotina,
      temas: [],
      criado_em: Date.now(),
      apagado: false,
    });
  }
}

/**
 * Versão 3: os cursos passam a ser quatro. O Francês alarga-se a Línguas e a
 * Cozinha deixa de ser área própria — os seus temas entram na Melhoria Pessoal.
 */
function migrarCursos() {
  if (localStorage.getItem("venera:areas-versao") === "3") return;
  localStorage.setItem("venera:areas-versao", "3");

  const porNome = (n) => vivos("areas").find((a) => a.nome.toLowerCase() === n);

  const frances = porNome("francês");
  if (frances) {
    frances.nome = "Línguas";
    frances.sigla = "LN";
    frances.rotina = "curso-linguas";
    alterar("areas", frances);
  }

  const cozinha = porNome("cozinha");
  const melhoria = porNome("melhoria pessoal");
  if (cozinha && melhoria) {
    const jaLa = new Set(melhoria.temas.map((t) => t.nome));
    for (const tema of cozinha.temas) {
      if (!jaLa.has(tema.nome)) melhoria.temas.push({ ...tema, nome: `Cozinha: ${tema.nome}` });
    }
    alterar("areas", melhoria);
    cozinha.apagado = true;
    alterar("areas", cozinha);
  }
}

/** O primeiro tema por fazer de uma área — o que vem a seguir. */
const proximoTema = (area) => area.temas.find((t) => !t.feito)?.nome || "";

function desenharAprendizagem() {
  semearAreas();
  migrarAreas();
  migrarCursos();
  const areas = vivos("areas");
  const curso = estado.edicaoCurso;

  const temasTotais = areas.reduce((n, a) => n + a.temas.length, 0);
  const temasFeitos = areas.reduce((n, a) => n + a.temas.filter((t) => t.feito).length, 0);
  const geral = temasTotais ? Math.round((temasFeitos / temasTotais) * 100) : 0;
  const cartoesSabidos = vivos("cartoes").filter((c) => c.sm2.repeticoes > 0).length;

  const mosaico = (icone, n, etiqueta) =>
    `<div class="mosaico"><span class="icone">${icone}</span><span class="n">${n}</span><span class="et">${etiqueta}</span></div>`;

  $("#aprender-numeros").innerHTML = [
    mosaico(`<svg viewBox="0 0 24 24"><path d="M4 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-7a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h7z"/></svg>`, areas.length, "Áreas ativas"),
    // O progresso era um anel com o número lá dentro, de outro tamanho e noutro
    // sítio. Passa a ser um número como os outros, com o anel reduzido a ícone.
    mosaico(anel(geral), `${geral}%`, "Progresso geral"),
    mosaico(`<svg viewBox="0 0 24 24"><path d="M12 2c1 4-2 5-2 8a4 4 0 0 0 8 0c0-1-.4-2-1-3 2 2 3 4 3 6a8 8 0 0 1-16 0c0-5 5-7 8-11z"/></svg>`, sequenciaDeDias(), "Dias seguidos"),
    mosaico(`<svg viewBox="0 0 24 24"><path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/></svg>`, temasFeitos + cartoesSabidos, "Conceitos sabidos"),
  ].join("");

  /* A aula que está na app é a última publicada, não necessariamente a de hoje.
     (diasDesde serve tanto o cartão da aula como a lista de cursos.)
     Dizer "o curso de hoje" quando a rotina não corre há onze dias é mentira, e
     ainda por cima esconde que a rotina parou. */
  const diasDesde = (data) => {
    if (!data) return null;
    const d = new Date(`${data}T12:00:00`);
    return Math.max(0, Math.round((Date.now() - d.getTime()) / DIA));
  };
  const atraso = curso ? diasDesde(curso.data) : null;
  const frescura =
    atraso === null
      ? ""
      : atraso === 0
        ? `<span class="selo fresco">hoje</span>`
        : atraso === 1
          ? `<span class="selo velho">ontem</span>`
          : `<span class="selo velho">há ${atraso} dias</span>`;

  /* ------------------------------------------------------------- lição --- */
  /* As rotinas alternam por dia da semana: segunda IA, terça História, quarta
     Francês, quinta Melhoria Pessoal, sexta outra vez IA — o ciclo tem quatro
     e a semana tem sete, por isso vai rodando sozinho. */
  const cursos = estado.cursos || [];
  const ROTACAO = ["inteligencia-artificial", "curso-historia", "curso-linguas", "curso-uteis"];
  const diaSemana = (new Date().getDay() + 6) % 7; // 0 = segunda
  const rotinaDoDia = ROTACAO[diaSemana % ROTACAO.length];

  const areaDoDia = areas.find((a) => a.rotina === rotinaDoDia);
  const aulaDoDia = cursos.find((c) => c.rotina === rotinaDoDia && diasDesde(c.data) === 0);
  const ultimaDaArea = cursos.find((c) => c.rotina === rotinaDoDia);
  const temaDoDia = areaDoDia ? proximoTema(areaDoDia) : "";

  const nomeDoDia = NOMES[rotinaDoDia] || areaDoDia?.nome || "Hoje";
  const corDoDia = COR[rotinaDoDia] || "var(--latao)";
  const dias = ultimaDaArea ? diasDesde(ultimaDaArea.data) : null;

  const cartaoLicao = () => {
    // Com aula publicada hoje, é ela; sem ela, é o tema que vem a seguir no
    // percurso da área — o estudo do dia não fica à espera da rotina.
    const titulo = aulaDoDia?.titulo || temaDoDia || `Sem tema por fazer em ${nomeDoDia}`;
    const meta = aulaDoDia
      ? `Aula de hoje${aulaDoDia.progresso?.dia ? ` · Dia ${aulaDoDia.progresso.dia}` : ""}${
          aulaDoDia.progresso?.leitura_min ? ` · ${aulaDoDia.progresso.leitura_min} min` : ""
        }`
      : ultimaDaArea
        ? `Tema a seguir · última aula há ${dias} ${dias === 1 ? "dia" : "dias"}`
        : "Tema a seguir · rotina ainda sem aulas";
    const accao = aulaDoDia
      ? `data-curso="${esc(aulaDoDia.rotina)}" data-data="${esc(aulaDoDia.data)}"`
      : areaDoDia
        ? `data-area="${esc(areaDoDia.id)}"`
        : "";

    return `<button class="cartao-licao" data-rotina="${esc(rotinaDoDia)}"
        style="--marcador:${corDoDia}" ${accao}>
      <span class="veu"></span>
      <span class="dentro">
        <span class="rotulo nome-area">${esc(nomeDoDia)}</span>
        <b>${esc(titulo)}</b>
        <span class="rotulo meta">${esc(meta)}</span>
      </span>
      <span class="seta">›</span>
    </button>`;
  };

  const cartoesDevidos = devidos().length;
  const porFazer = areas.flatMap((a) => a.temas.filter((t) => !t.feito));

  $("#conta-temas").textContent = `${porFazer.length} temas por fazer`;
  $("#aprender-plano").innerHTML = `${cartaoLicao()}
    <div class="cartao-plano">
      <button class="linha-plano" style="--marcador:var(--papel-fosco)" data-ir="revisao">
        <span class="emoji">🔁</span>
        <span class="corpo">
          <b>${
            cartoesDevidos
              ? `${cartoesDevidos} ${cartoesDevidos === 1 ? "cartão" : "cartões"} para rever`
              : "Nada para rever hoje"
          }</b>
          <span>Revisão espaçada</span>
        </span>
        <span class="seta">›</span>
      </button>
    </div>`;

  /* ------------------------------------------------------------- áreas --- */
  /* Cada curso é um cartão grande com a sua fotografia, o progresso do percurso
     e a idade da última aula. A imagem é escolhida pelo data-rotina no CSS. */
  $("#aprender-areas").innerHTML = areas.length
    ? `<div class="cartoes-curso">${areas
        .map((a) => {
          const pct = progressoArea(a);
          const feitos = a.temas.filter((t) => t.feito).length;
          const aula = cursos.find((c) => c.rotina === a.rotina);
          const d = aula ? diasDesde(aula.data) : null;
          const idade = d === 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`;
          return `<button class="cartao-curso-grande" data-area="${esc(a.id)}"
              data-rotina="${esc(a.rotina || "")}" style="--marcador:${CORES_AREA[a.cor]}">
            <span class="veu"></span>
            <span class="dentro">
              <span class="alto">
                <span class="sigla">${esc(a.sigla || SIGLA(a.nome))}</span>
                ${
                  aula
                    ? `<span class="aula" data-curso="${esc(aula.rotina)}" data-data="${esc(aula.data)}">
                        <i class="rotulo">Última aula</i><b>${idade}</b>
                      </span>`
                    : `<span class="aula sem"><i class="rotulo">Sem aulas ainda</i></span>`
                }
              </span>
              <span class="baixo">
                <h4>${esc(a.nome)}</h4>
                <span class="rotulo">${
                  a.temas.length
                    ? `${feitos} de ${a.temas.length} temas · ${pct}%`
                    : "percurso pelas aulas"
                }</span>
                ${a.temas.length ? `<span class="barra-progresso"><i style="width:${pct}%"></i></span>` : ""}
              </span>
            </span>
          </button>`;
        })
        .join("")}</div>`
    : vazio("Ainda sem cursos", "Cria o primeiro e liga-lhe uma rotina.");
}





let areaAberta = null;

function mostrarEdicaoArea(sim) {
  $("#area-edicao").hidden = !sim;
  $("#area-percurso").hidden = sim;
  $("#area-guardar").style.display = sim ? "" : "none";
  $("#area-apagar").style.display = sim && areaAberta?.nome ? "" : "none";
}

/** O percurso da área: tocar num tema marca-o feito, tocar outra vez desmarca. */
function desenharPercursoArea() {
  const feitos = areaAberta.temas.filter((t) => t.feito).length;
  const total = areaAberta.temas.length;
  $("#area-progresso").textContent = total
    ? `${feitos} de ${total} temas · ${Math.round((feitos / total) * 100)}%`
    : "sem temas ainda";

  $("#area-temas-lista").innerHTML = areaAberta.temas
    .map(
      (t, i) => `<li>
        <button data-tema="${i}" data-feito="${t.feito ? "sim" : "nao"}">
          <span class="caixa">${t.feito ? "✓" : ""}</span>
          <span class="num">${String(i + 1).padStart(2, "0")}</span>
          <span class="nome">${esc(t.nome)}</span>
        </button>
      </li>`
    )
    .join("");
}

$("#area-temas-lista").addEventListener("click", (e) => {
  const alvo = e.target.closest("[data-tema]");
  if (!alvo) return;
  const tema = areaAberta.temas[Number(alvo.dataset.tema)];
  tema.feito = !tema.feito;
  alterar("areas", areaAberta);
  desenharPercursoArea();
  desenharAprendizagem();
});

$("#area-editar").addEventListener("click", () => mostrarEdicaoArea(true));

function abrirArea(area) {
  areaAberta = area || {
    id: id(),
    nome: "",
    sigla: "",
    cor: "latao",
    temas: [],
    criado_em: Date.now(),
    apagado: false,
  };
  $("#area-rotulo").textContent = area ? areaAberta.nome : "Nova área";
  $("#area-nome").value = areaAberta.nome;
  $("#area-sigla").value = areaAberta.sigla;
  $("#area-temas").value = areaAberta.temas.map((t) => (t.feito ? "x " : "") + t.nome).join("\n");
  $("#area-apagar").style.display = area ? "" : "none";
  marcarCorArea(areaAberta.cor);

  // Área existente abre no percurso; área nova abre logo na edição.
  mostrarEdicaoArea(!area);
  desenharPercursoArea();
  $("#folha-area").showModal();
}

function marcarCorArea(cor) {
  areaAberta.cor = cor;
  $("#area-cores").innerHTML = Object.entries(CORES_AREA)
    .map(
      ([n, c]) =>
        `<button class="ponto-cor" data-cor-area="${n}" aria-current="${n === cor}" style="background:${c}" aria-label="${n}"></button>`
    )
    .join("");
}

$("#area-cores").addEventListener("click", (e) => {
  const cor = e.target.closest("[data-cor-area]");
  if (cor) marcarCorArea(cor.dataset.corArea);
});

$("#btn-area-nova").addEventListener("click", () => abrirArea(null));
$("#area-cancelar").addEventListener("click", () => $("#folha-area").close());

$("#area-guardar").addEventListener("click", () => {
  // Guardar volta ao percurso, que é onde se vive depois de a área existir.
  areaAberta.nome = $("#area-nome").value.trim();
  if (!areaAberta.nome) return;
  areaAberta.sigla = $("#area-sigla").value.trim().toUpperCase();
  // "x " à cabeça marca o tema como feito; é a forma mais rápida de o fazer a escrever.
  areaAberta.temas = $("#area-temas")
    .value.split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha) => {
      const feito = /^x\s+/i.test(linha);
      return { nome: linha.replace(/^x\s+/i, ""), feito };
    });
  alterar("areas", areaAberta);
  mostrarEdicaoArea(false);
  desenharPercursoArea();
  $("#area-rotulo").textContent = areaAberta.nome;
  desenharAprendizagem();
});

$("#area-apagar").addEventListener("click", () => {
  areaAberta.apagado = true;
  alterar("areas", areaAberta);
  $("#folha-area").close();
  desenharAprendizagem();
});

/* O plano é desenhado a cada pintura: os seus botões vão por delegação, senão
   ficavam sem dono e o toque não fazia nada. */
function cliqueAprender(e) {
  const area = e.target.closest("[data-area]");
  if (area) return abrirArea(estado.biblioteca.areas[area.dataset.area]);

  const aula = e.target.closest("[data-curso]");
  if (aula) return irPara("edicao", aula.dataset.curso, aula.dataset.data);

  const ir = e.target.closest("[data-ir]");
  if (ir) irPara(ir.dataset.ir);
}

$("#aprender-plano").addEventListener("click", cliqueAprender);
$("#aprender-areas").addEventListener("click", cliqueAprender);

document.querySelector('[data-ir="aprendizagem-arquivo"]').addEventListener("click", () => {
  const arquivo = $("#aprender-arquivo");
  arquivo.hidden = !arquivo.hidden;
});

/* ---------------------------------------------------------------- livros --- */

const ESTADOS_LIVRO = { a_ler: "A ler", lido: "Lido", recomendado: "Recomendado" };

let livroAberto = null;

const GENEROS = [
  ["📖", "Ficção"],
  ["🌱", "Desenvolvimento Pessoal"],
  ["💼", "Negócios"],
  ["🏛️", "História"],
  ["👤", "Biografias"],
  ["🔬", "Ciência"],
];

/** Género escolhido nas fichas de inspiração. Vazio é a biblioteca toda. */
let generoEscolhido = "";

const ICONE_LIVRO = {
  livros: `<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2zM20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 0 2-2z"/></svg>`,
  aLer: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  lido: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>`,
  depois: `<svg viewBox="0 0 24 24"><path d="M6 4h12v17l-6-4-6 4z"/></svg>`,
  organiza: `<svg viewBox="0 0 24 24"><path d="M6 4h12v17l-6-4-6 4z"/></svg>`,
  acompanha: `<svg viewBox="0 0 24 24"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>`,
  descobre: `<svg viewBox="0 0 24 24"><path d="M12 4l2.4 5.2 5.6.7-4.2 3.9 1.2 5.6L12 16.6 6.9 19.4l1.2-5.6L4 9.9l5.6-.7z"/></svg>`,
};

function desenharLivros() {
  const procura = $("#procura-livros").value.trim().toLowerCase();
  const todos = vivos("livros");

  // Painel da biblioteca: as quatro contas que dizem em que pé vai a leitura.
  const conta = (icone, n, l1, l2) =>
    `<div class="celula">${icone}<b>${n}</b><span>${l1}<br>${l2}</span></div>`;
  $("#numeros-livros").innerHTML = `<div class="painel-livros">
    ${conta(ICONE_LIVRO.livros, todos.length, "Livros", "na biblioteca")}
    ${conta(ICONE_LIVRO.aLer, todos.filter((l) => l.estado === "a_ler").length, "A ler", "agora")}
    ${conta(ICONE_LIVRO.lido, todos.filter((l) => l.estado === "lido").length, "Lidos", "concluídos")}
    ${conta(ICONE_LIVRO.depois, todos.filter((l) => l.estado === "recomendado").length, "Quero ler", "mais tarde")}
  </div>`;

  $("#generos-livros").innerHTML = GENEROS.map(
    ([emoji, nome]) => `<button class="ficha-genero" data-genero="${esc(nome)}"
      aria-current="${generoEscolhido === nome}"><i class="emoji">${emoji}</i>${esc(nome)}</button>`
  ).join("");

  const lista = todos
    .filter((l) => !generoEscolhido || l.genero === generoEscolhido)
    .filter((l) => !procura || `${l.titulo} ${l.autor} ${l.genero} ${l.resumo}`.toLowerCase().includes(procura))
    .sort((a, b) => b.atualizado_em - a.atualizado_em);

  if (lista.length) {
    $("#lista-livros").innerHTML = lista
      .map(
        (l) => `<button class="livro" data-livro="${esc(l.id)}">
          <span class="rotulo estado-livro" data-estado="${esc(l.estado)}">${esc(
          ESTADOS_LIVRO[l.estado] || l.estado
        )}</span>
          <h4>${esc(l.titulo || "Sem título")}</h4>
          ${l.autor ? `<p>${esc(l.autor)}</p>` : ""}
          ${l.genero ? `<p class="rotulo">${esc(l.genero)}</p>` : ""}
          ${l.resumo ? `<p>${esc(l.resumo.slice(0, 120))}${l.resumo.length > 120 ? "…" : ""}</p>` : ""}
        </button>`
      )
      .join("");
    return;
  }

  // Sem resultados a lista dá lugar ao convite — ou ao aviso de procura vazia.
  const filtrado = procura || generoEscolhido;
  $("#lista-livros").innerHTML = todos.length && filtrado
    ? vazio(
        "Nada encontrado",
        generoEscolhido
          ? `Ainda não tens livros em ${generoEscolhido}.`
          : "Não há livros com esse termo."
      )
    : `<div class="convite-livros">
        <span class="medalha">${ICONE_LIVRO.livros}</span>
        <h3>Ainda não tens livros na biblioteca</h3>
        <p>Adiciona o teu primeiro livro e começa a tua jornada de leitura.</p>
        <button class="btn" data-tom="forte" id="btn-primeiro-livro">Adicionar primeiro livro</button>
        <div class="tres">
          <div>${ICONE_LIVRO.organiza}<b>Organiza</b><span>A tua biblioteca do teu jeito</span></div>
          <div>${ICONE_LIVRO.acompanha}<b>Acompanha</b><span>O teu progresso de leitura</span></div>
          <div>${ICONE_LIVRO.descobre}<b>Descobre</b><span>Novos livros e autores</span></div>
        </div>
      </div>`;
}

$("#generos-livros").addEventListener("click", (e) => {
  const ficha = e.target.closest("[data-genero]");
  if (!ficha) return;
  // Tocar outra vez na mesma ficha limpa o filtro.
  generoEscolhido = generoEscolhido === ficha.dataset.genero ? "" : ficha.dataset.genero;
  desenharLivros();
});

$("#lista-livros").addEventListener("click", (e) => {
  if (e.target.closest("#btn-primeiro-livro")) abrirLivro(null);
});

function abrirLivro(livro) {
  livroAberto = livro || {
    id: id(),
    titulo: "",
    autor: "",
    estado: "a_ler",
    // A ficha de género escolhida entra já preenchida no livro novo.
    genero: generoEscolhido || "",
    resumo: "",
    criado_em: Date.now(),
    apagado: false,
  };
  $("#livro-rotulo").textContent = livro ? "Editar livro" : "Novo livro";
  $("#livro-titulo").value = livroAberto.titulo;
  $("#livro-autor").value = livroAberto.autor;
  $("#livro-genero").value = livroAberto.genero || "";
  $("#livro-resumo").value = livroAberto.resumo;
  $("#livro-apagar").style.display = livro ? "" : "none";
  marcarEstadoLivro(livroAberto.estado);
  $("#folha-livro").showModal();
}

function marcarEstadoLivro(valor) {
  livroAberto.estado = valor;
  document
    .querySelectorAll("[data-livro-estado]")
    .forEach((b) => b.setAttribute("aria-current", b.dataset.livroEstado === valor ? "true" : "false"));
}

document
  .querySelectorAll("[data-livro-estado]")
  .forEach((b) => b.addEventListener("click", () => marcarEstadoLivro(b.dataset.livroEstado)));

$("#btn-livro-novo").addEventListener("click", () => abrirLivro(null));
$("#procura-livros").addEventListener("input", desenharLivros);

$("#lista-livros").addEventListener("click", (e) => {
  const alvo = e.target.closest("[data-livro]");
  if (alvo) abrirLivro(estado.biblioteca.livros[alvo.dataset.livro]);
});


$("#livro-cancelar").addEventListener("click", () => $("#folha-livro").close());

$("#livro-guardar").addEventListener("click", () => {
  livroAberto.titulo = $("#livro-titulo").value.trim();
  livroAberto.autor = $("#livro-autor").value.trim();
  livroAberto.genero = $("#livro-genero").value.trim();
  livroAberto.resumo = $("#livro-resumo").value;
  if (!livroAberto.titulo) return;
  alterar("livros", livroAberto);
  $("#folha-livro").close();
  desenharLivros();
});

$("#livro-apagar").addEventListener("click", () => {
  livroAberto.apagado = true;
  alterar("livros", livroAberto);
  $("#folha-livro").close();
  desenharLivros();
});

/* ----------------------------------------------------------------- tema --- */

/** "sistema" é a ausência do atributo: assim o @media volta a mandar. */
function aplicarTema(tema) {
  if (tema === "sistema") delete document.documentElement.dataset.tema;
  else document.documentElement.dataset.tema = tema;
  localStorage.setItem("venera:tema", tema);

  // A barra do Safari segue o fundo real, seja ele qual for.
  const fundo = getComputedStyle(document.documentElement).getPropertyValue("--tinta").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", fundo);

  document
    .querySelectorAll("[data-tema-opcao]")
    .forEach((b) => b.setAttribute("aria-current", b.dataset.temaOpcao === tema ? "true" : "false"));
}

document.querySelectorAll("[data-tema-opcao]").forEach((b) =>
  b.addEventListener("click", () => aplicarTema(b.dataset.temaOpcao))
);

aplicarTema(localStorage.getItem("venera:tema") || "sistema");

/* ------------------------------------------------------------ definições --- */

const avisoDef = (texto) => ($("#def-aviso").textContent = texto);

/** A cópia leva os apagados de propósito: senão restaurar ressuscitava-os. */
const copiaDeSeguranca = () => ({
  formato: "venera/1",
  exportado_em: new Date().toISOString(),
  notas: Object.values(estado.biblioteca.notas),
  cartoes: Object.values(estado.biblioteca.cartoes),
  livros: Object.values(estado.biblioteca.livros || {}),
  areas: Object.values(estado.biblioteca.areas || {}),
});

/**
 * No iPhone é a partilha que abre o "Guardar em Ficheiros"; o download só
 * funciona bem no computador. Tenta a partilha e cai para o download.
 */
async function entregarFicheiro(nome, texto, tipo) {
  const ficheiro = new File([texto], nome, { type: tipo });
  if (navigator.canShare?.({ files: [ficheiro] })) {
    try {
      await navigator.share({ files: [ficheiro], title: nome });
      return "guardado";
    } catch (erro) {
      if (erro.name === "AbortError") return "cancelado";
    }
  }
  const url = URL.createObjectURL(ficheiro);
  const ligacao = document.createElement("a");
  ligacao.href = url;
  ligacao.download = nome;
  ligacao.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "descarregado";
}

const carimbo = () => new Date().toISOString().slice(0, 10);

async function exportarJson() {
  const r = await entregarFicheiro(
    `venera-${carimbo()}.json`,
    JSON.stringify(copiaDeSeguranca(), null, 2),
    "application/json"
  );
  if (r !== "cancelado") localStorage.setItem("venera:ultima-copia", Date.now());
  desenharDefinicoes();
  avisoDef(r === "cancelado" ? "Cópia cancelada." : `Cópia ${r}.`);
}

async function exportarMarkdown() {
  const linhas = [`# Venera — ${carimbo()}`, ""];

  const notas = vivos("notas").sort((a, b) => b.atualizado_em - a.atualizado_em);
  if (notas.length) {
    linhas.push("## Notas", "");
    for (const n of notas) {
      linhas.push(`### ${n.titulo || "Sem título"}`, "");
      if (n.origem?.titulo) linhas.push(`*De: ${n.origem.titulo}*`, "");
      linhas.push(n.texto || "", "");
    }
  }

  const cartoes = vivos("cartoes").sort((a, b) => a.criado_em - b.criado_em);
  if (cartoes.length) {
    linhas.push("## Cartões", "");
    for (const c of cartoes) {
      linhas.push(`- **${c.frente}**`, `  ${c.verso}`, "");
    }
  }

  const r = await entregarFicheiro(`venera-${carimbo()}.md`, linhas.join("\n"), "text/markdown");
  avisoDef(r === "cancelado" ? "Exportação cancelada." : `Ficheiro ${r}.`);
}

async function importar(ficheiro) {
  let dados;
  try {
    dados = JSON.parse(await ficheiro.text());
  } catch {
    return avisoDef("Não consegui ler o ficheiro: não é JSON válido.");
  }
  if (!dados || !TIPOS.some((t) => Array.isArray(dados[t]))) {
    return avisoDef("Isto não parece uma cópia da Venera.");
  }

  let novos = 0;
  let recentes = 0;
  let ignorados = 0;
  for (const tipo of TIPOS) {
    for (const item of dados[tipo] || []) {
      if (!item?.id || typeof item.id !== "string") {
        ignorados++;
        continue;
      }
      const atual = estado.biblioteca[tipo][item.id];
      if (!atual) novos++;
      else if ((item.atualizado_em || 0) > (atual.atualizado_em || 0)) recentes++;
      else {
        ignorados++;
        continue;
      }
      // Não passa por alterar(): esse carimba a hora, e uma cópia antiga
      // passaria a parecer a versão mais recente. Guarda a hora original.
      estado.biblioteca[tipo][item.id] = item;
      estado.sujos.add(`${tipo}:${item.id}`);
    }
  }

  gravarLocal();
  agendarSync();
  desenharDefinicoes();
  avisoDef(`${novos} novos, ${recentes} atualizados, ${ignorados} já estavam em dia.`);
}

async function limparCache() {
  for (const nome of await caches.keys()) await caches.delete(nome);
  const registos = await navigator.serviceWorker?.getRegistrations?.();
  for (const r of registos || []) await r.unregister();
  avisoDef("Cache limpa. Fecha e volta a abrir a app.");
}

function esquecerChave() {
  localStorage.removeItem("venera:chave");
  estado.chave = "";
  irPara("chave");
}

const REALCES = [
  ["latao", "var(--latao)"],
  ["indigo", "var(--indigo)"],
  ["rust", "var(--rust)"],
  ["sobe", "var(--sobe)"],
];

function aplicarRealce(nome) {
  const cor = (REALCES.find(([n]) => n === nome) || REALCES[0])[1];
  document.documentElement.style.setProperty("--realce", cor);
  localStorage.setItem("venera:realce", nome);
  $("#def-cores").innerHTML = REALCES.map(
    ([n, c]) =>
      `<button class="ponto-cor" data-realce="${n}" aria-current="${n === nome}" style="background:${c}" aria-label="${n}"></button>`
  ).join("");
}

function aplicarEscala(valor) {
  document.documentElement.style.setProperty("--escala", valor);
  localStorage.setItem("venera:escala", valor);
  document
    .querySelectorAll("[data-escala]")
    .forEach((b) => b.setAttribute("aria-current", b.dataset.escala === String(valor)));
}

function desenharDefinicoes() {
  const bytes = new Blob([JSON.stringify(estado.biblioteca)]).size;
  const n = (t) => vivos(t).length;

  // Singular e plural conforme a conta: "1 notas" dava má impressão logo ali.
  const conta = (t, um, muitos) => `${n(t)} ${n(t) === 1 ? um : muitos}`;
  $("#def-armazenamento").textContent = [
    `${(bytes / 1024).toFixed(1)} kB`,
    conta("notas", "nota", "notas"),
    conta("cartoes", "cartão", "cartões"),
    conta("livros", "livro", "livros"),
    conta("areas", "área", "áreas"),
  ].join(" · ");

  const ultima = Number(localStorage.getItem("venera:ultima-copia")) || 0;
  $("#def-ultima-copia").textContent = ultima
    ? new Date(ultima).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "nunca";

  const porEnviar = estado.sujos.size;
  $("#def-estado-sync").textContent = porEnviar ? `${porEnviar} por enviar` : "em dia";
  $("#def-estado-sync").style.color = porEnviar ? "var(--desce)" : "var(--sobe)";

  // A versão que interessa é a que está mesmo instalada, não a que eu escrevi.
  fetch("/sw.js", { cache: "no-store" })
    .then((r) => r.text())
    .then((t) => {
      const versao = t.match(/venera-v(\d+)/)?.[1];
      $("#def-versao").textContent = versao ? `Versão ${VERSAO_APP} · casca v${versao}` : `Versão ${VERSAO_APP}`;
    })
    .catch(() => ($("#def-versao").textContent = `Versão ${VERSAO_APP}`));
}

const VERSAO_APP = "1.1.0";

document.addEventListener("click", (e) => {
  const cor = e.target.closest("[data-realce]");
  if (cor) aplicarRealce(cor.dataset.realce);
  const escala = e.target.closest("[data-escala]");
  if (escala) aplicarEscala(escala.dataset.escala);
});

aplicarRealce(localStorage.getItem("venera:realce") || "latao");
aplicarEscala(localStorage.getItem("venera:escala") || "1");

$("#def-exportar").addEventListener("click", exportarJson);
$("#def-markdown").addEventListener("click", exportarMarkdown);
$("#def-importar").addEventListener("click", () => $("#def-ficheiro").click());
$("#def-ficheiro").addEventListener("change", (e) => {
  const ficheiro = e.target.files?.[0];
  if (ficheiro) importar(ficheiro);
  e.target.value = "";
});
$("#def-sincronizar").addEventListener("click", async () => {
  await sincronizar();
  desenharDefinicoes();
});
$("#def-cache").addEventListener("click", limparCache);
$("#def-esquecer").addEventListener("click", esquecerChave);

/* --------------------------------------------------------------- arranque --- */

async function ligar() {
  const chave = $("#campo-chave").value.trim();
  if (!chave) return ($("#aviso-chave").textContent = "Cola a chave para continuar.");
  $("#btn-chave").disabled = true;
  $("#aviso-chave").textContent = "";
  try {
    const r = await fetch("/api/chave", { headers: { Authorization: `Bearer ${chave}` } });
    if (!r.ok) throw new Error();
    estado.chave = chave;
    localStorage.setItem("venera:chave", chave);
    $("#campo-chave").value = "";
    irPara("noticias");
    sincronizar();
  } catch {
    $("#aviso-chave").textContent = "Chave recusada. Confirma que copiaste a chave da app, não a das rotinas.";
  } finally {
    $("#btn-chave").disabled = false;
  }
}

contarRevisao();
if (estado.chave) {
  irPara("noticias");
  sincronizar();
} else {
  irPara("chave");
  marcarEstado("por ligar", "parado");
}

if ("serviceWorker" in navigator) {
  /**
   * Quando sai uma versão nova, o service worker antigo ainda serve a página
   * que já está aberta — daí a app parecer que não mudou até se abrir a
   * segunda vez. Assim que o novo assume, recarrega-se uma vez e acabou-se.
   */
  let recarregado = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (recarregado) return;
    recarregado = true;
    location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registo = await navigator.serviceWorker.register("/sw.js");
      // O iPhone só procura versões novas de vez em quando; forçamos à entrada.
      registo.update();
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) registo.update();
      });
    } catch {
      /* sem service worker, a app funciona à mesma, só não fica offline */
    }
  });
}
