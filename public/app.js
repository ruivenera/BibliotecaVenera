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
  focoGeo: "", // país escolhido no mapa da geopolítica
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
 * O mapa é desenhado aqui dentro, sem biblioteca nem tiles: uma máscara de terra
 * de 360×144 células — um grau de lado, dos 84°N aos 60°S — empacotada em bits e
 * metida em base64. São 8 KB de fonte que dão 15 483 células de terra, pintadas
 * num canvas e esticadas com suavização. Continua a abrir sem rede.
 */
const MAPA_COLS = 360;
const MAPA_ROWS = 144;
const MAPA_LAT_TOPO = 84;
const MAPA_TERRA = "AAAAAAAAAAAAAAAAAAAAAAAB/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//8AFb///wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA///+x/////76fAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/gD/p////////AAAAAAAAAACxBwAAAAHgAAAAAAAAAAAAAAAAAAAAAAAAAAA///uAf//////+AAAABrvwAAAAAAAAAAH8AAAAAAAAAAAAAAAAAAAAAAAAeHznn/h////////4AAAABXsAAAAAAAAAAAAD4AAAAAAAAAAAAAAAAAAAAAAEcIA5MfAI///////8AAAAAPFAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAABoCGc8X/AH///////4AAAAAAAAAAAAAB4AAAAB9+AAAAAAAAAAAAAAAAAAAAAD/wMzz8AAAP/////2AAAAAAAAAAAAD4AAAA////AAAB/oAAAAAAAAAAAAAACAwACAcAAAAP/////+AAAAAAAAAAAAMAAAAX///6AAAAAAAAAAAAAAAAAAAAP+Ac8+M/gAAD////+8AAAAAAAAAAAA4AAAH///+O+HAAHAAAAAAAAAAAAAAAf/+4/Y/94AAD////+wAAAAAAAAAAABwAHhH///////8AHwAAAAAwAAAAAAAAON/8E4//9AADf////gAAAAAAAAAAABwAPZ+///////4nv/gAAAAAAAH8gAAAAAP+A8f//8AA3///ogAAAAAABtgAAAAAfv/////////////8AAAAAB///+B/2H/+DnDxf8AAz////AAAAAAA//wAAAA8Pv//////////////9H8wAP////////QsDPzwD8AAf///wAAAAAAG///wIBe/3+/////////////////+AD////////+//fz4Y/wA7//4AAAAAAAD///+I////v//////////////////4EP///////////5gD/8A///gAAAAAAAf//5+P///8//////////////////7w/////////////qAD+QAP/wABr8AAAAf8f+D///////////////////////AwAf///////////zwx/AAP/wAAP8AAAB/4/+f//////////////////////4AMAf//////////+DBAbwAH/AAADAAAAN/j/////////////////////////+AAH///////////4AwgHQAD/AAAAAAAAf/H///////////////////////n/6AAP///////////wAA/AAAB+AAAAAAAB/+H//////////////////////jP+AAAH/9z////////gAA/wAAAMAAAAAACB//D7////////////////////+A/YAAAA/xAD///////gAA/wQAAAAAAAAAAB9/Ab///////////////////+ODgAAAAAB0AAX//////4AA/94AAAAAAAAAYA5+C///////////////////4AAHQAAAAABcAAP//////8AAf/+AAAAAAAAB8AA+i///////////////////wAAfgAAAAAMAAAC///////wAf/+AAAAAAAAAYAOeH///////////////////AAA/gAAAABQAAADf//////8Af//AAAAAAAAAcAPQH//////////////////8AAA/AAAAAEAAAAAP///////z///4AAAAAAADuAEDv//////////////////+AAA+AAAAAAAAAABP///////x///8AAAAAAAPHAf/////////////////////4AA8AAAAAAAAAAAn///////x///8AAAAAAAPPx//////////////////////6AA4AAAAAAAAAAAD///////////6AAAAAAAAPH//////////////////////6AAwAAAAAAAAAAAC///////////kAAAAAAAAQP//////////////////////zAAAAAAAAAAAAAABv////////+MMAAAAAAAAC///////////////////////7AAAAAAAAAAAAAAAL////////7wPgAAAAAAAf///////////////////////yAAAAAAAAAAAAAAAP/////////gCgAAAAAAAD///////////////////////iAAAAAAAAAAAAAAAP/////////pAAAAAAAAAD/////vP////////////////BAAAAAAAAAAAAAAAP/////////+AAAAAAAAAB//v//GP///////////////+AAAAAAAAAAAAAAAAP////////8wAAAAAAAAAB//P/+EP///////////////8CAAAAAAAAAAAAAAAP////////wgAAAAAAAADj/jz/+AD///////////////4HgAAAAAAAAAAAAAAP////////gAAAAAAAAAH/4Fw/4AA//////////////+ACAAAAAAAAAAAAAAAP////////gAAAAAAAAAH/wAcP8PA//////////////8AAAAAAAAAAAAAAAAAP///////8AAAAAAAAAAH/gMHfV///////////////v4AMAAAAAAAAAAAAAAAP///////8AAAAAAAAAAH/IMCOH//////////////+ZwAMAAAAAAAAAAAAAAAH///////oAAAAAAAQAAH/AACGP//////////////8BwAMAAAAAAAAAAAAAAAH///////wAAAAAAAAAAH+AAYDH//////////////+g4AYAAAAAAAAAAAAAAAD///////wAAAAAAAAAAAgf+AABs//////////////g4D4AAAAAAAAAAAAAAAB///////wAAAAAAAAAAAh/+AAAA//////////////A4fwAAAAAAAAAAAAAAAB///////gAAAAAAAAAAB//8AAAA//////////////Ah2AAAAAAAAAAAAAAAAAP/////+AAAAAAAAAAAD//+AAAB//////////////gjwAAAAAAAAAAAAAAAAAH/////4AAAAAAAAAAQH///4GAB//////////////gBAAAAAAAAAAAAAAAAAAG/////4AAAAAAAAAAAP///8PwD//////////////gCAAAAAAAAAAAAAAAAAACf////4AAAAAAAAAAAP////v////////////////gAAAAAAAAAAAAAAAAAAABv//xAYAAAAAAAAAAAP//////3//H///////////gAAAAAAAAAAAAAAAAAAAAv//AAYAAAAAAAAAAAf/////////H///////////wAAAAAAAAAAAAAAAAAAAB3/+AAcAAAAAAAAAAB///////8//h///////////gAAAAAAAAAAAAAAAAAAAAZ/+AAMAAAAAAAAAAD///////8//wH//////////AAAAAAAAAAAAAAAAAAAAAJ/+AAEAAAAAAAAAAH///////+f/wB/f////////AAAAAAAAAAAAAAAAAAAAAI/8AAAAAAAAAAAAAH///////+f/44Af///////8QAAAAAAAAAAAAAAAAAAAACf8AAAAAAAAAAAAAP///////+H//+AP///////4gAAAAAAAAAAAAAAAAAAAAAP8AAvAAAAAAAAAAP////////H///AD///////ggAAAAAAAAAAAAAAAAAAAAAH8AQBggAAAAAAAAf////////n//+ADf/4P//YAAAAAAAAAAAAAAAAAAAAAAAH+A4AYAAAAAAAAAP////////j//+AAf/4H/+IAAAAAAAAAAAAAAAgAAAAAAAH/B4ABwAAAAAAAAP////////h//8AAf/gD/8YAAAAAAAAAAAAAAAAAAAAAAAD/lwAD8AAAAAAAAP////////x//4AAf/AD/8QAAAAAAAAAAAAAAAAAAAAAAAAf/wAAAAAAAAAAAP////////4//gAAf+AB/+AAwAAAAAAAAAAAAAAAAAAAAAAH/wAAAAAAAAAAAP////////4f+AAAf8AD//AAwAAAAAAAAAAAAAAAAAAAAAAAH/AAAAAAAAAAAf////////8/8AAAPwAAP/gAgAAAAAAAAAAAAAAAAAAAAAAAD/gAAAAAAAAAAf////////+fgAAAPwAAP/gAwAAAAAAAAAAAAAAAAAAAAAAAA/AAAAAAAAAAAf/////////eAAAAHwAAP/gAsAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAAAAAAAf/////////gBAAAHwAAM/gAKAAAAAAAAAAAAAAAAAAAAAAAADABIAAAAAAAAH/////////gIAAADwAAEfgALAAAAAAAAAAAAAAAAAAAAAAAADgPfIAAAAAAAH/////////34AAADwAAIPABIAAAAAAAAAAAAAAAAAAAAAAAAAyPf+AAAAAAAD//////////4AAADoAAIEACBAAAAAAAAAAAAAAAAAAAAAAAAA8///AAAAAAAB//////////wAAABIAAMAAEHAAAAAAAAAAAAAAAAAAAAAAAAAE///gAAAAAAB//////////wAAAAMAAEAAADgIAAAAAAAAAAAAAAAAAAAAAAAAf//wAAAAAAAf/////////gAAAAMAADAAMDAAAAAAAAAAAAAAAAAAAAAAAAAA////gAAAAAAP/B///////gAAAAAABDgAeAAAAAAAAAAAAAAAAAAAAAAAAAAAf///wAAAAAACAA3//////AAAAAAAAxgA+AAAAAAAAAAAAAAAAAAAAAAAAAAAf///4AAAAAAAAAD/////+AAAAAAAAZgB8BAAAAAAAAAAAAAAAAAAAAAAAAAB////4AAAAAAAAAD/////8AAAAAAAAMwH8AIAAAAAAAAAAAAAAAAAAAAAAAAB////8AAAAAAAAAD/////wAAAAAAAAHQf8AIAAAAAAAAAAAAAAAAAAAAAAAAD////4AAAAAAAAAH/////gAAAAAAAAHgf8cIAAAAAAAAAAAAAAAAAAAAAAAAD/////AAAAAAAAAH/////AAAAAAAAAD4f8ASgAAAAAAAAAAAAAAAAAAAAAAAH////+4AAAAAAAAH/////AAAAAAAAABwP50QwAAAAAAAAAAAAAAAAAAAAAAAH/////+AAAAAAAAD////+AAAAAAAAAB8P5wAL4AgAAAAAAAAAAAAAAAAAAAAD//////4AAAAAAAB////8AAAAAAAAAA8AxQif/AAAAAAAAAAAAAAAAAAAAAAH//////8AAAAAAAA////4AAAAAAAAAAcAAQAD/gAAAAAAAAAAAAAAAAAAAAAH///////gAAAAAAA////4AAAAAAAAAAMABAAI/ywAAAAAAAAAAAAAAAAAAAAD///////gAAAAAAA////4AAAAAAAAAADgAAAIf8BAAAAAAAAAAAAAAAAAAAAD///////gAAAAAAAf///4AAAAAAAAAAB+AABA/4AAAAAAAAAAAAAAAAAAAAAB///////gAAAAAAAf///4AAAAAAAAAAAAfsgAOMAAAAAAAAAAAAAAAAAAAAAA///////AAAAAAAAf///8AAAAAAAAAAAABCAAAGgAAAAAAAAAAAAAAAAAAAAA///////AAAAAAAAP///+AAAAAAAAAAAAAAAAAAgBAAAAAAAAAAAAAAAAAAAAf/////+AAAAAAAAP///8AAAAAAAAAAAAAACgCAEAAAAAAAAAAAAAAAAAAAAAf/////8AAAAAAAAf///8AQAAAAAAAAAAAAB+CAAAAAAAQAAAAAAAAAAAAAAAP/////4AAAAAAAAf///+AQAAAAAAAAAAAAD8DAAAAAAAAAAAAAAAAAAAAAAAP/////4AAAAAAAA////+AwAAAAAAAAAAAA38DgAAAAAAAAAAAAAAAAAAAAAAH/////4AAAAAAAA////+BwAAAAAAAAAAAD/8HgAAAAAAAAAAAAAAAAAAAAAAB/////4AAAAAAAA////8PwAAAAAAAAAAAH//XgAABABAAAAAgAAAAAAAAAAAAf////4AAAAAAAA////wPgAAAAAAAAAAAP//3wAAAAAAAAAAAAAAAAAAAAAAAP////wAAAAAAAA////gPgAAAAAAAAAAAP///wAAAAAAAAAAAAAAAAAAAAAAAP////wAAAAAAAAf//+APgAAAAAAAAAAAf///8AAAAAAAAAAAAAAAAAAAAAAAP////wAAAAAAAAf//+APgEAAAAAAAAAD////+AAIAAAAAAAAAIAAAAAAAAAAP////gAAAAAAAAP//+AfAAAAAAAAAAAf////+AAEAAAAAAAAAAAAAAAAAAAAP////AAAAAAAAAP///AfAAAAAAAAAAA//////AAAAAAAAAAAAAAAAAAAAAAAP///4AAAAAAAAAP//+APAAAAAAAAAAA//////gAAAAAAAAAAAAAAAAAAAAAAf///gAAAAAAAAAH//+AOAAAAAAAAAAB//////wAAAAAAAAAAAAAAAAAAAAAAf//+AAAAAAAAAAH//4AEAAAAAAAAAAA//////4AAAAAAAAAAAAAAAAAAAAAAf//+AAAAAAAAAAH//4AAAAAAAAAAAAB//////4AAAAAAAAAAAAAAAAAAAAAAf///AAAAAAAAAAH//4AAAAAAAAAAAAA//////8AAAAAAAAAAAAAAAAAAAAAAf//+AAAAAAAAAAD//wAAAAAAAAAAAAAf/////8AAAAAAAAAAAAAAAAAAAAAAf//8AAAAAAAAAAB//gAAAAAAAAAAAAAf/////4AAAAAAAAAAAAAAAAAAAAAA///8AAAAAAAAAAB//gAAAAAAAAAAAAAf/////4AAAAAAAAAAAAAAAAAAAAAA///wAAAAAAAAAAA//AAAAAAAAAAAAAAP/////4AAAAAAAAAAAAAAAAAAAAAAf//wAAAAAAAAAAA/+AAAAAAAAAAAAAAP/AP//wAAAAAAAAAAAAAAAAAAAAAA//vgAAAAAAAAAAA/4AAAAAAAAAAAAAAP8AG//gAAAAAAAAAAAAAAAAAAAAAA//3AAAAAAAAAAAAQAAAAAAAAAAAAAAAOAAF//gAAAAAAAAAAAAAAAAAAAAAB//4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//AAABAAAAAAAAAAAAAAAAAAB//4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/AAAAgAAAAAAAAAAAAAAAAAD//4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/AAAAQAAAAAAAAAAAAAAAAAD//wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABYAAAAcAAAAAAAAAAAAAAAAAB/8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAD/8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAD/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAAADQAAAAAAAAAAAAAAAAAD/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAAAHAAAAAAAAAAAAAAAAAAB/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAOAAAAAAAAAAAAAAAAAAF/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAH+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAAAAAH+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4AwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/AAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** Projeção equirretangular: longitude para x, latitude para y. */
const projX = (lon) => lon + 180;
const projY = (lat) => MAPA_LAT_TOPO - lat;

/* Cores tiradas de uma fotografia de globo: oceano azul-forte, plataforma
   continental mais clara, verde de floresta, castanho-areia no deserto, branco
   no gelo. */
const CORES_MAPA = {
  oceano: [37, 92, 158],
  plataforma: [66, 129, 190],
  verde: [76, 116, 58],
  tropico: [48, 92, 42],
  deserto: [198, 165, 108],
  tundra: [110, 124, 84],
  gelo: [238, 243, 246],
};

const DESERTOS = [
  [15, 32, -17, 35],    // Sara
  [13, 32, 35, 60],     // Península Arábica
  [24, 38, 55, 78],     // Irão, Thar
  [36, 48, 75, 112],    // Gobi, Taklamakan
  [36, 46, 50, 72],     // Karakum, Kyzylkum
  [3, 15, 38, 52],      // Corno de África
  [-32, -19, 116, 146], // interior australiano
  [-30, -17, 11, 27],   // Namibe, Kalahari
  [-30, -16, -72, -64], // Atacama e altiplano
  [24, 38, -118, -99],  // sudoeste norte-americano
];
const TROPICOS = [
  [-13, 7, -79, -47],  // Amazónia
  [-7, 8, 8, 32],      // bacia do Congo
  [-11, 15, 94, 142],  // sudeste asiático e Indonésia
  [-4, 11, -85, -74],  // Chocó
  [-22, -8, 30, 41],   // Zambeze
];

/* Caixas com bordo esbatido. Com fronteiras rígidas via-se o retângulo do Sara
   desenhado a esquadro no meio de África; com margem de seis graus, o deserto
   entra no verde como entra na realidade. */
const suave = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function pesoCaixa(lat, lon, [la0, la1, lo0, lo1], margem = 7) {
  const dLat = Math.min(lat - la0, la1 - lat);
  const dLon = Math.min(lon - lo0, lo1 - lon);
  return suave((Math.min(dLat, dLon) + margem) / (2 * margem));
}

const pesoMaximo = (lat, lon, caixas) =>
  caixas.reduce((m, caixa) => Math.max(m, pesoCaixa(lat, lon, caixa)), 0);

const misturar = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** A cor de cada célula de terra, já com as transições feitas. */
function corTerra(lat, lon) {
  let cor = CORES_MAPA.verde;
  cor = misturar(cor, CORES_MAPA.tropico, pesoMaximo(lat, lon, TROPICOS));
  cor = misturar(cor, CORES_MAPA.deserto, pesoMaximo(lat, lon, DESERTOS));
  // O frio entra devagar entre os 54° e os 68°, e o gelo a partir daí.
  cor = misturar(cor, CORES_MAPA.tundra, suave((lat - 54) / 14));
  const gronelandia = lat > 58 && lon > -73 && lon < -20 ? suave((lat - 58) / 6) : 0;
  cor = misturar(cor, CORES_MAPA.gelo, Math.max(suave((lat - 68) / 6), gronelandia, suave((-56 - lat) / 4)));
  return cor;
}

/** Ruído estável por célula: sem ele o verde fica uma mancha de tinta plana.
    No mar quase não se usa — ali o grão lia-se como tecido. */
const granulado = (i, forca) => (((i * 2654435761) % 4096) / 4096 - 0.5) * forca;

let imagemMapaCache = null;
function imagemMapa() {
  if (imagemMapaCache) return imagemMapaCache;

  const cru = atob(MAPA_TERRA);
  const terra = (c, r) => {
    if (c < 0 || c >= MAPA_COLS || r < 0 || r >= MAPA_ROWS) return false;
    const i = r * MAPA_COLS + c;
    return !!(cru.charCodeAt(i >> 3) & (128 >> (i & 7)));
  };

  const pequena = document.createElement("canvas");
  pequena.width = MAPA_COLS;
  pequena.height = MAPA_ROWS;
  const ctx = pequena.getContext("2d");
  const img = ctx.createImageData(MAPA_COLS, MAPA_ROWS);

  for (let r = 0; r < MAPA_ROWS; r++) {
    for (let c = 0; c < MAPA_COLS; c++) {
      const i = r * MAPA_COLS + c;
      const lon = -180 + c + 0.5;
      const lat = MAPA_LAT_TOPO - r - 0.5;
      let cor;
      if (terra(c, r)) {
        cor = corTerra(lat, lon);
      } else {
        // Água encostada a terra fica mais clara: é a plataforma continental,
        // e é o que dá relevo à linha de costa.
        const perto =
          terra(c - 1, r) || terra(c + 1, r) || terra(c, r - 1) || terra(c, r + 1) ||
          terra(c - 1, r - 1) || terra(c + 1, r - 1) || terra(c - 1, r + 1) || terra(c + 1, r + 1);
        cor = perto ? CORES_MAPA.plataforma : CORES_MAPA.oceano;
      }
      const ruido = granulado(i, terra(c, r) ? 13 : 3);
      const p = i * 4;
      img.data[p] = Math.max(0, Math.min(255, cor[0] + ruido));
      img.data[p + 1] = Math.max(0, Math.min(255, cor[1] + ruido));
      img.data[p + 2] = Math.max(0, Math.min(255, cor[2] + ruido));
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Esticar com suavização tira o efeito de mosaico e aproxima o aspeto de um
  // mapa de satélite visto de longe.
  const grande = document.createElement("canvas");
  grande.width = MAPA_COLS * 3;
  grande.height = MAPA_ROWS * 3;
  const ctx2 = grande.getContext("2d");
  ctx2.imageSmoothingEnabled = true;
  ctx2.imageSmoothingQuality = "high";
  ctx2.drawImage(pequena, 0, 0, grande.width, grande.height);

  return (imagemMapaCache = grande.toDataURL("image/png"));
}

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
let focosDoDia = [];

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
  const focos = (focosDoDia = (() => {
    const por = new Map();
    for (const { item, i } of geopoliticos) {
      const iso = isoDe(item.titulo, item.rubrica);
      if (!iso || !COORD[iso]) continue;
      const f = por.get(iso) || { iso, indices: [], alto: false };
      f.indices.push(i);
      if (item.impacto === "alto") f.alto = true;
      por.set(iso, f);
    }
    // Os alertas do painel também contam, mesmo sem tema próprio no dia.
    for (const a of geo.alertas || []) {
      const iso = isoDe(a.texto);
      if (!iso || !COORD[iso] || por.has(iso)) continue;
      por.set(iso, { iso, indices: [], alto: a.nivel === "alto" });
    }
    return [...por.values()].sort((a, b) => b.indices.length - a.indices.length);
  })());

  const escolhido = estado.focoGeo && focos.some((f) => f.iso === estado.focoGeo) ? estado.focoGeo : "";

  const mapaHTML = () => {
    if (!focos.length && !geopoliticos.length) return "";
    const pontos = focos
      .map((f) => {
        const [la, lo] = COORD[f.iso];
        const x = projX(lo).toFixed(1);
        const y = projY(la).toFixed(1);
        const r = Math.min(5.2, 2.4 + f.indices.length * 0.75);
        return `<g class="foco" data-foco="${f.iso}" data-alto="${f.alto ? "sim" : "nao"}"
            aria-current="${escolhido === f.iso}"
            data-x="${x}" data-y="${y}" style="transform:translate(${x}px,${y}px)">
            <circle class="halo" r="${(r * 2.6).toFixed(1)}"/>
            <circle class="anel" r="${(r * 1.5).toFixed(1)}"/>
            <circle class="nucleo" r="${r.toFixed(1)}"/>
            <circle class="alvo" r="9"/>
            <title>${esc(NOME_PAIS[f.iso] || f.iso)}</title>
          </g>`;
      })
      .join("");

    return `<div class="mapa-caixa">
      <div class="mapa-cabeca">
        <span class="rotulo"><i class="emoji">🗺️</i>Mapa do dia</span>
        <button class="ver-mais" data-foco="" ${escolhido ? "" : "hidden"}>Ver o mundo ›</button>
      </div>
      <div class="mapa-palco">
        <svg class="mapa-mundo" viewBox="0 0 360 144" role="img"
             aria-label="Mapa dos focos do dia" preserveAspectRatio="xMidYMid meet">
          <g class="mundo" id="mapa-mundo">
            <image href="${imagemMapa()}" x="0" y="0" width="360" height="144" preserveAspectRatio="none"/>
            ${pontos}
          </g>
        </svg>
      </div>
      ${
        focos.length
          ? `<div class="fichas-foco">
              ${focos
                .map(
                  (f) => `<button class="ficha" data-foco="${f.iso}" aria-current="${escolhido === f.iso}">
                    <i class="emoji">${emojiBandeira(f.iso)}</i>${esc(NOME_PAIS[f.iso] || f.iso)}
                    ${f.indices.length ? `<b>${f.indices.length}</b>` : ""}
                  </button>`
                )
                .join("")}
            </div>`
          : `<p class="mapa-vazio rotulo">Esta edição não prende nenhum tema a um país.</p>`
      }
      <p class="mapa-legenda rotulo">
        <i class="bolha alto"></i>impacto alto
        <i class="bolha"></i>restantes
        <b class="dica">${
          escolhido
            ? focos.find((f) => f.iso === escolhido)?.indices.length === 1
              ? "toca outra vez para abrir"
              : "toca outra vez para afastar"
            : "toca para aproximar"
        }</b>
      </p>
    </div>`;
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
      const filtrados = escolhido
        ? geopoliticos.filter(({ i }) => focos.find((f) => f.iso === escolhido)?.indices.includes(i))
        : geopoliticos;
      const nome = escolhido ? NOME_PAIS[escolhido] || escolhido : "";
      return (
        mapaHTML() +
        blocoRisco() +
        blocoAlertas() +
        cabecalho(escolhido ? `Temas · ${nome}` : "Geopolítica", EMOJI("🌍")) +
        listaPorTopico(filtrados, escolhido ? `Nada sobre ${nome} nesta edição.` : semGeo) +
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

  // Tocar no mar, fora de qualquer ponto, afasta o mapa.
  if (e.target.closest(".mapa-palco") && !e.target.closest("[data-foco]") && estado.focoGeo) {
    estado.focoGeo = "";
    desenharNoticias();
    return aproximarMapa();
  }

  const foco = e.target.closest("[data-foco]");
  if (!foco) return;
  const iso = foco.dataset.foco;
  const alvo = focosDoDia.find((f) => f.iso === iso);

  // Dois tempos: o primeiro toque aproxima e filtra; o segundo, já aproximado,
  // abre o tema. Com mais do que um tema o segundo toque afasta outra vez —
  // escolher qual abrir seria adivinhar.
  if (iso && iso === estado.focoGeo) {
    if (alvo?.indices.length === 1) return irPara("artigo", alvo.indices[0]);
    estado.focoGeo = "";
  } else {
    estado.focoGeo = iso;
  }

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
  const iso = estado.focoGeo;
  const k = iso && COORD[iso] ? 2.6 : 1;

  if (k === 1) g.style.transform = "none";
  else {
    const [la, lo] = COORD[iso];
    g.style.transform = `translate(${(180 - k * projX(lo)).toFixed(1)}px, ${(
      72 -
      k * projY(la)
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

/* ------------------------------------------------------------ áreas base --- */

/**
 * Seis áreas de arranque, cada uma com um percurso já escrito do princípio ao
 * fim. Semeiam-se uma vez só: se depois forem apagadas, ficam apagadas.
 */
const AREAS_SEMENTE = [
  {
    nome: "Cozinha",
    sigla: "CZ",
    cor: "latao",
    temas: [
      "Afiar e usar a faca: corte em juliana, brunoise e chiffonade",
      "Os cinco sabores e como corrigir um prato salgado, ácido ou insonso",
      "Refogado: cebola, alho e a base de metade dos pratos portugueses",
      "Selar carne: reação de Maillard, tempo de repouso e ponto",
      "Peixe: escamar, amanhar e assar inteiro sem secar",
      "Arroz, massa e batata: proporções de água e tempos de cozedura",
      "Ovos: mexidos, escalfados e omelete francesa",
      "Molhos-mãe: bechamel, holandês e vinagretes que não se separam",
      "Sopa: caldo de legumes, de galinha e de peixe",
      "Fermento e pão: massa mãe, tempos de levedação e forno",
      "Conservação: congelar bem, marinar e curar",
      "Planear a semana: lista de compras e cozinhar em lote",
    ],
  },
  {
    nome: "Mecânica",
    sigla: "MC",
    cor: "rust",
    temas: [
      "As quatro fases do motor a quatro tempos",
      "Óleo e filtros: quando mudar e o que dizem as especificações",
      "Travões: pastilhas, discos, líquido e sinais de desgaste",
      "Pneus: pressão, desgaste irregular, TPMS e mudança de roda",
      "Bateria e alternador: medir com multímetro e arrancar com pinças",
      "Correia de distribuição contra corrente: prazos e risco",
      "Sistema de arrefecimento: radiador, termóstato e sobreaquecimento",
      "Suspensão e direção: amortecedores, rótulas e alinhamento",
      "Ler códigos OBD2 e perceber a luz do motor",
      "Embraiagem e caixa: manual, automática e sinais de fim de vida",
      "Diesel moderno: filtro de partículas, EGR e AdBlue",
      "Inspeção periódica: o que reprova e como preparar o carro",
    ],
  },
  {
    nome: "Eletricidade",
    sigla: "EL",
    cor: "indigo",
    temas: [
      "Tensão, corrente, resistência e a lei de Ohm",
      "Potência e consumo: watts, kWh e o que pesa na fatura",
      "Corrente alterna e contínua: onde aparece cada uma",
      "Quadro elétrico: disjuntores, diferencial e o que faz saltar a luz",
      "Ligação à terra e por que razão salva vidas",
      "Secções de cabo e a corrente que cada uma aguenta",
      "Trocar uma tomada, um interruptor e um ponto de luz em segurança",
      "Circuito de escada: dois interruptores, uma lâmpada",
      "Usar o multímetro: continuidade, tensão e resistência",
      "Iluminação LED: lúmen, temperatura de cor e drivers",
      "Fotovoltaico doméstico: painéis, inversor e autoconsumo",
      "Primeiros socorros em choque elétrico",
    ],
  },
  {
    nome: "Coisas úteis",
    sigla: "UT",
    cor: "sobe",
    temas: [
      "Canalização básica: desentupir, trocar torneira e sifão",
      "Furar parede: brocas, buchas e onde não furar",
      "Pintar uma divisão: preparação, primário e acabamento",
      "Nós essenciais: direito, oito, volta do fiel e nó de pescador",
      "Kit de primeiros socorros e o que fazer nos primeiros cinco minutos",
      "Extintores: classes de fogo e qual usar",
      "Ler uma fatura de água, luz e gás",
      "Orçamento pessoal: registar, categorizar e poupar por objetivo",
      "Impostos: IRS, escalões e deduções que se perdem por esquecimento",
      "Contratos e seguros: o que ler antes de assinar",
      "Segurança digital: gestor de palavras-passe e dois fatores",
      "Manutenção de casa por estação do ano",
    ],
  },
  {
    nome: "História",
    sigla: "HI",
    cor: "indigo",
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
    nome: "Francês",
    sigla: "FR",
    cor: "latao",
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
      temas: base.temas.map((nome) => ({ nome, feito: false })),
      criado_em: Date.now(),
      apagado: false,
    });
  }
}

/** O primeiro tema por fazer de uma área — o que vem a seguir. */
const proximoTema = (area) => area.temas.find((t) => !t.feito)?.nome || "";

function desenharAprendizagem() {
  semearAreas();
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

  /* A aula que está na app é a última publicada, não necessariamente a de hoje.
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

  $("#aprender-curso").innerHTML = curso
    ? `<button class="cartao-curso" data-abrir-curso>
        <span class="rotulo" style="color:var(--indigo)">${esc(NOMES["inteligencia-artificial"])}</span>
        <h3>${esc(curso.titulo)}</h3>
        <span class="selos">${desenharProgresso(curso.progresso) || `<span class="selo">${curso.itens.length} capítulos</span>`}${frescura}</span>
      </button>${
        atraso > 1
          ? `<p class="aviso-rotina rotulo">A rotina de IA não publica desde ${esc(
              porExtenso(curso.data)
            )}.</p>`
          : ""
      }`
    : `<div class="grupo"><p class="linha"><span class="texto"><span>A aula de hoje ainda não foi publicada.</span></span></p></div>`;

  /* Plano do dia: a aula, os cartões devidos e um tema por fazer, escolhido de
     forma estável pelo dia do ano — hoje é sempre o mesmo, amanhã é outro. */
  const porFazer = areas.flatMap((a) => a.temas.filter((t) => !t.feito).map((t) => ({ a, t })));
  const diaDoAno = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / DIA);
  const sugerido = porFazer.length ? porFazer[diaDoAno % porFazer.length] : null;
  const cartoesDevidos = devidos().length;

  const linhaPlano = (icone, texto, extra, accao) =>
    `<button class="linha-plano" ${accao}>
      <span class="emoji">${icone}</span>
      <span class="corpo"><b>${texto}</b>${extra ? `<span>${extra}</span>` : ""}</span>
      <span class="seta">›</span>
    </button>`;

  $("#aprender-plano").innerHTML = `<div class="grupo">${[
    curso
      ? linhaPlano(
          "📘",
          esc(curso.titulo),
          `${NOMES["inteligencia-artificial"]}${atraso ? ` · há ${atraso} dias` : " · hoje"}`,
          "data-abrir-curso"
        )
      : "",
    cartoesDevidos
      ? linhaPlano(
          "🔁",
          `${cartoesDevidos} ${cartoesDevidos === 1 ? "cartão" : "cartões"} para rever`,
          "Revisão espaçada",
          'data-ir="revisao"'
        )
      : linhaPlano("🔁", "Nada para rever hoje", "Revisão espaçada", 'data-ir="revisao"'),
    sugerido
      ? linhaPlano(
          "🎯",
          esc(sugerido.t.nome),
          `Próximo tema · ${esc(sugerido.a.nome)}`,
          `data-area="${esc(sugerido.a.id)}"`
        )
      : "",
  ]
    .filter(Boolean)
    .join("")}</div>`;

  $("#aprender-areas").innerHTML = areas.length
    ? `<div class="grupo">${areas
        .map((a) => {
          const pct = progressoArea(a);
          return `<button class="area" data-area="${esc(a.id)}" style="--ponto:${CORES_AREA[a.cor]}">
            <span class="bloco-area">${esc(a.sigla || SIGLA(a.nome))}</span>
            <span class="corpo">
              <h4>${esc(a.nome)}</h4>
              <span class="rotulo">${a.temas.filter((t) => t.feito).length} de ${a.temas.length} · ${pct}%</span>
              ${proximoTema(a) ? `<span class="seguinte">a seguir: ${esc(proximoTema(a))}</span>` : ""}
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

$("#aprender-areas").addEventListener("click", (e) => {
  const alvo = e.target.closest("[data-area]");
  if (alvo) abrirArea(estado.biblioteca.areas[alvo.dataset.area]);
});

$("#aprender-curso").addEventListener("click", () => {
  const c = estado.edicaoCurso;
  if (c) irPara("edicao", c.rotina, c.data);
});

/* O plano é desenhado a cada pintura: os seus botões vão por delegação, senão
   ficavam sem dono e o toque não fazia nada. */
$("#aprender-plano").addEventListener("click", (e) => {
  const area = e.target.closest("[data-area]");
  if (area) return abrirArea(estado.biblioteca.areas[area.dataset.area]);

  const curso = e.target.closest("[data-abrir-curso]");
  if (curso && estado.edicaoCurso) {
    return irPara("edicao", estado.edicaoCurso.rotina, estado.edicaoCurso.data);
  }

  const ir = e.target.closest("[data-ir]");
  if (ir) irPara(ir.dataset.ir);
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
