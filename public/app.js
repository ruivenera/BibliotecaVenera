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
};
let NOMES = {
  "financas-geopolitica": "Finanças & Geopolítica",
  "inteligencia-artificial": "Inteligência Artificial",
};

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
    desenharEstante(estanteDados.lombadas.filter((l) => l.rotina === rotina), modulo);
    desenharDossies(feed.edicoes.filter((e) => e.rotina === rotina), rotina, modulo);
    if (modulo === "aprendizagem") {
      estado.edicaoCurso = feed.edicoes.find((e) => e.rotina === rotina) || null;
      const quando = estado.edicaoCurso?.data || estanteDados.lombadas.find((l) => l.rotina === rotina)?.data;
      $("#data-aprendizagem").textContent = quando ? porExtensoComDia(quando) : "sem aula publicada";
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

const avaliacoes = () => guardado("venera:avaliacoes", {});

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

  const nota = avaliacoes()[chaveItem(item)];

  $("#artigo-corpo").innerHTML = `
    <p class="etiqueta">
      <span class="selo">${esc(item.rubrica || "Tema")}</span>
      <span class="quando">· ${esc(haQuanto(item, edicao))}</span>
    </p>
    <h1>${esc(item.titulo)}</h1>
    <p class="entrada">${esc(entrada)}</p>

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
      .join("")}</div>

    <div class="avaliar">
      <span>Como avalias este tema?</span>
      <span class="botoes">
        <button class="btn" data-avaliar="util" aria-current="${nota === "util"}">Útil</button>
        <button class="btn" data-avaliar="nao" aria-current="${nota === "nao"}">Não útil</button>
      </span>
    </div>`;

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

$("#artigo-corpo").addEventListener("click", (e) => {
  const avaliar = e.target.closest("[data-avaliar]");
  if (!avaliar) return;
  const item = estado.edicaoNoticias?.itens[estado.artigoIndice];
  const guardadas = avaliacoes();
  const chave = chaveItem(item);
  guardadas[chave] = guardadas[chave] === avaliar.dataset.avaliar ? undefined : avaliar.dataset.avaliar;
  localStorage.setItem("venera:avaliacoes", JSON.stringify(guardadas));
  abrirArtigo(estado.artigoIndice);
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

function bandeiraDe(...textos) {
  const alvo = textos.filter(Boolean).join(" ");
  if (!alvo) return "";
  for (const [iso, padrao] of PAISES) if (padrao.test(alvo)) return emojiBandeira(iso);
  return "";
}

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

function linhaNoticia(item, i, cor) {
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
      <span class="meta">${esc(item.rubrica || "Tema")} <em data-nivel="${esc(item.impacto)}">${esc(item.impacto)}</em></span>
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

  const blocoIndices = () =>
    painel.indices
      ? `<div class="indices">${painel.indices
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

  const semGeoAqui = "Esta edição não trouxe temas geopolíticos.";
  const cartaoGeo = ({ item, i }) => `<button class="cartao-geo" data-item-noticia="${i}" style="--marcador:${cor}">
      ${
        item.imagem
          ? `<span class="faixa-geo com-foto"><img src="${esc(item.imagem.url)}" alt="" loading="lazy" decoding="async"></span><i class="credito-foto">${esc(item.imagem.credito)}</i>`
          : bandeiraDe(item.titulo, item.rubrica)
            ? `<span class="faixa-geo com-bandeira"><b class="bandeira">${bandeiraDe(item.titulo, item.rubrica)}</b></span>`
            : `<span class="faixa-geo">${esc(SIGLA(item.rubrica || item.titulo))}</span>`
      }
      <span class="dentro">
        <span class="selo" style="color:${cor};align-self:flex-start">${esc(item.rubrica || "Tema")}</span>
        <h3>${esc(item.titulo)}</h3>
        <span class="pe">
          <span class="rotulo">${esc(haQuanto(item, edicao))}</span>
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

  const cabecalho = (titulo, icone = "") =>
    `<div class="cabecalho-lista">
      <span class="rotulo">${icone}${titulo}</span>
      <button class="ver-mais" data-abrir-edicao>Ver tudo ›</button>
    </div>`;

  const GLOBO = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/></svg>`;

  const blocoRisco = () =>
    geo.risco && tem(geo.risco.indice)
      ? `<div class="grupo" style="padding:1rem">
          <div class="medidor">
            <span class="valor">${geo.risco.indice}</span>
            <span class="de">/ 100${geo.risco.nivel ? ` · ${esc(geo.risco.nivel)}` : ""}</span>
          </div>
          <div class="medidor-barra" data-alto="${geo.risco.indice >= 61 ? 1 : 0}"><i style="width:${geo.risco.indice}%"></i></div>
        </div>`
      : "";

  const blocoAlertas = () =>
    geo.alertas
      ? `<div class="cabecalho-lista"><span class="rotulo">Do dia</span></div>
         <div class="grupo" style="padding:0.4rem 1rem">
           <ul class="alertas">${geo.alertas
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
    geral: () =>
      blocoIndices() +
      cabecalho("Destaques de investimentos") +
      lista(mercado, semMercado) +
      cabecalho("Geopolítica", GLOBO) +
      carrossel(geopoliticos),
    mercado: () => blocoIndices() + cabecalho("Investimentos") + lista(mercado, semMercado),
    geo: () => blocoRisco() + blocoAlertas() + cabecalho("Geopolítica", GLOBO) + lista(geopoliticos, semGeo),
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

document.querySelectorAll("[data-meia]").forEach((b) =>
  b.addEventListener("click", () => {
    estado.meiaNoticias = b.dataset.meia;
    document
      .querySelectorAll("[data-meia]")
      .forEach((o) => o.setAttribute("aria-selected", o.dataset.meia === b.dataset.meia));
    desenharNoticias();
  })
);

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
    alvo.innerHTML = `<div class="resumo-dia" style="--marcador:${cor}">
      <span class="rotulo dia">${esc(porExtensoComDia(edicao.data))}</span>
      <h3>${esc(edicao.titulo)}</h3>
      <p>${esc(edicao.resumo)}</p>
      <div class="rodape-cartao">
        <span class="rotulo">${edicao.itens.length} temas</span>
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

function desenharNotas() {
  const procura = $("#procura").value.trim().toLowerCase();
  const lista = vivos("notas")
    .filter((n) => !procura || `${n.titulo} ${n.texto}`.toLowerCase().includes(procura))
    .sort((a, b) => b.atualizado_em - a.atualizado_em);

  $("#lista-notas").innerHTML = lista.length
    ? lista
        .map(
          (n) => `<article class="nota" data-nota="${esc(n.id)}">
            <h4>${esc(n.titulo || "Sem título")}</h4>
            <p>${esc(n.texto)}</p>
            <span class="linha-meta rotulo">${
              n.origem ? esc(NOMES[n.origem.rotina] || n.origem.rotina) + " · " + esc(dataCurta(n.origem.data)) : "nota solta"
            }</span>
          </article>`
        )
        .join("")
    : procura
    ? vazio("Nada encontrado", "Nenhuma nota tem essas palavras.")
    : vazio("Ainda não há notas", "Abre uma edição e guarda o que interessa — ou escreve uma nota solta.");
}

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
  $("#folha-aviso").textContent = "";
  $("#folha-apagar").hidden = !modo.endsWith("editar");
  $("#folha-para-cartao").hidden = modo !== "nota-editar";
  folha.showModal();
  $("#folha-frente").focus();
}

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
    alterar("notas", { ...item, titulo: frente, texto: verso });
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
    return abrirFolha("nota-editar", { id: n.id, frente: n.titulo, verso: n.texto, origem: n.origem });
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

function desenharQuote() {
  const inicio = Date.UTC(new Date().getUTCFullYear(), 0, 1);
  const dia = Math.floor((Date.now() - inicio) / DIA);
  const [texto, fonte] = QUOTES[dia % QUOTES.length];
  $("#quote").innerHTML = `<blockquote>“${esc(texto)}”</blockquote>
    <figcaption>${esc(fonte)}</figcaption>`;
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

function desenharAprendizagem() {
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
    `<div class="mosaico">${anel(geral)}<span class="et" style="margin-top:0.3rem">Progresso geral</span></div>`,
    mosaico(`<svg viewBox="0 0 24 24"><path d="M12 2c1 4-2 5-2 8a4 4 0 0 0 8 0c0-1-.4-2-1-3 2 2 3 4 3 6a8 8 0 0 1-16 0c0-5 5-7 8-11z"/></svg>`, sequenciaDeDias(), "Dias seguidos"),
    mosaico(`<svg viewBox="0 0 24 24"><path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/></svg>`, temasFeitos + cartoesSabidos, "Conceitos sabidos"),
  ].join("");

  $("#aprender-curso").innerHTML = curso
    ? `<button class="cartao-curso" data-abrir-curso>
        <span class="rotulo" style="color:var(--indigo)">${esc(NOMES["inteligencia-artificial"])}</span>
        <h3>${esc(curso.titulo)}</h3>
        <span class="selos">${desenharProgresso(curso.progresso) || `<span class="selo">${curso.itens.length} capítulos</span>`}</span>
      </button>`
    : `<div class="grupo"><p class="linha"><span class="texto"><span>A aula de hoje ainda não foi publicada.</span></span></p></div>`;

  $("#aprender-areas").innerHTML = areas.length
    ? `<div class="grupo">${areas
        .map((a) => {
          const pct = progressoArea(a);
          return `<button class="area" data-area="${esc(a.id)}" style="--ponto:${CORES_AREA[a.cor]}">
            <span class="bloco-area">${esc(a.sigla || SIGLA(a.nome))}</span>
            <span class="corpo">
              <h4>${esc(a.nome)}</h4>
              <span class="rotulo">${a.temas.length} temas · ${pct}%</span>
              <span class="barra-progresso" style="margin-top:0.4rem"><i style="width:${pct}%"></i></span>
            </span>
          </button>`;
        })
        .join("")}</div>`
    : vazio(
        "Ainda sem áreas",
        "Cria a primeira: Francês, História, o que quiseres seguir a par do curso de IA."
      );
}

let areaAberta = null;

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
  $("#area-rotulo").textContent = area ? "Editar área" : "Nova área";
  $("#area-nome").value = areaAberta.nome;
  $("#area-sigla").value = areaAberta.sigla;
  $("#area-temas").value = areaAberta.temas.map((t) => (t.feito ? "x " : "") + t.nome).join("\n");
  $("#area-apagar").style.display = area ? "" : "none";
  marcarCorArea(areaAberta.cor);
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
  $("#folha-area").close();
  desenharAprendizagem();
});

$("#area-apagar").addEventListener("click", () => {
  areaAberta.apagado = true;
  alterar("areas", areaAberta);
  $("#folha-area").close();
  desenharAprendizagem();
});

$("#aprender-areas").addEventListener("click", (e) => {
  const alvo = e.target.closest("[data-area]");
  if (alvo) abrirArea(estado.biblioteca.areas[alvo.dataset.area]);
});

$("#aprender-curso").addEventListener("click", () => {
  const c = estado.edicaoCurso;
  if (c) irPara("edicao", c.rotina, c.data);
});

document.querySelector('[data-ir="aprendizagem-arquivo"]').addEventListener("click", () => {
  const arquivo = $("#aprender-arquivo");
  arquivo.hidden = !arquivo.hidden;
});

/* ---------------------------------------------------------------- livros --- */

const ESTADOS_LIVRO = { a_ler: "A ler", lido: "Lido", recomendado: "Recomendado" };

let livroAberto = null;

function desenharLivros() {
  const procura = $("#procura-livros").value.trim().toLowerCase();
  const lista = vivos("livros")
    .filter((l) => !procura || `${l.titulo} ${l.autor} ${l.resumo}`.toLowerCase().includes(procura))
    .sort((a, b) => b.atualizado_em - a.atualizado_em);

  $("#lista-livros").innerHTML =
    lista
      .map(
        (l) => `<button class="livro" data-livro="${esc(l.id)}">
          <span class="rotulo estado-livro" data-estado="${esc(l.estado)}">${esc(
          ESTADOS_LIVRO[l.estado] || l.estado
        )}</span>
          <h4>${esc(l.titulo || "Sem título")}</h4>
          ${l.autor ? `<p>${esc(l.autor)}</p>` : ""}
          ${l.resumo ? `<p>${esc(l.resumo.slice(0, 120))}${l.resumo.length > 120 ? "…" : ""}</p>` : ""}
        </button>`
      )
      .join("") ||
    vazio(
      procura ? "Nada encontrado" : "Ainda sem livros",
      procura
        ? "Não há livros com esse termo."
        : "Acrescenta o primeiro: título, autor e o que quiseres guardar da leitura."
    );
}

function abrirLivro(livro) {
  livroAberto = livro || {
    id: id(),
    titulo: "",
    autor: "",
    estado: "a_ler",
    resumo: "",
    criado_em: Date.now(),
    apagado: false,
  };
  $("#livro-rotulo").textContent = livro ? "Editar livro" : "Novo livro";
  $("#livro-titulo").value = livroAberto.titulo;
  $("#livro-autor").value = livroAberto.autor;
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

  $("#def-armazenamento").textContent =
    `${(bytes / 1024).toFixed(1)} kB · ${n("notas")} notas, ${n("cartoes")} cartões, ${n("livros")} livros`;

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
